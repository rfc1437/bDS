/**
 * Offline model fallback tests.
 *
 * Verifies that OneShotTasks.analyzeMediaImage(), ChatService.sendMessage(),
 * and ChatService.generateConversationTitle() automatically fall back to
 * the configured offline model when airplane mode is active.
 *
 * Strategy: spy on resolveModel to capture which model ID is passed,
 * then let it throw to short-circuit the actual AI call — the engine's
 * try/catch returns { success: false } which is fine for our assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OneShotTasks } from '../../src/main/engine/ai/tasks';
import { ChatService } from '../../src/main/engine/ai/chat';
import { ProviderRegistry } from '../../src/main/engine/ai/providers';

// Tiny valid 2x2 JPEG (base64) — avoids sharp "corrupt header" error
// eslint-disable-next-line max-len
const TINY_JPEG_B64 = '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAA//2Q==';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function createMockChatEngine(settings: Record<string, string | null> = {}) {
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
    getConversation: vi.fn(),
    addMessage: vi.fn(async (msg: unknown) => ({ id: 'msg-1', ...msg as Record<string, unknown> })),
    getDefaultSystemPrompt: vi.fn(async () => 'You are a helpful assistant'),
    updateConversation: vi.fn(),
  } as unknown as InstanceType<typeof import('../../src/main/engine/ChatEngine').ChatEngine>;
}

function createMockMediaEngine() {
  return {
    getMedia: vi.fn(async () => ({
      id: 'media-1',
      mimeType: 'image/jpeg',
      filename: 'test.jpg',
    })),
    getThumbnailDataUrl: vi.fn(async () => `data:image/jpeg;base64,${TINY_JPEG_B64}`),
  } as unknown as InstanceType<typeof import('../../src/main/engine/MediaEngine').MediaEngine>;
}

/** Mock the ModelCatalogEngine returned by ProviderRegistry */
function mockModelCatalog(registry: ProviderRegistry): void {
  vi.spyOn(registry, 'getModelCatalogEngine').mockReturnValue({
    getContextWindow: vi.fn(async () => 8192),
  } as never);
}

// ---------------------------------------------------------------------------
// OneShotTasks — analyzeMediaImage offline fallback
// ---------------------------------------------------------------------------

describe('OneShotTasks offline model fallback', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llava:latest');
  });

  it('analyzeMediaImage uses offline_image_analysis_model when airplane mode is on', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({
      chat_image_analysis_model: 'claude-sonnet-4-5', // cloud model
      offline_image_analysis_model: 'llava:latest',    // local model
    });
    const tasks = new OneShotTasks(registry, chatEngine, createMockMediaEngine());

    // resolveModel spy — let it throw to short-circuit the generateText call
    const resolveModelSpy = vi.spyOn(registry, 'resolveModel')
      .mockImplementation(() => { throw new Error('mock-stop'); });

    await tasks.analyzeMediaImage('media-1', 'en');

    expect(resolveModelSpy).toHaveBeenCalledWith('llava:latest');
  });

  it('analyzeMediaImage returns error when offline with no offline model configured', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({
      chat_image_analysis_model: 'claude-sonnet-4-5',
      // No offline_image_analysis_model set
    });
    const tasks = new OneShotTasks(registry, chatEngine, createMockMediaEngine());

    const result = await tasks.analyzeMediaImage('media-1', 'en');

    expect(result.success).toBe(false);
    expect(result.error).toContain('offline');
  });

  it('analyzeMediaImage uses default model when NOT offline', async () => {
    registry.setOpencodeKey('test-key');
    // Offline mode is OFF

    const chatEngine = createMockChatEngine({
      chat_image_analysis_model: 'claude-sonnet-4-5',
      offline_image_analysis_model: 'llava:latest',
    });
    const tasks = new OneShotTasks(registry, chatEngine, createMockMediaEngine());

    const resolveModelSpy = vi.spyOn(registry, 'resolveModel')
      .mockImplementation(() => { throw new Error('mock-stop'); });

    await tasks.analyzeMediaImage('media-1', 'en');

    // Should use the regular model, NOT the offline one
    expect(resolveModelSpy).toHaveBeenCalledWith('claude-sonnet-4-5');
  });
});

