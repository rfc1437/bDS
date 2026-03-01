/**
 * Chat IPC handlers - AI chat functionality using OpenCode Zen API
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ChatEngine } from '../engine/ChatEngine';
import { OpenCodeManager } from '../engine/OpenCodeManager';
import { SecureKeyStore } from '../engine/SecureKeyStore';
import { getDatabase } from '../database';
import type { EngineBundle } from '../engine/EngineBundle';

let chatEngine: ChatEngine | null = null;
let openCodeManager: OpenCodeManager | null = null;
let secureKeyStore: SecureKeyStore | null = null;
let openCodeManagerInitPromise: Promise<void> | null = null;
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
 * Get or create the OpenCodeManager instance.
 * Returns a promise that resolves when the manager is fully initialized
 * (including loading the API key from settings).
 */
async function getOpenCodeManager(): Promise<OpenCodeManager> {
  if (!openCodeManager) {
    openCodeManager = new OpenCodeManager(
      getChatEngine(),
      engineBundle!.postEngine,
      engineBundle!.mediaEngine,
      engineBundle!.postMediaEngine,
      () => mainWindowGetter?.() || null
    );

    // Load API key from encrypted storage
    const keyStore = getSecureKeyStore();
    openCodeManagerInitPromise = (async () => {
      // Clean up old plain-text key from settings (pre-keychain storage)
      try {
        await keyStore.cleanupPlainTextKey('opencode_api_key');
      } catch {
        // Best-effort cleanup; not critical
      }

      // Load API key from encrypted storage
      try {
        const key = await keyStore.retrieve('opencode_api_key');
        if (key) {
          openCodeManager!.setApiKey(key);
        }
      } catch {
        // Silently ignore errors loading the key
      }
    })();
  }

  // Always wait for initialization to complete before returning
  if (openCodeManagerInitPromise) {
    await openCodeManagerInitPromise;
  }

  return openCodeManager;
}

/**
 * Register all chat-related IPC handlers
 */
export function registerChatHandlers(): void {
  // ============ API Key & Status ============

  // Check if service is ready
  ipcMain.handle('chat:checkReady', async () => {
    try {
      const manager = await getOpenCodeManager();
      const result = await manager.checkReady();
      return {
        ready: result.ready,
        error: result.error,
        backend: 'opencode',
      };
    } catch (error) {
      console.error('[Chat IPC] Error checking ready:', error);
      return { ready: false, error: (error as Error).message };
    }
  });

  // Validate API key
  ipcMain.handle('chat:validateApiKey', async (_, apiKey: string) => {
    try {
      const manager = await getOpenCodeManager();
      const result = await manager.validateApiKey(apiKey);
      return result;
    } catch (error) {
      console.error('[Chat IPC] Error validating API key:', error);
      return { isValid: false, models: [] };
    }
  });

  // Set API key
  ipcMain.handle('chat:setApiKey', async (_, apiKey: string) => {
    try {
      const manager = await getOpenCodeManager();
      const previousKey = manager.getApiKey();
      manager.setApiKey(apiKey);

      // Persist to encrypted storage — roll back in-memory key on failure
      try {
        await getSecureKeyStore().store('opencode_api_key', apiKey);
      } catch (storeError) {
        manager.setApiKey(previousKey);
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
      const manager = await getOpenCodeManager();
      const key = manager.getApiKey();
      if (!key) return { hasKey: false, maskedKey: '' };
      // Mask all but last 4 characters
      const masked = '•'.repeat(Math.max(0, key.length - 4)) + key.slice(-4);
      return { hasKey: true, maskedKey: masked };
    } catch (error) {
      console.error('[Chat IPC] Error getting API key:', error);
      return { hasKey: false, maskedKey: '' };
    }
  });

  // ============ Chat Settings ============

  // Get available models
  ipcMain.handle('chat:getAvailableModels', async () => {
    try {
      const manager = await getOpenCodeManager();
      const models = await manager.getAvailableModels();
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
      const manager = await getOpenCodeManager();
      const mainWindow = mainWindowGetter?.();

      const result = await manager.sendMessage(conversationId, message, {
        metadata,
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
      const manager = await getOpenCodeManager();
      return await manager.abortMessage(conversationId);
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
      const manager = await getOpenCodeManager();
      return await manager.analyzeTaxonomy(categories, tags, modelId);
    } catch (error) {
      console.error('[Chat IPC] Error analyzing taxonomy:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============ Media Analysis ============

  // Analyze a media image and generate title, alt text, and caption
  ipcMain.handle('chat:analyzeMediaImage', async (_, mediaId: string, language?: string) => {
    try {
      const manager = await getOpenCodeManager();
      return await manager.analyzeMediaImage(mediaId, language || 'en');
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
  if (openCodeManager) {
    await openCodeManager.stop();
    openCodeManager = null;
  }
  openCodeManagerInitPromise = null;
  secureKeyStore = null;
  chatEngine = null;
}
