import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK generateText before importing OneShotTasks
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

// Mock i18n
vi.mock('../../../src/main/shared/i18n', () => ({
  resolveSupportedRenderLanguage: vi.fn((lang: string) => lang),
  translateRender: vi.fn((_lang: string, key: string) => {
    const prompts: Record<string, string> = {
      'ai.postAnalysis.system': 'You are a blog editor assistant. Analyze the blog post and suggest improvements. Return JSON with "title", "excerpt", "slug". Respond in en.',
      'ai.postAnalysis.user': 'Analyze this blog post.',
    };
    return prompts[key] || key;
  }),
}));

import { OneShotTasks, type PostAnalysisResult } from '../../../src/main/engine/ai/tasks';
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

  const mediaEngine = {} as any;

  const postEngine = {
    getPost: vi.fn(),
    upsertPostTranslation: vi.fn(),
  } as any;

  return { chatEngine, providers, mediaEngine, postEngine };
}

describe('OneShotTasks.analyzePost', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let tasks: OneShotTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    tasks = new OneShotTasks(deps.providers, deps.chatEngine, deps.mediaEngine, deps.postEngine);
  });

  it('returns title, excerpt, and slug from AI response', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      slug: 'my-post',
      excerpt: '',
      content: 'This is the content of my blog post about testing.',
      status: 'draft',
    });

    mockGenerateText.mockResolvedValue({
      text: '{"title": "Better Title", "excerpt": "A concise summary of the post.", "slug": "better-title"}',
    } as any);

    const result: PostAnalysisResult = await tasks.analyzePost('post-1', 'en');

    expect(result.success).toBe(true);
    expect(result.title).toBe('Better Title');
    expect(result.excerpt).toBe('A concise summary of the post.');
    expect(result.slug).toBe('better-title');
    expect(deps.postEngine.getPost).toHaveBeenCalledWith('post-1');
  });

  it('returns error when post is not found', async () => {
    deps.postEngine.getPost.mockResolvedValue(null);

    const result = await tasks.analyzePost('nonexistent', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Post not found');
  });

  it('returns error when post has no content', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: '',
      slug: 'post-1',
      content: '',
      status: 'draft',
    });

    const result = await tasks.analyzePost('post-1', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Post has no content to analyze');
  });

  it('returns error when no API key is configured', async () => {
    deps.providers.getOpencodeKey.mockReturnValue(null);
    deps.providers.getMistralKey.mockReturnValue(null);
    deps.providers.isProviderKeySet.mockReturnValue(false);

    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Test',
      content: 'Content here',
      status: 'draft',
    });

    const result = await tasks.analyzePost('post-1', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');
  });

  it('sanitizes slug to lowercase with hyphens only', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Test',
      slug: 'test',
      content: 'Content here',
      status: 'draft',
    });

    mockGenerateText.mockResolvedValue({
      text: '{"title": "New Title", "excerpt": "Summary text.", "slug": "Some Weird Slug!"}',
    } as any);

    const result = await tasks.analyzePost('post-1', 'en');

    expect(result.success).toBe(true);
    expect(result.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('handles AI response parse errors gracefully', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Test',
      content: 'Content',
      status: 'draft',
    });

    mockGenerateText.mockResolvedValue({
      text: 'not valid json at all',
    } as any);

    const result = await tasks.analyzePost('post-1', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid response format from AI');
  });

  it('uses title model when configured', async () => {
    deps.chatEngine.getSetting.mockResolvedValue('custom-model-id');
    deps.providers.detectModelProvider.mockReturnValue('opencode');
    deps.providers.isProviderKeySet.mockReturnValue(true);

    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Test',
      content: 'Content',
      status: 'draft',
    });

    mockGenerateText.mockResolvedValue({
      text: '{"title": "T", "excerpt": "E", "slug": "t"}',
    } as any);

    await tasks.analyzePost('post-1', 'en');

    expect(deps.chatEngine.getSetting).toHaveBeenCalledWith('chat_title_model');
    expect(deps.providers.resolveModel).toHaveBeenCalledWith('custom-model-id');
  });
});