// ---------------------------------------------------------------------------
// ChatService — sendMessage offline fallback
// ---------------------------------------------------------------------------

describe('ChatService offline model fallback', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3:latest');
  });

  it('sendMessage swaps cloud model for offline_chat_model when airplane mode is on', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({
      offline_chat_model: 'llama3:latest',
    });
    chatEngine.getConversation = vi.fn(async () => ({
      id: 'conv-1',
      title: 'Test',
      model: 'claude-sonnet-4', // cloud model on conversation
      createdAt: new Date(),
      messages: [],
    }));

    const service = new ChatService(
      chatEngine,
      registry,
      {} as never,
      () => null,
    );
    mockModelCatalog(registry);

    // resolveModel spy — let it throw to short-circuit
    const resolveModelSpy = vi.spyOn(registry, 'resolveModel')
      .mockImplementation(() => { throw new Error('mock-stop'); });

    const result = await service.sendMessage('conv-1', 'Hello', {});

    // Model swap should have happened before resolveModel was called
    expect(resolveModelSpy).toHaveBeenCalledWith('llama3:latest');
    expect(result.success).toBe(false); // throws mock-stop in try/catch
  });

  it('sendMessage returns error when offline with no offline_chat_model configured', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({
      // No offline_chat_model set
    });
    chatEngine.getConversation = vi.fn(async () => ({
      id: 'conv-1',
      title: 'Test',
      model: 'claude-sonnet-4',
      createdAt: new Date(),
      messages: [],
    }));

    const service = new ChatService(
      chatEngine,
      registry,
      {} as never,
      () => null,
    );

    const result = await service.sendMessage('conv-1', 'Hello', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('offline');
  });

  it('sendMessage keeps local model when conversation already uses local model and offline', async () => {
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({});
    chatEngine.getConversation = vi.fn(async () => ({
      id: 'conv-1',
      title: 'Test',
      model: 'llama3:latest', // already a local model
      createdAt: new Date(),
      messages: [],
    }));

    const service = new ChatService(
      chatEngine,
      registry,
      {} as never,
      () => null,
    );
    mockModelCatalog(registry);

    const resolveModelSpy = vi.spyOn(registry, 'resolveModel')
      .mockImplementation(() => { throw new Error('mock-stop'); });

    await service.sendMessage('conv-1', 'Hello', {});

    // Should use the local model directly, no swap needed
    expect(resolveModelSpy).toHaveBeenCalledWith('llama3:latest');
  });
});

// ---------------------------------------------------------------------------
// ChatService — generateConversationTitle offline fallback
// ---------------------------------------------------------------------------

describe('ChatService title generation offline fallback', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3:latest');
  });

  it('title generation silently skips when offline with no offline_title_model', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);

    const chatEngine = createMockChatEngine({
      chat_title_model: 'claude-haiku-4-5', // cloud model
      // No offline_title_model set
    });
    chatEngine.getConversation = vi.fn(async () => ({
      id: 'conv-1',
      title: 'Test',
      model: 'llama3:latest', // local model for chat
      createdAt: new Date(),
      messages: [],
    }));

    const service = new ChatService(
      chatEngine,
      registry,
      {} as never,
      () => null,
    );
    mockModelCatalog(registry);

    // resolveModel used for chat model; title generation should be skipped
    const resolveModelSpy = vi.spyOn(registry, 'resolveModel')
      .mockImplementation(() => { throw new Error('mock-stop'); });

    await service.sendMessage('conv-1', 'Hello', {});

    // resolveModel should only be called once — for the chat model, not for title
    // (title generation is skipped silently when offline with no offline_title_model)
    const calls = resolveModelSpy.mock.calls;
    expect(calls.some(c => c[0] === 'claude-haiku-4-5')).toBe(false);
  });
});
