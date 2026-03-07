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
