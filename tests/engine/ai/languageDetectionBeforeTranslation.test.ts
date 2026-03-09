import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK generateText before importing OneShotTasks
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

// Mock i18n
vi.mock('../../../src/main/shared/i18n', () => ({
  resolveSupportedRenderLanguage: vi.fn((lang: string) => lang),
  translateRender: vi.fn((_lang: string, key: string) => key),
}));

import { OneShotTasks } from '../../../src/main/engine/ai/tasks';
import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

function createMockDeps() {
  const chatEngine = {
    getSetting: vi.fn().mockResolvedValue(null),
  } as any;

  const providers = {
    detectModelProvider: vi.fn().mockReturnValue('opencode'),
    isProviderKeySet: vi.fn().mockReturnValue(true),
    getOpencodeKey: vi.fn().mockReturnValue('test-key'),
    getMistralKey: vi.fn().mockReturnValue(null),
    resolveModel: vi.fn().mockReturnValue('mock-model'),
    isOfflineMode: vi.fn().mockReturnValue(false),
    isOllamaModel: vi.fn().mockReturnValue(false),
    isLmstudioModel: vi.fn().mockReturnValue(false),
    getFirstKnownLocalModelId: vi.fn().mockReturnValue(null),
  } as any;

  const mediaEngine = {
    getMedia: vi.fn(),
    updateMedia: vi.fn(),
    upsertMediaTranslation: vi.fn(),
  } as any;

  const postEngine = {
    getPost: vi.fn(),
    updatePost: vi.fn(),
    upsertPostTranslation: vi.fn(),
  } as any;

  return { chatEngine, providers, mediaEngine, postEngine };
}

describe('translatePost: auto-detect language when not set', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let tasks: OneShotTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    tasks = new OneShotTasks(deps.providers, deps.chatEngine, deps.mediaEngine, deps.postEngine);
  });

  it('detects and persists language before translating when post has no language', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Mein Beitrag',
      excerpt: 'Zusammenfassung',
      content: 'Dies ist ein deutscher Blogbeitrag über verschiedene Themen.',
      language: undefined, // No language set
      status: 'draft',
    });
    deps.postEngine.updatePost.mockResolvedValue({
      id: 'post-1',
      language: 'de',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'en',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'This is a German blog post about various topics.',
    });

    // First call: language detection response
    // Then: metadata translation response
    // Then: content translation response
    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "de"}' } as any) // language detection
      .mockResolvedValueOnce({ text: '{"title":"My Post","excerpt":"Summary"}' } as any) // metadata translation
      .mockResolvedValueOnce({ text: 'This is a German blog post about various topics.' } as any); // content translation

    const result = await tasks.translatePost('post-1', 'en');

    expect(result.success).toBe(true);
    // Language detection should have been called (first generateText call)
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    // Language should have been persisted
    expect(deps.postEngine.updatePost).toHaveBeenCalledWith('post-1', { language: 'de' });
    // Translation prompts should use detected language 'de', not fallback 'en'
    const metadataCall = mockGenerateText.mock.calls[1][0];
    expect((metadataCall as any).system).toContain('de');
  });

  it('skips detection when post has explicit language set', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'This is an English blog post.',
      language: 'en', // Explicitly set
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Article',
      excerpt: 'Résumé',
      content: 'Ceci est un article de blog en anglais.',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"title":"Mon Article","excerpt":"Résumé"}' } as any) // metadata translation
      .mockResolvedValueOnce({ text: 'Ceci est un article de blog en anglais.' } as any); // content translation

    const result = await tasks.translatePost('post-1', 'fr');

    expect(result.success).toBe(true);
    // Only 2 calls: metadata + content translation, NO language detection
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    // updatePost should NOT have been called for language
    expect(deps.postEngine.updatePost).not.toHaveBeenCalled();
  });

  it('proceeds with fallback when language detection fails', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Some content here.',
      language: undefined,
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Article',
      excerpt: 'Résumé',
      content: 'Du contenu ici.',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: 'garbage response' } as any) // language detection fails
      .mockResolvedValueOnce({ text: '{"title":"Mon Article","excerpt":"Résumé"}' } as any)
      .mockResolvedValueOnce({ text: 'Du contenu ici.' } as any);

    const result = await tasks.translatePost('post-1', 'fr');

    expect(result.success).toBe(true);
    // updatePost should NOT have been called since detection failed
    expect(deps.postEngine.updatePost).not.toHaveBeenCalled();
    // Should still proceed with translation (3 calls total: detection + 2 translation)
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  it('uses detected language in translation prompts', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Mon Article',
      excerpt: '',
      content: 'Ceci est un article français.',
      language: undefined,
      status: 'draft',
    });
    deps.postEngine.updatePost.mockResolvedValue({ id: 'post-1', language: 'fr' });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'en',
      title: 'My Article',
      excerpt: '',
      content: 'This is a French article.',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "fr"}' } as any)
      .mockResolvedValueOnce({ text: '{"title":"My Article","excerpt":""}' } as any)
      .mockResolvedValueOnce({ text: 'This is a French article.' } as any);

    await tasks.translatePost('post-1', 'en');

    // The translation prompt should use 'fr' as source language
    const metadataSystemPrompt = mockGenerateText.mock.calls[1][0].system as string;
    const contentSystemPrompt = mockGenerateText.mock.calls[2][0].system as string;
    expect(metadataSystemPrompt).toContain('from fr to en');
    expect(contentSystemPrompt).toContain('from fr to en');
  });

  it('treats null language the same as undefined (no language)', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Test Post',
      excerpt: '',
      content: 'Some content.',
      language: null, // null, not undefined
      status: 'draft',
    });
    deps.postEngine.updatePost.mockResolvedValue({ id: 'post-1', language: 'en' });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'de',
      title: 'Test',
      excerpt: '',
      content: 'Inhalt.',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "en"}' } as any)
      .mockResolvedValueOnce({ text: '{"title":"Test","excerpt":""}' } as any)
      .mockResolvedValueOnce({ text: 'Inhalt.' } as any);

    await tasks.translatePost('post-1', 'de');

    // Should have called detection since language is null
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    expect(deps.postEngine.updatePost).toHaveBeenCalledWith('post-1', { language: 'en' });
  });
});

