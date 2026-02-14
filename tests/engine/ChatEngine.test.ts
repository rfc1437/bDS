/**
 * ChatEngine Unit Tests
 *
 * Tests the REAL ChatEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatEngine, ChatConversationData, ChatMessageData } from '../../src/main/engine/ChatEngine';

// Create mock data stores
const mockConversations = new Map<string, any>();
const mockMessages = new Map<number, any>();
const mockSettings = new Map<string, any>();
let messageIdCounter = 1;

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: any) {
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve([])),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => ({
        returning: vi.fn((returnSpec: any) => {
          // Handle message inserts with auto-increment ID
          if (data && data.conversationId && data.role) {
            const id = messageIdCounter++;
            mockMessages.set(id, { ...data, id });
            return Promise.resolve([{ id }]);
          }
          // Handle conversation inserts
          if (data && data.id && data.title) {
            mockConversations.set(data.id, data);
          }
          // Handle settings inserts
          if (data && data.key) {
            mockSettings.set(data.key, data);
          }
          return Promise.resolve([{ id: data?.id || 1 }]);
        }),
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

// Create mock DatabaseConnection
const mockDbConnection = {
  getLocal: vi.fn(() => mockLocalDb),
  getLocalClient: vi.fn(() => null),
  getRemote: vi.fn(() => null),
};

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('ChatEngine', () => {
  let chatEngine: ChatEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations.clear();
    mockMessages.clear();
    mockSettings.clear();
    messageIdCounter = 1;

    // Reset the mock implementations
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());
    vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
      values: vi.fn((data: any) => ({
        returning: vi.fn((returnSpec: any) => {
          if (data && data.conversationId && data.role) {
            const id = messageIdCounter++;
            mockMessages.set(id, { ...data, id });
            return Promise.resolve([{ id }]);
          }
          if (data && data.id && data.title) {
            mockConversations.set(data.id, data);
          }
          if (data && data.key) {
            mockSettings.set(data.key, data);
          }
          return Promise.resolve([{ id: data?.id || 1 }]);
        }),
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    }));

    chatEngine = new ChatEngine(mockDbConnection as any);
  });

  describe('Constructor', () => {
    it('should create a ChatEngine instance', () => {
      expect(chatEngine).toBeInstanceOf(ChatEngine);
    });

    it('should store database reference', () => {
      expect(mockDbConnection.getLocal).toBeDefined();
    });
  });

  describe('createConversation', () => {
    it('should create a conversation with default values', async () => {
      const result = await chatEngine.createConversation();

      expect(result.id).toMatch(/^chat_mock-uuid-/);
      expect(result.title).toBe('New Chat');
      expect(result.model).toBe('claude-sonnet-4');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should create conversation with custom title', async () => {
      const result = await chatEngine.createConversation({ title: 'My Custom Chat' });

      expect(result.title).toBe('My Custom Chat');
    });

    it('should create conversation with custom model', async () => {
      const result = await chatEngine.createConversation({ model: 'gpt-4-turbo' });

      expect(result.model).toBe('gpt-4-turbo');
    });

    it('should add system prompt as first message when provided', async () => {
      const systemPrompt = 'You are a helpful assistant.';
      await chatEngine.createConversation({ systemPrompt });

      // Should have called insert twice - once for conversation, once for message
      expect(mockLocalDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should insert conversation into database', async () => {
      await chatEngine.createConversation({ title: 'DB Test' });

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should set createdAt and updatedAt to same timestamp', async () => {
      const result = await chatEngine.createConversation();

      expect(result.createdAt.getTime()).toBe(result.updatedAt.getTime());
    });
  });

  describe('getConversation', () => {
    it('should return null for non-existent conversation', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]), // Return empty array
        });
        return chain;
      });

      const result = await chatEngine.getConversation('non-existent-id');

      expect(result).toBeNull();
    });

    it('should return conversation with messages', async () => {
      const conversationData = {
        id: 'chat_test-id',
        title: 'Test Conversation',
        model: 'claude-sonnet-4',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-15'),
      };

      const messageData = [
        { id: 1, conversationId: 'chat_test-id', role: 'user', content: 'Hello', createdAt: new Date() },
        { id: 2, conversationId: 'chat_test-id', role: 'assistant', content: 'Hi there!', createdAt: new Date() },
      ];

      let callCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        if (callCount === 0) {
          callCount++;
          // First call: conversation query
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([conversationData]),
          });
        } else {
          // Second call: messages query
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockReturnValue({
              ...chain,
              orderBy: vi.fn().mockResolvedValue(messageData),
            }),
          });
        }
        return chain;
      });

      const result = await chatEngine.getConversation('chat_test-id');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('chat_test-id');
      expect(result?.title).toBe('Test Conversation');
      expect(result?.messages).toHaveLength(2);
    });

    it('should handle null model gracefully', async () => {
      const conversationData = {
        id: 'chat_no-model',
        title: 'No Model',
        model: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let callCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        if (callCount === 0) {
          callCount++;
          // First call: conversation query
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([conversationData]),
          });
        } else {
          // Second call: messages query (empty)
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockReturnValue({
              ...chain,
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          });
        }
        return chain;
      });

      const result = await chatEngine.getConversation('chat_no-model');

      expect(result?.model).toBeUndefined();
    });
  });

  describe('getRecentConversations', () => {
    it('should return empty array when no conversations', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnValue({
            ...chain,
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        return chain;
      });

      const result = await chatEngine.getRecentConversations();

      expect(result).toEqual([]);
    });

    it('should return conversations sorted by updatedAt', async () => {
      const conversations = [
        { id: 'c1', title: 'Chat 1', model: 'claude-sonnet-4', createdAt: new Date(), updatedAt: new Date('2024-01-15') },
        { id: 'c2', title: 'Chat 2', model: 'gpt-4', createdAt: new Date(), updatedAt: new Date('2024-01-10') },
      ];

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnValue({
            ...chain,
            limit: vi.fn().mockResolvedValue(conversations),
          }),
        });
        return chain;
      });

      const result = await chatEngine.getRecentConversations();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
    });

    it('should respect limit parameter', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnValue({
            ...chain,
            limit: vi.fn((limitValue) => {
              expect(limitValue).toBe(10);
              return Promise.resolve([]);
            }),
          }),
        });
        return chain;
      });

      await chatEngine.getRecentConversations(10);

      expect(mockLocalDb.select).toHaveBeenCalled();
    });

    it('should use default limit of 50', async () => {
      let capturedLimit: number | undefined;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnValue({
            ...chain,
            limit: vi.fn((limitValue) => {
              capturedLimit = limitValue;
              return Promise.resolve([]);
            }),
          }),
        });
        return chain;
      });

      await chatEngine.getRecentConversations();

      expect(capturedLimit).toBe(50);
    });
  });

  describe('updateConversation', () => {
    it('should update conversation title', async () => {
      let capturedUpdate: any;
      vi.mocked(mockLocalDb.update).mockImplementation(() => ({
        set: vi.fn((data) => {
          capturedUpdate = data;
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      await chatEngine.updateConversation('chat_123', { title: 'New Title' });

      expect(capturedUpdate.title).toBe('New Title');
      expect(capturedUpdate.updatedAt).toBeInstanceOf(Date);
    });

    it('should update conversation model', async () => {
      let capturedUpdate: any;
      vi.mocked(mockLocalDb.update).mockImplementation(() => ({
        set: vi.fn((data) => {
          capturedUpdate = data;
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      await chatEngine.updateConversation('chat_123', { model: 'gpt-4-turbo' });

      expect(capturedUpdate.model).toBe('gpt-4-turbo');
    });

    it('should always update updatedAt timestamp', async () => {
      let capturedUpdate: any;
      vi.mocked(mockLocalDb.update).mockImplementation(() => ({
        set: vi.fn((data) => {
          capturedUpdate = data;
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      const before = new Date();
      await chatEngine.updateConversation('chat_123', { title: 'Test' });
      const after = new Date();

      expect(capturedUpdate.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(capturedUpdate.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('deleteConversation', () => {
    it('should delete messages first', async () => {
      const deleteCalls: string[] = [];
      vi.mocked(mockLocalDb.delete).mockImplementation((table: any) => {
        const tableName = table?.constructor?.name || 'messages';
        deleteCalls.push(tableName);
        return {
          where: vi.fn().mockResolvedValue(undefined),
        } as any;
      });

      await chatEngine.deleteConversation('chat_123');

      // Should call delete twice (messages, then conversation)
      expect(mockLocalDb.delete).toHaveBeenCalledTimes(2);
    });

    it('should delete the conversation', async () => {
      await chatEngine.deleteConversation('chat_456');

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });
  });

  describe('addMessage', () => {
    it('should add user message', async () => {
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'user',
        content: 'Hello, AI!',
        createdAt: new Date(),
      });

      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello, AI!');
      expect(result.id).toBeDefined();
    });

    it('should add assistant message', async () => {
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'assistant',
        content: 'Hello! How can I help you?',
        createdAt: new Date(),
      });

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello! How can I help you?');
    });

    it('should add system message', async () => {
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'system',
        content: 'You are a helpful assistant.',
        createdAt: new Date(),
      });

      expect(result.role).toBe('system');
    });

    it('should add tool message with toolCallId', async () => {
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'tool',
        content: '{"result": "success"}',
        toolCallId: 'tool_call_abc123',
        createdAt: new Date(),
      });

      expect(result.role).toBe('tool');
      expect(result.toolCallId).toBe('tool_call_abc123');
    });

    it('should add message with toolCalls', async () => {
      const toolCalls = JSON.stringify([{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }]);
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'assistant',
        toolCalls,
        createdAt: new Date(),
      });

      expect(result.toolCalls).toBe(toolCalls);
    });

    it('should update conversation updatedAt timestamp', async () => {
      await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'user',
        content: 'Test message',
        createdAt: new Date(),
      });

      expect(mockLocalDb.update).toHaveBeenCalled();
    });

    it('should use provided createdAt or default to now', async () => {
      const specificDate = new Date('2024-06-15T10:30:00Z');
      const result = await chatEngine.addMessage({
        conversationId: 'chat_123',
        role: 'user',
        content: 'Test',
        createdAt: specificDate,
      });

      expect(result.createdAt).toEqual(specificDate);
    });
  });

  describe('getMessages', () => {
    it('should return empty array for conversation with no messages', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        });
        return chain;
      });

      const result = await chatEngine.getMessages('chat_empty');

      expect(result).toEqual([]);
    });

    it('should return messages in chronological order', async () => {
      const messages = [
        { id: 1, conversationId: 'chat_123', role: 'user', content: 'First', createdAt: new Date('2024-01-01') },
        { id: 2, conversationId: 'chat_123', role: 'assistant', content: 'Second', createdAt: new Date('2024-01-02') },
        { id: 3, conversationId: 'chat_123', role: 'user', content: 'Third', createdAt: new Date('2024-01-03') },
      ];

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockResolvedValue(messages),
          }),
        });
        return chain;
      });

      const result = await chatEngine.getMessages('chat_123');

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('First');
      expect(result[2].content).toBe('Third');
    });

    it('should handle null content gracefully', async () => {
      const messages = [
        { id: 1, conversationId: 'chat_123', role: 'assistant', content: null, toolCalls: '[...]', createdAt: new Date() },
      ];

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockResolvedValue(messages),
          }),
        });
        return chain;
      });

      const result = await chatEngine.getMessages('chat_123');

      expect(result[0].content).toBeUndefined();
    });
  });

  describe('clearMessages', () => {
    it('should delete all messages for conversation', async () => {
      await chatEngine.clearMessages('chat_123');

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should only delete messages (not the conversation)', async () => {
      let deleteCount = 0;
      vi.mocked(mockLocalDb.delete).mockImplementation(() => {
        deleteCount++;
        return {
          where: vi.fn().mockResolvedValue(undefined),
        } as any;
      });

      await chatEngine.clearMessages('chat_123');

      // Should only call delete once (for messages only)
      expect(deleteCount).toBe(1);
    });
  });

  describe('getDefaultSystemPrompt', () => {
    it('should return saved prompt if exists', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([{ value: 'Custom system prompt' }]),
        });
        return chain;
      });

      const result = await chatEngine.getDefaultSystemPrompt();

      expect(result).toBe('Custom system prompt');
    });

    it('should return built-in prompt when no saved prompt', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await chatEngine.getDefaultSystemPrompt();

      expect(result).toContain('Blogging Desktop Server');
      expect(result).toContain('Available Tools');
    });

    it('should return built-in prompt when saved prompt is empty', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([{ value: '' }]),
        });
        return chain;
      });

      const result = await chatEngine.getDefaultSystemPrompt();

      expect(result).toContain('Blogging Desktop Server');
    });
  });

  describe('setDefaultSystemPrompt', () => {
    it('should save custom prompt', async () => {
      let capturedValues: any;
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data) => {
          capturedValues = data;
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      await chatEngine.setDefaultSystemPrompt('My custom prompt');

      expect(capturedValues.key).toBe('chat_system_prompt');
      expect(capturedValues.value).toBe('My custom prompt');
    });

    it('should delete prompt when empty string provided', async () => {
      await chatEngine.setDefaultSystemPrompt('');

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should delete prompt when whitespace-only string provided', async () => {
      await chatEngine.setDefaultSystemPrompt('   ');

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });
  });

  describe('getSetting', () => {
    it('should return setting value when exists', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([{ value: 'setting_value' }]),
        });
        return chain;
      });

      const result = await chatEngine.getSetting('my_setting');

      expect(result).toBe('setting_value');
    });

    it('should return null when setting does not exist', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await chatEngine.getSetting('non_existent');

      expect(result).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('should insert or update setting', async () => {
      let capturedValues: any;
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data) => {
          capturedValues = data;
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      await chatEngine.setSetting('my_key', 'my_value');

      expect(capturedValues.key).toBe('my_key');
      expect(capturedValues.value).toBe('my_value');
      expect(capturedValues.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('getSelectedModel', () => {
    it('should return saved model when exists', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([{ value: 'gpt-4-turbo' }]),
        });
        return chain;
      });

      const result = await chatEngine.getSelectedModel();

      expect(result).toBe('gpt-4-turbo');
    });

    it('should return default model when not set', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await chatEngine.getSelectedModel();

      expect(result).toBe('claude-sonnet-4');
    });
  });

  describe('setSelectedModel', () => {
    it('should save selected model', async () => {
      let capturedValues: any;
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data) => {
          capturedValues = data;
          return {
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          };
        }),
      } as any));

      await chatEngine.setSelectedModel('claude-opus-4');

      expect(capturedValues.key).toBe('chat_model');
      expect(capturedValues.value).toBe('claude-opus-4');
    });
  });
});
