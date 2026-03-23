/**
 * Chat IPC handlers — AI chat via AI SDK v6.
 *
 * Uses ProviderRegistry, ChatService, and OneShotTasks.
 */

import { ipcMain, BrowserWindow, net } from 'electron';
import { ChatEngine } from '../engine/ChatEngine';
import { SecureKeyStore } from '../engine/SecureKeyStore';
import { ProviderRegistry } from '../engine/ai/providers';
import { ChatService } from '../engine/ai/chat';
import { OneShotTasks } from '../engine/ai/tasks';
import { retryWithBackoff } from '../engine/ai/retry';
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

function requireEngineBundle(): EngineBundle {
  if (!engineBundle) {
    throw new Error('Chat handlers not initialized');
  }
  return engineBundle;
}

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
 * Check whether airplane (offline) mode is currently active.
 * Exported so other handler modules can guard network operations.
 */
export function isOfflineModeActive(): boolean {
  return getProviders().isOfflineMode();
}

/**
 * Get the ChatService (lazy-init).
 */
function getChatService(): ChatService {
  if (!chatService) {
    const engine = getChatEngine();
    const reg = getProviders();
    const bundle = requireEngineBundle();
    const deps: BlogToolDeps = {
      postEngine: bundle.postEngine,
      mediaEngine: bundle.mediaEngine,
      postMediaEngine: bundle.postMediaEngine,
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
    const bundle = requireEngineBundle();
    oneShotTasks = new OneShotTasks(getProviders(), getChatEngine(), bundle.mediaEngine, bundle.postEngine);
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
        if (key) {
          reg.setOpencodeKey(key);
        }
      } catch { /* ignore */ }

      try {
        const mistralKey = await keyStore.retrieve('mistral_api_key');
        if (mistralKey) {
          reg.setMistralKey(mistralKey);
        }
      } catch { /* ignore */ }

      // Restore Ollama enabled state from settings DB
      try {
        const ollamaEnabled = await getChatEngine().getSetting('ollama_enabled');
        if (ollamaEnabled === 'true') {
          reg.setOllamaEnabled(true);
        }
      } catch { /* ignore */ }

      // Restore Ollama model capability overrides
      try {
        const capsJson = await getChatEngine().getSetting('ollama_model_capabilities');
        if (capsJson) {
          const caps = JSON.parse(capsJson) as Record<string, { tools: boolean; vision: boolean }>;
          reg.loadOllamaModelCapabilities(caps);
        }
      } catch { /* ignore */ }

      // Restore known Ollama model IDs (so offline mode works without a fresh fetch)
      try {
        const ollamaIds = await getChatEngine().getSetting('ollama_known_model_ids');
        if (ollamaIds) {
          for (const id of JSON.parse(ollamaIds) as string[]) {
            reg.registerOllamaModel(id);
          }
        }
      } catch { /* ignore */ }

      // Restore LM Studio enabled state from settings DB
      try {
        const lmstudioEnabled = await getChatEngine().getSetting('lmstudio_enabled');
        if (lmstudioEnabled === 'true') {
          reg.setLmstudioEnabled(true);
        }
      } catch { /* ignore */ }

      // Restore LM Studio model capability overrides
      try {
        const lmCapsJson = await getChatEngine().getSetting('lmstudio_model_capabilities');
        if (lmCapsJson) {
          const caps = JSON.parse(lmCapsJson) as Record<string, { tools: boolean; vision: boolean }>;
          reg.loadLmstudioModelCapabilities(caps);
        }
      } catch { /* ignore */ }

      // Restore known LM Studio model IDs (so offline mode works without a fresh fetch)
      try {
        const lmIds = await getChatEngine().getSetting('lmstudio_known_model_ids');
        if (lmIds) {
          for (const id of JSON.parse(lmIds) as string[]) {
            reg.registerLmstudioModel(id);
          }
        }
      } catch { /* ignore */ }

      // Restore offline mode from settings or auto-detect via OS network status
      try {
        const savedOffline = await getChatEngine().getSetting('offline_mode');
        if (savedOffline === 'true') {
          reg.setOfflineMode(true);
        } else if (savedOffline === null || savedOffline === undefined) {
          // No explicit preference saved — auto-detect using Electron net API
          const online = net.isOnline();
          if (!online && (reg.getProviderStatus().ollama || reg.getProviderStatus().lmstudio)) {
            reg.setOfflineMode(true);
            await getChatEngine().setSetting('offline_mode', 'true');
          }
        }
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
      if (!key) {
        return { hasKey: false, maskedKey: '' };
      }
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
      if (!key) {
        return { hasKey: false, maskedKey: '' };
      }
      const masked = '•'.repeat(Math.max(0, key.length - 4)) + key.slice(-4);
      return { hasKey: true, maskedKey: masked };
    } catch (error) {
      console.error('[Chat IPC] Error getting Mistral API key:', error);
      return { hasKey: false, maskedKey: '' };
    }
  });

  // ============ Ollama (Local) ============

  // Get Ollama enabled state
  ipcMain.handle('chat:getOllamaEnabled', async () => {
    try {
      await ensureInitialized();
      return getProviders().isOllamaEnabled();
    } catch (error) {
      console.error('[Chat IPC] Error getting Ollama enabled state:', error);
      return false;
    }
  });

  // Set Ollama enabled state
  ipcMain.handle('chat:setOllamaEnabled', async (_, enabled: boolean) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      reg.setOllamaEnabled(enabled);

      // Persist to settings DB
      await getChatEngine().setSetting('ollama_enabled', enabled ? 'true' : 'false');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting Ollama enabled state:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get Ollama models (probe local server)
  ipcMain.handle('chat:getOllamaModels', async () => {
    try {
      await ensureInitialized();
      return await getProviders().fetchOllamaModels();
    } catch (error) {
      console.error('[Chat IPC] Error fetching Ollama models:', error);
      return [];
    }
  });

  // Get Ollama model capability overrides
  ipcMain.handle('chat:getOllamaModelCapabilities', async () => {
    try {
      await ensureInitialized();
      return getProviders().getAllOllamaModelCapabilities();
    } catch (error) {
      console.error('[Chat IPC] Error getting Ollama model capabilities:', error);
      return {};
    }
  });

  // Set capability overrides for a single Ollama model
  ipcMain.handle('chat:setOllamaModelCapabilities', async (_, modelId: string, caps: { tools: boolean; vision: boolean }) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      reg.setOllamaModelCapabilities(modelId, caps);

      // Persist all capabilities to settings DB
      const allCaps = reg.getAllOllamaModelCapabilities();
      await getChatEngine().setSetting('ollama_model_capabilities', JSON.stringify(allCaps));
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting Ollama model capabilities:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ LM Studio (Local) ============

  // Get LM Studio enabled state
  ipcMain.handle('chat:getLmstudioEnabled', async () => {
    try {
      await ensureInitialized();
      return getProviders().isLmstudioEnabled();
    } catch (error) {
      console.error('[Chat IPC] Error getting LM Studio enabled state:', error);
      return false;
    }
  });

  // Set LM Studio enabled state
  ipcMain.handle('chat:setLmstudioEnabled', async (_, enabled: boolean) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      reg.setLmstudioEnabled(enabled);

      // Persist to settings DB
      await getChatEngine().setSetting('lmstudio_enabled', enabled ? 'true' : 'false');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting LM Studio enabled state:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get LM Studio models (probe local server)
  ipcMain.handle('chat:getLmstudioModels', async () => {
    try {
      await ensureInitialized();
      return await getProviders().fetchLmstudioModels();
    } catch (error) {
      console.error('[Chat IPC] Error fetching LM Studio models:', error);
      return [];
    }
  });

  // Get LM Studio model capability overrides
  ipcMain.handle('chat:getLmstudioModelCapabilities', async () => {
    try {
      await ensureInitialized();
      return getProviders().getAllLmstudioModelCapabilities();
    } catch (error) {
      console.error('[Chat IPC] Error getting LM Studio model capabilities:', error);
      return {};
    }
  });

  // Set capability overrides for a single LM Studio model
  ipcMain.handle('chat:setLmstudioModelCapabilities', async (_, modelId: string, caps: { tools: boolean; vision: boolean }) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      reg.setLmstudioModelCapabilities(modelId, caps);

      // Persist all capabilities to settings DB
      const allCaps = reg.getAllLmstudioModelCapabilities();
      await getChatEngine().setSetting('lmstudio_model_capabilities', JSON.stringify(allCaps));
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting LM Studio model capabilities:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Offline / Airplane Mode ============

  ipcMain.handle('chat:getOfflineMode', async () => {
    try {
      await ensureInitialized();
      return getProviders().isOfflineMode();
    } catch (error) {
      console.error('[Chat IPC] Error getting offline mode:', error);
      return false;
    }
  });

  ipcMain.handle('chat:setOfflineMode', async (_, enabled: boolean) => {
    try {
      await ensureInitialized();
      const reg = getProviders();
      reg.setOfflineMode(enabled);
      await getChatEngine().setSetting('offline_mode', enabled ? 'true' : 'false');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting offline mode:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('chat:getKnownLocalModels', async () => {
    try {
      await ensureInitialized();
      return getProviders().getKnownLocalModels();
    } catch (error) {
      console.error('[Chat IPC] Error getting known local models:', error);
      return [];
    }
  });

  ipcMain.handle('chat:getOfflineChatModel', async () => {
    try {
      const model = await getChatEngine().getSetting('offline_chat_model');
      return { success: true, modelId: model || null };
    } catch (error) {
      console.error('[Chat IPC] Error getting offline chat model:', error);
      return { success: false, modelId: null };
    }
  });

  ipcMain.handle('chat:setOfflineChatModel', async (_, modelId: string | null) => {
    try {
      await getChatEngine().setSetting('offline_chat_model', modelId ?? '');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting offline chat model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('chat:getOfflineTitleModel', async () => {
    try {
      const model = await getChatEngine().getSetting('offline_title_model');
      return { success: true, modelId: model || null };
    } catch (error) {
      console.error('[Chat IPC] Error getting offline title model:', error);
      return { success: false, modelId: null };
    }
  });

  ipcMain.handle('chat:setOfflineTitleModel', async (_, modelId: string | null) => {
    try {
      await getChatEngine().setSetting('offline_title_model', modelId ?? '');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting offline title model:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('chat:getOfflineImageAnalysisModel', async () => {
    try {
      const model = await getChatEngine().getSetting('offline_image_analysis_model');
      return { success: true, modelId: model || null };
    } catch (error) {
      console.error('[Chat IPC] Error getting offline image analysis model:', error);
      return { success: false, modelId: null };
    }
  });

  ipcMain.handle('chat:setOfflineImageAnalysisModel', async (_, modelId: string | null) => {
    try {
      await getChatEngine().setSetting('offline_image_analysis_model', modelId ?? '');
      return { success: true };
    } catch (error) {
      console.error('[Chat IPC] Error setting offline image analysis model:', error);
      return { success: false, error: (error as Error).message };
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
      const reg = getProviders();
      const models = await reg.getAvailableModels();
      const engine = getChatEngine();
      const selectedModel = await engine.getSelectedModel();

      // Persist known local model IDs so offline mode survives restarts
      const ollamaModels = models.filter(m => m.provider === 'ollama').map(m => m.id);
      const lmstudioModels = models.filter(m => m.provider === 'lmstudio').map(m => m.id);
      if (ollamaModels.length > 0) {
        await engine.setSetting('ollama_known_model_ids', JSON.stringify(ollamaModels)).catch(() => {});
      }
      if (lmstudioModels.length > 0) {
        await engine.setSetting('lmstudio_known_model_ids', JSON.stringify(lmstudioModels)).catch(() => {});
      }

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
  ipcMain.handle('chat:sendMessage', async (_, conversationId: string, message: string, metadata?: { surface?: 'tab' | 'sidebar' }) => {
    try {
      void metadata;
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

  // ============ Post Language Detection ============

  // Detect the language of a post from its title and content
  ipcMain.handle('chat:detectPostLanguage', async (_, title: string, content: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().detectPostLanguage(title, content);
    } catch (error) {
      console.error('[Chat IPC] Error detecting post language:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Post Analysis ============

  // Analyze a post and suggest title, excerpt, and slug using AI
  ipcMain.handle('chat:analyzePost', async (_, postId: string, language?: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().analyzePost(postId, language || 'en');
    } catch (error) {
      console.error('[Chat IPC] Error analyzing post:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Translate a post and persist/update its translation record
  ipcMain.handle('chat:translatePost', async (_, postId: string, targetLanguage: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().translatePost(postId, targetLanguage || 'en');
    } catch (error) {
      console.error('[Chat IPC] Error translating post:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Media Language Detection ============

  // Detect the language of media metadata (title, alt, caption)
  ipcMain.handle('chat:detectMediaLanguage', async (_, title: string, alt: string, caption: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().detectMediaLanguage(title, alt, caption);
    } catch (error) {
      console.error('[Chat IPC] Error detecting media language:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Media Metadata Translation ============

  // Translate media metadata (title, alt, caption) into a target language
  ipcMain.handle('chat:translateMediaMetadata', async (_, mediaId: string, targetLanguage: string) => {
    try {
      await ensureInitialized();
      return await getOneShotTasks().translateMediaMetadata(mediaId, targetLanguage);
    } catch (error) {
      console.error('[Chat IPC] Error translating media metadata:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ A2UI Actions ============

  ipcMain.handle('a2ui:dispatch', async (_, action: { surfaceId: string; componentId: string; action: string; payload?: Record<string, unknown> }) => {
    try {
      void action;
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
 * Translate a post for auto-translation workflows (called from event handlers).
 * Returns the result of translatePost or an error object if AI is not initialized.
 */
export async function autoTranslatePost(postId: string, targetLanguage: string, options?: { autoPublish?: boolean }): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    await ensureInitialized();
    return await retryWithBackoff(() => getOneShotTasks().translatePost(postId, targetLanguage, options));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Analyze a media image for auto-analysis workflows (called from IPC handlers).
 */
export async function autoAnalyzeMediaImage(mediaId: string, language: string): Promise<{ success: boolean; title?: string; alt?: string; caption?: string; error?: string }> {
  try {
    await ensureInitialized();
    return await retryWithBackoff(() => getOneShotTasks().analyzeMediaImage(mediaId, language));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Translate media metadata for auto-translation workflows (called from event handlers).
 */
export async function autoTranslateMediaMetadata(mediaId: string, targetLanguage: string): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureInitialized();
    return await retryWithBackoff(() => getOneShotTasks().translateMediaMetadata(mediaId, targetLanguage));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
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
