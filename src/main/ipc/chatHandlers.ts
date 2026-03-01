/**
 * Chat IPC handlers — AI chat via AI SDK v6.
 *
 * Uses ProviderRegistry, ChatService, and OneShotTasks instead of OpenCodeManager.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ChatEngine } from '../engine/ChatEngine';
import { SecureKeyStore } from '../engine/SecureKeyStore';
import { ProviderRegistry } from '../engine/ai/providers';
import { ChatService } from '../engine/ai/chat';
import { OneShotTasks } from '../engine/ai/tasks';
import { getDatabase } from '../database';
import type { EngineBundle } from '../engine/EngineBundle';
import type { BlogToolDeps } from '../engine/ai/blog-tools';

let chatEngine: ChatEngine | null = null;
let secureKeyStore: SecureKeyStore | null = null;
let providers: ProviderRegistry | null = null;
let chatService: ChatService | null = null;
let oneShotTasks: OneShotTasks | null = null;
let initPromise: Promise<void> | null = null;
let mainWindowGetter: (() => BrowserWindow | null) | null = null;
let engineBundle: EngineBundle | null = null;

/**
 * Get or create the SecureKeyStore instance.
 */
function getSecureKeyStore(): SecureKeyStore {
  if (!secureKeyStore) {
    secureKeyStore = new SecureKeyStore(getChatEngine());
  }
  return secureKeyStore;
}

/**
 * Initialize chat handlers with the main window reference
 */
export function initializeChatHandlers(getMainWindow: () => BrowserWindow | null, bundle: EngineBundle): void {
  mainWindowGetter = getMainWindow;
  engineBundle = bundle;
}

/**
 * Get or create the ChatEngine instance
 */
function getChatEngine(): ChatEngine {
  if (!chatEngine) {
    chatEngine = new ChatEngine(getDatabase());
  }
  return chatEngine;
}

/**
 * Get the ProviderRegistry (lazy-init + load keys from encrypted storage).
 */
function getProviders(): ProviderRegistry {
  if (!providers) {
    providers = new ProviderRegistry();
  }
  return providers;
}

/**
 * Get the ChatService (lazy-init).
 */
function getChatService(): ChatService {
  if (!chatService) {
    const engine = getChatEngine();
    const reg = getProviders();
    const deps: BlogToolDeps = {
      postEngine: engineBundle!.postEngine,
      mediaEngine: engineBundle!.mediaEngine,
      postMediaEngine: engineBundle!.postMediaEngine,
    };
    chatService = new ChatService(engine, reg, deps, () => mainWindowGetter?.() || null);
  }
  return chatService;
}

/**
 * Get the OneShotTasks helper (lazy-init).
 */
function getOneShotTasks(): OneShotTasks {
  if (!oneShotTasks) {
    oneShotTasks = new OneShotTasks(getProviders(), getChatEngine(), engineBundle!.mediaEngine);
  }
  return oneShotTasks;
}

/**
 * Ensure API keys are loaded from encrypted storage exactly once.
 */
async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    const reg = getProviders();
    const keyStore = getSecureKeyStore();

    initPromise = (async () => {
      // Clean up old plain-text key from settings (pre-keychain storage)
      try { await keyStore.cleanupPlainTextKey('opencode_api_key'); } catch { /* best-effort */ }

      try {
        const key = await keyStore.retrieve('opencode_api_key');
        if (key) reg.setOpencodeKey(key);
      } catch { /* ignore */ }

      try {
        const mistralKey = await keyStore.retrieve('mistral_api_key');
        if (mistralKey) reg.setMistralKey(mistralKey);
      } catch { /* ignore */ }
    })();
  }
  await initPromise;
}

/**
 * Register all chat-related IPC handlers
 */