describe('translateMediaMetadata: auto-detect language when not set', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let tasks: OneShotTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    tasks = new OneShotTasks(deps.providers, deps.chatEngine, deps.mediaEngine, deps.postEngine);
  });

  it('detects and persists language before translating when media has no language', async () => {
    deps.mediaEngine.getMedia.mockResolvedValue({
      id: 'media-1',
      title: 'Sonnenuntergang am Meer',
      alt: 'Ein wunderschöner Sonnenuntergang',
      caption: 'Aufgenommen im Sommer',
      language: undefined,
    });
    deps.mediaEngine.updateMedia.mockResolvedValue({
      id: 'media-1',
      language: 'de',
    });
    deps.mediaEngine.upsertMediaTranslation.mockResolvedValue({
      id: 'mt-1',
      translationFor: 'media-1',
      language: 'en',
      title: 'Sunset at Sea',
      alt: 'A beautiful sunset',
      caption: 'Taken in summer',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "de"}' } as any) // language detection
      .mockResolvedValueOnce({ text: '{"title":"Sunset at Sea","alt":"A beautiful sunset","caption":"Taken in summer"}' } as any); // translation

    const result = await tasks.translateMediaMetadata('media-1', 'en');

    expect(result.success).toBe(true);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(deps.mediaEngine.updateMedia).toHaveBeenCalledWith('media-1', { language: 'de' });
    // Translation prompt should use detected language 'de'
    const translationCall = mockGenerateText.mock.calls[1][0];
    expect((translationCall as any).system).toContain('de');
  });

  it('skips detection when media has explicit language set', async () => {
    deps.mediaEngine.getMedia.mockResolvedValue({
      id: 'media-1',
      title: 'Sunset at Sea',
      alt: 'A beautiful sunset',
      caption: 'Taken in summer',
      language: 'en',
    });
    deps.mediaEngine.upsertMediaTranslation.mockResolvedValue({
      id: 'mt-1',
      translationFor: 'media-1',
      language: 'de',
      title: 'Sonnenuntergang',
      alt: 'Schön',
      caption: 'Im Sommer',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"title":"Sonnenuntergang","alt":"Schön","caption":"Im Sommer"}' } as any);

    const result = await tasks.translateMediaMetadata('media-1', 'de');

    expect(result.success).toBe(true);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(deps.mediaEngine.updateMedia).not.toHaveBeenCalled();
  });

  it('proceeds with fallback when media language detection fails', async () => {
    deps.mediaEngine.getMedia.mockResolvedValue({
      id: 'media-1',
      title: 'Test Image',
      alt: 'Alt text',
      caption: 'Caption',
      language: undefined,
    });
    deps.mediaEngine.upsertMediaTranslation.mockResolvedValue({
      id: 'mt-1',
      translationFor: 'media-1',
      language: 'de',
      title: 'Testbild',
      alt: 'Alt',
      caption: 'Beschriftung',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: 'garbage' } as any) // detection fails
      .mockResolvedValueOnce({ text: '{"title":"Testbild","alt":"Alt","caption":"Beschriftung"}' } as any);

    const result = await tasks.translateMediaMetadata('media-1', 'de');

    expect(result.success).toBe(true);
    expect(deps.mediaEngine.updateMedia).not.toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it('uses detected language in media translation prompts', async () => {
    deps.mediaEngine.getMedia.mockResolvedValue({
      id: 'media-1',
      title: 'Tramonto sul mare',
      alt: 'Un bel tramonto',
      caption: 'Fotografato in estate',
      language: undefined,
    });
    deps.mediaEngine.updateMedia.mockResolvedValue({ id: 'media-1', language: 'it' });
    deps.mediaEngine.upsertMediaTranslation.mockResolvedValue({
      id: 'mt-1',
      translationFor: 'media-1',
      language: 'en',
      title: 'Sunset',
      alt: 'Beautiful',
      caption: 'Summer',
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "it"}' } as any)
      .mockResolvedValueOnce({ text: '{"title":"Sunset","alt":"Beautiful","caption":"Summer"}' } as any);

    await tasks.translateMediaMetadata('media-1', 'en');

    const translationSystemPrompt = mockGenerateText.mock.calls[1][0].system as string;
    expect(translationSystemPrompt).toContain('from it to en');
  });

  it('treats null language the same as undefined (no language)', async () => {
    deps.mediaEngine.getMedia.mockResolvedValue({
      id: 'media-1',
      title: 'Test',
      alt: 'Alt',
      caption: null,
      language: null,
    });
    deps.mediaEngine.updateMedia.mockResolvedValue({ id: 'media-1', language: 'en' });
    deps.mediaEngine.upsertMediaTranslation.mockResolvedValue({
      id: 'mt-1',
      translationFor: 'media-1',
      language: 'de',
      title: 'Test',
      alt: 'Alt',
      caption: null,
    });

    mockGenerateText
      .mockResolvedValueOnce({ text: '{"language": "en"}' } as any)
      .mockResolvedValueOnce({ text: '{"title":"Test","alt":"Alt","caption":null}' } as any);

    await tasks.translateMediaMetadata('media-1', 'de');

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(deps.mediaEngine.updateMedia).toHaveBeenCalledWith('media-1', { language: 'en' });
  });
});