describe('OneShotTasks.translatePost', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let tasks: OneShotTasks;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    tasks = new OneShotTasks(deps.providers, deps.chatEngine, deps.mediaEngine, deps.postEngine);
  });

  it('instructs the AI to leave fenced code blocks untranslated', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Intro\n\n```ts\nconst label = "Hello";\n```',
      language: 'en',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Post',
      excerpt: 'Resume',
      content: 'Intro\n\n```ts\nconst label = "Hello";\n```',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: '{"title":"Mon Post","excerpt":"Resume"}',
      } as any)
      .mockResolvedValueOnce({
        text: 'Intro\n\n```ts\nconst label = "Hello";\n```',
      } as any);

    await tasks.translatePost('post-1', 'fr');

    expect(mockGenerateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      system: expect.stringContaining('Leave text inside fenced code blocks untranslated.'),
    }));
  });

  it('translates markdown body outside a JSON envelope', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Intro\n\n```ts\nconst config = { hello: "world" };\n```\n\nEnd.',
      language: 'en',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Post',
      excerpt: 'Resume',
      content: 'Bonjour',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: '{"title":"Mon Post","excerpt":"Resume"}',
      } as any)
      .mockResolvedValueOnce({
        text: 'Introduction\n\n```ts\nconst config = { hello: "world" };\n```\n\nFin.',
      } as any);

    const result = await tasks.translatePost('post-1', 'fr');

    expect(result.success).toBe(true);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(mockGenerateText).toHaveBeenNthCalledWith(1, expect.objectContaining({
      system: expect.stringContaining('keys title and excerpt'),
    }));
    expect(mockGenerateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      system: expect.stringContaining('Return ONLY the translated Markdown body'),
    }));
    expect(deps.postEngine.upsertPostTranslation).toHaveBeenCalledWith('post-1', 'fr', {
      title: 'Mon Post',
      excerpt: 'Resume',
      content: 'Introduction\n\n```ts\nconst config = { hello: "world" };\n```\n\nFin.',
    });
  });

  it('passes the raw markdown body without a leading content label', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: '# Heading\n\nBody text',
      language: 'en',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Post',
      excerpt: 'Resume',
      content: '# Titre\n\nTexte',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: '{"title":"Mon Post","excerpt":"Resume"}',
      } as any)
      .mockResolvedValueOnce({
        text: '# Titre\n\nTexte',
      } as any);

    await tasks.translatePost('post-1', 'fr');

    expect(mockGenerateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: '# Heading\n\nBody text',
    }));
  });

  it('strips an accidental leading content label from translated markdown', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'Mein Beitrag',
      excerpt: 'Zusammenfassung',
      content: '# Uberschrift\n\nText',
      language: 'de',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'en',
      title: 'My Post',
      excerpt: 'Summary',
      content: '# Heading\n\nText',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: '{"title":"My Post","excerpt":"Summary"}',
      } as any)
      .mockResolvedValueOnce({
        text: 'content:\n\n# Heading\n\nText',
      } as any);

    await tasks.translatePost('post-1', 'en');

    expect(deps.postEngine.upsertPostTranslation).toHaveBeenCalledWith('post-1', 'en', {
      title: 'My Post',
      excerpt: 'Summary',
      content: '# Heading\n\nText',
    });
  });

  it('instructs the AI to translate only — never invent or add content', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: '# Hello\n\nWorld',
      language: 'en',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Post',
      excerpt: 'Resume',
      content: '# Bonjour\n\nMonde',
    });
    mockGenerateText
      .mockResolvedValueOnce({ text: '{"title":"Mon Post","excerpt":"Resume"}' } as any)
      .mockResolvedValueOnce({ text: '# Bonjour\n\nMonde' } as any);

    await tasks.translatePost('post-1', 'fr');

    const contentSystemPrompt = mockGenerateText.mock.calls[1][0].system as string;
    expect(contentSystemPrompt).toMatch(/do not invent|do not add|only translate/i);
    expect(contentSystemPrompt).toMatch(/macro|shortcode|non-translatable/i);
  });

  it('falls back to source title and excerpt when metadata JSON is invalid', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Intro',
      language: 'en',
      status: 'draft',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Bonjour',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'not valid json',
      } as any)
      .mockResolvedValueOnce({
        text: 'Bonjour',
      } as any);

    const result = await tasks.translatePost('post-1', 'fr');

    expect(result.success).toBe(true);
    expect(deps.postEngine.upsertPostTranslation).toHaveBeenCalledWith('post-1', 'fr', {
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Bonjour',
    });
  });

  it('passes status published when autoPublish is set', async () => {
    deps.postEngine.getPost.mockResolvedValue({
      id: 'post-1',
      title: 'My Post',
      excerpt: 'Summary',
      content: 'Hello world',
      language: 'en',
      status: 'published',
    });
    deps.postEngine.upsertPostTranslation.mockResolvedValue({
      id: 'translation-1',
      translationFor: 'post-1',
      language: 'fr',
      title: 'Mon Post',
      excerpt: 'Résumé',
      content: 'Bonjour le monde',
    });
    mockGenerateText
      .mockResolvedValueOnce({
        text: '{"title":"Mon Post","excerpt":"Résumé"}',
      } as any)
      .mockResolvedValueOnce({
        text: 'Bonjour le monde',
      } as any);

    const result = await tasks.translatePost('post-1', 'fr', { autoPublish: true });

    expect(result.success).toBe(true);
    expect(deps.postEngine.upsertPostTranslation).toHaveBeenCalledWith('post-1', 'fr', {
      title: 'Mon Post',
      excerpt: 'Résumé',
      content: 'Bonjour le monde',
      status: 'published',
    });
  });
});