export function registerChatHandlers(): void {
  // ============ API Key & Status ============

  // Check if service is ready
  ipcMain.handle('chat:checkReady', async () => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      const ready = reg.isReady();
      return {
        ready,
        error: ready ? undefined : 'API key not configured',
        backend: 'opencode',
        providers: reg.getProviderStatus(),
      };
    } catch (error) {
      console.error('[Chat IPC] Error checking ready:', error);
      return { ready: false, error: (error as Error).message };
    }
  });

  // Validate API key
  ipcMain.handle('chat:validateApiKey', async (_, apiKey: string) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      return await reg.validateOpencodeKey(apiKey);
    } catch (error) {
      console.error('[Chat IPC] Error validating API key:', error);
      return { isValid: false, models: [] };
    }
  });

  // Set API key
  ipcMain.handle('chat:setApiKey', async (_, apiKey: string) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      const previousKey = reg.getOpencodeKey();
      reg.setOpencodeKey(apiKey);

      // Persist to encrypted storage — roll back in-memory key on failure
      try {
        await getSecureKeyStore().store('opencode_api_key', apiKey);
      } catch (storeError) {
        reg.setOpencodeKey(previousKey);
        throw storeError;
      }

      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting API key:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get API key (masked)
  ipcMain.handle('chat:getApiKey', async () => {
    try {
      await ensureInitialized();
      const key = getProviders().getOpencodeKey();
      if (!key) return { hasKey: false, maskedKey: '' };
      const masked = '•'.repeat(Math.max(0, key.length - 4)) + key.slice(-4);
      return { hasKey: true, maskedKey: masked };
    } catch (error) {
      console.error('[Chat IPC] Error getting API key:', error);
      return { hasKey: false, maskedKey: '' };
    }
  });

  // ============ Mistral API Key ============

  // Validate Mistral API key
  ipcMain.handle('chat:validateMistralApiKey', async (_, apiKey: string) => {
    try {
      await ensureInitialized();
      return await getProviders().validateMistralKey(apiKey);
    } catch (error) {
      console.error('[Chat IPC] Error validating Mistral API key:', error);
      return { isValid: false, models: [] };
    }
  });

  // Set Mistral API key
  ipcMain.handle('chat:setMistralApiKey', async (_, apiKey: string) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      const previousKey = reg.getMistralKey();
      reg.setMistralKey(apiKey);

      // Persist to encrypted storage — roll back in-memory key on failure
      try {
        await getSecureKeyStore().store('mistral_api_key', apiKey);
      } catch (storeError) {
        reg.setMistralKey(previousKey);
        throw storeError;
      }

      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting Mistral API key:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get Mistral API key (masked)
  ipcMain.handle('chat:getMistralApiKey', async () => {
    try {
      await ensureInitialized();
      const key = getProviders().getMistralKey();
      if (!key) return { hasKey: false, maskedKey: '' };
      const masked = '•'.repeat(Math.max(0, key.length - 4)) + key.slice(-4);
      return { hasKey: true, maskedKey: masked };
    } catch (error) {
      console.error('[Chat IPC] Error getting Mistral API key:', error);
      return { hasKey: false, maskedKey: '' };
    }
  });

  // ============ Per-Purpose Model Preferences ============

  // Get title generation model
  ipcMain.handle('chat:getTitleModel', async () => {
    try {
      const engine = getChatEngine();
      const model = await engine.getSetting('chat_title_model');
      return { success: true, modelId: model || null };
    } catch (error) {
      console.error('[Chat IPC] Error getting title model:', error);
      return { success: false, modelId: null };
    }
  });

  // Set title generation model
  ipcMain.handle('chat:setTitleModel', async (_, modelId: string) => {
    try {
      const engine = getChatEngine();
      await engine.setSetting('chat_title_model', modelId);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting title model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get image analysis model
  ipcMain.handle('chat:getImageAnalysisModel', async () => {
    try {
      const engine = getChatEngine();
      const model = await engine.getSetting('chat_image_analysis_model');
      return { success: true, modelId: model || null };
    } catch (error) {
      console.error('[Chat IPC] Error getting image analysis model:', error);
      return { success: false, modelId: null };
    }
  });

  // Set image analysis model
  ipcMain.handle('chat:setImageAnalysisModel', async (_, modelId: string) => {
    try {
      const engine = getChatEngine();
      await engine.setSetting('chat_image_analysis_model', modelId);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting image analysis model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Chat Settings ============

  // Get available models
  ipcMain.handle('chat:getAvailableModels', async () => {
    try {
      await ensureInitialized();
      const models = await getProviders().getAvailableModels();
      const engine = getChatEngine();
      const selectedModel = await engine.getSelectedModel();
      return { success: true, models, selectedModel };
    } catch (error) {
      console.error('[Chat IPC] Error getting models:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Set default model
  ipcMain.handle('chat:setDefaultModel', async (_, modelId: string) => {
    try {
      const engine = getChatEngine();
      await engine.setSelectedModel(modelId);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get system prompt
  ipcMain.handle('chat:getSystemPrompt', async () => {
    try {
      const engine = getChatEngine();
      const prompt = await engine.getDefaultSystemPrompt();
      return { success: true, prompt };
    } catch (error) {
      console.error('[Chat IPC] Error getting system prompt:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Set system prompt
  ipcMain.handle('chat:setSystemPrompt', async (_, prompt: string) => {
    try {
      const engine = getChatEngine();
      await engine.setDefaultSystemPrompt(prompt);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting system prompt:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Model Catalog ============

  // Refresh model catalog from models.dev (conditional GET with ETag)
  ipcMain.handle('chat:refreshModelCatalog', async () => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      const result = await reg.getModelCatalogEngine().refresh();
      // Invalidate the in-memory model cache so vision/name data
      // from the freshly populated catalog is picked up immediately.
      reg.invalidateModelCache();
      return result;
    } catch (error) {
      console.error('[Chat IPC] Error refreshing model catalog:', error);
      return { success: false, modelsUpdated: 0, error: (error as Error).message };
    }
  });

  // Get all model catalog entries
  ipcMain.handle('chat:getModelCatalog', async () => {
    try {
      await ensureInitialized();
      const entries = await getProviders().getModelCatalogEngine().getAll();
      return { success: true, entries };
    } catch (error) {
      console.error('[Chat IPC] Error getting model catalog:', error);
      return { success: false, entries: [], error: (error as Error).message };
    }
  });

  // ============ Conversation CRUD ============

  // Get all conversations
  ipcMain.handle('chat:getConversations', async () => {
    try {
      const engine = getChatEngine();
      return await engine.getRecentConversations();
    } catch (error) {
      console.error('[Chat IPC] Error getting conversations:', error);
      return [];
    }
  });

  // Create new conversation
  ipcMain.handle('chat:createConversation', async (_, title?: string, model?: string) => {
    try {
      const engine = getChatEngine();
      const systemPrompt = await engine.getDefaultSystemPrompt();
      const selectedModel = model || (await engine.getSelectedModel());

      const conversation = await engine.createConversation({
        title: title || 'New Chat',
        model: selectedModel,
        systemPrompt,
      });

      return conversation;
    } catch (error) {
      console.error('[Chat IPC] Error creating conversation:', error);
      return { error: (error as Error).message };
    }
  });

  // Get conversation by ID
  ipcMain.handle('chat:getConversation', async (_, id: string) => {
    try {
      const engine = getChatEngine();
      return await engine.getConversation(id);
    } catch (error) {
      console.error('[Chat IPC] Error getting conversation:', error);
      return null;
    }
  });

  // Update conversation
  ipcMain.handle('chat:updateConversation', async (_, id: string, updates: { title?: string; model?: string }) => {
    try {
      const engine = getChatEngine();
      await engine.updateConversation(id, updates);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error updating conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Delete conversation
  ipcMain.handle('chat:deleteConversation', async (_, id: string) => {
    try {
      const engine = getChatEngine();
      await engine.deleteConversation(id);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error deleting conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Chat Messaging ============

  // Send a message
  ipcMain.handle('chat:sendMessage', async (_, conversationId: string, message: string, _metadata?: { surface?: 'tab' | 'sidebar' }) => {
    try {
      await ensureInitialized();
      const service = getChatService();
      const mainWindow = mainWindowGetter?.();

      const result = await service.sendMessage(conversationId, message, {
        onDelta: (delta) => {
          if (mainWindow) {
            mainWindow.webContents.send('chat-stream-delta', { conversationId, delta });
          }
        },
        onToolCall: (toolCall) => {
          if (mainWindow) {
            mainWindow.webContents.send('chat-tool-call', { conversationId, toolCall });
          }
        },
        onToolResult: (result) => {
          if (mainWindow) {
            mainWindow.webContents.send('chat-tool-result', { conversationId, result });
          }
        },
        onA2UIMessage: (message) => {
          if (mainWindow) {
            mainWindow.webContents.send('a2ui-message', { conversationId, message });
          }
        },
        onTokenUsage: (usage) => {
          if (mainWindow) {
            mainWindow.webContents.send('chat-token-usage', { conversationId, ...usage });
          }
        },
      });

      return result;
    } catch (error) {
      console.error('[Chat IPC] Error sending message:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('chat:addSystemEvent', async (_, conversationId: string, content: string) => {
    try {
      const engine = getChatEngine();
      await engine.addMessage({
        conversationId,
        role: 'system',
        content,
        createdAt: new Date(),
      });
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error adding system event:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Abort a running message
  ipcMain.handle('chat:abortMessage', async (_, conversationId: string) => {
    try {
      await ensureInitialized();
      return await getChatService().abortMessage(conversationId);
    } catch (error) {
      console.error('[Chat IPC] Error aborting message:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get message history for a conversation
  ipcMain.handle('chat:getHistory', async (_, conversationId: string) => {
    try {
      const engine = getChatEngine();
      return await engine.getMessages(conversationId);
    } catch (error) {
      console.error('[Chat IPC] Error getting history:', error);
      return [];
    }
  });

  // Clear messages from a conversation
  ipcMain.handle('chat:clearMessages', async (_, conversationId: string) => {
    try {
      const engine = getChatEngine();
      await engine.clearMessages(conversationId);
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error clearing messages:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Set conversation model
  ipcMain.handle('chat:setConversationModel', async (_, conversationId: string, modelId: string) => {
    try {
      const engine = getChatEngine();
      await engine.updateConversation(conversationId, { model: modelId });
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting conversation model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Taxonomy Analysis ============

  // Analyze taxonomy items (tags/categories) and suggest mappings
  ipcMain.handle('chat:analyzeTaxonomy', async (_, categories: Array<{ name: string; slug: string; existsInProject: boolean }>, tags: Array<{ name: string; slug: string; existsInProject: boolean }>, modelId: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().analyzeTaxonomy(categories, tags, modelId);
    } catch (error) {
      console.error('[Chat IPC] Error analyzing taxonomy:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Media Analysis ============

  // Analyze a media image and generate title, alt text, and caption
  ipcMain.handle('chat:analyzeMediaImage', async (_, mediaId: string, language?: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().analyzeMediaImage(mediaId, language || 'en');
    } catch (error) {
      console.error('[Chat IPC] Error analyzing media image:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ A2UI Actions ============

  ipcMain.handle('a2ui:dispatch', async (_, action: { surfaceId: string; componentId: string; action: string; payload?: Record<string, unknown> }) => {
    try {
      console.log('[Chat IPC] A2UI action dispatched:', action);
      // Currently, A2UI actions are handled client-side (navigation, UI toggles).
      // Server-side action handling can be added here in the future.
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error dispatching A2UI action:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

/**
 * Cleanup chat resources
 */
export async function cleanupChatHandlers(): Promise<void> {
  if (chatService) {
    await chatService.stop();
    chatService = null;
  }
  initPromise = null;
  providers = null;
  oneShotTasks = null;
  secureKeyStore = null;
  chatEngine = null;
}
