/**
 * ChatEngine - Manages AI chat sessions and message persistence
 * 
 * Responsible for:
 * - Creating, updating, and deleting chat conversations
 * - Storing and retrieving chat messages
 * - Managing conversation state (titles, models, etc.)
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseConnection } from '../database/connection';

export interface ChatConversationData {
  id: string;
  title: string;
  model?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageData {
  id?: number;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  toolCallId?: string;
  toolCalls?: string; // JSON array of tool calls
  createdAt: Date;
}

export interface CreateConversationInput {
  title?: string;
  model?: string;
  systemPrompt?: string;
}

export class ChatEngine {
  private db: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.db = database;
  }

  /**
   * Create a new chat conversation
   */
  async createConversation(input: CreateConversationInput = {}): Promise<ChatConversationData> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const id = `chat_${uuidv4()}`;
    const title = input.title || 'New Chat';
    const model = input.model || 'claude-sonnet-4';
    const now = Date.now();

    await client.execute({
      sql: `INSERT INTO chat_conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, title, model, now, now],
    });

    // Add system prompt as first message if provided
    if (input.systemPrompt) {
      await this.addMessage({
        conversationId: id,
        role: 'system',
        content: input.systemPrompt,
        createdAt: new Date(now),
      });
    }

    return {
      id,
      title,
      model,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Get a conversation by ID with all messages
   */
  async getConversation(id: string): Promise<(ChatConversationData & { messages: ChatMessageData[] }) | null> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const convResult = await client.execute({
      sql: `SELECT * FROM chat_conversations WHERE id = ?`,
      args: [id],
    });

    if (convResult.rows.length === 0) {
      return null;
    }

    const row = convResult.rows[0];
    const conversation: ChatConversationData = {
      id: row.id as string,
      title: row.title as string,
      model: row.model as string | undefined,
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    };

    const messagesResult = await client.execute({
      sql: `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      args: [id],
    });

    const messages: ChatMessageData[] = messagesResult.rows.map(r => ({
      id: r.id as number,
      conversationId: r.conversation_id as string,
      role: r.role as 'system' | 'user' | 'assistant' | 'tool',
      content: r.content as string | undefined,
      toolCallId: r.tool_call_id as string | undefined,
      toolCalls: r.tool_calls as string | undefined,
      createdAt: new Date(r.created_at as number),
    }));

    return { ...conversation, messages };
  }

  /**
   * Get all conversations, sorted by most recently updated
   */
  async getRecentConversations(limit: number = 50): Promise<ChatConversationData[]> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const result = await client.execute({
      sql: `SELECT * FROM chat_conversations ORDER BY updated_at DESC LIMIT ?`,
      args: [limit],
    });

    return result.rows.map(row => ({
      id: row.id as string,
      title: row.title as string,
      model: row.model as string | undefined,
      createdAt: new Date(row.created_at as number),
      updatedAt: new Date(row.updated_at as number),
    }));
  }

  /**
   * Update a conversation's metadata
   */
  async updateConversation(id: string, updates: Partial<Pick<ChatConversationData, 'title' | 'model'>>): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const setClauses: string[] = ['updated_at = ?'];
    const args: (string | number | null)[] = [Date.now()];

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      args.push(updates.title);
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?');
      args.push(updates.model);
    }

    args.push(id);

    await client.execute({
      sql: `UPDATE chat_conversations SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(id: string): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    // Messages are deleted via CASCADE, but let's be explicit
    await client.execute({
      sql: `DELETE FROM chat_messages WHERE conversation_id = ?`,
      args: [id],
    });

    await client.execute({
      sql: `DELETE FROM chat_conversations WHERE id = ?`,
      args: [id],
    });
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(message: Omit<ChatMessageData, 'id'>): Promise<ChatMessageData> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const createdAt = message.createdAt?.getTime() || Date.now();

    const result = await client.execute({
      sql: `INSERT INTO chat_messages (conversation_id, role, content, tool_call_id, tool_calls, created_at) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        message.conversationId,
        message.role,
        message.content || null,
        message.toolCallId || null,
        message.toolCalls || null,
        createdAt,
      ],
    });

    // Update conversation's updated_at timestamp
    await client.execute({
      sql: `UPDATE chat_conversations SET updated_at = ? WHERE id = ?`,
      args: [createdAt, message.conversationId],
    });

    return {
      id: Number(result.lastInsertRowid),
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      createdAt: new Date(createdAt),
    };
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string): Promise<ChatMessageData[]> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const result = await client.execute({
      sql: `SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      args: [conversationId],
    });

    return result.rows.map(r => ({
      id: r.id as number,
      conversationId: r.conversation_id as string,
      role: r.role as 'system' | 'user' | 'assistant' | 'tool',
      content: r.content as string | undefined,
      toolCallId: r.tool_call_id as string | undefined,
      toolCalls: r.tool_calls as string | undefined,
      createdAt: new Date(r.created_at as number),
    }));
  }

  /**
   * Clear all messages from a conversation (but keep the conversation)
   */
  async clearMessages(conversationId: string): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    await client.execute({
      sql: `DELETE FROM chat_messages WHERE conversation_id = ?`,
      args: [conversationId],
    });
  }

  /**
   * Get default system prompt for new conversations
   */
  async getDefaultSystemPrompt(): Promise<string> {
    const client = this.db.getLocalClient();
    if (!client) {
      return this.getBuiltInSystemPrompt();
    }

    const result = await client.execute({
      sql: `SELECT value FROM settings WHERE key = 'chat_system_prompt'`,
      args: [],
    });

    if (result.rows.length > 0) {
      return result.rows[0].value as string;
    }

    return this.getBuiltInSystemPrompt();
  }

  /**
   * Set default system prompt for new conversations
   */
  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const now = Date.now();
    await client.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['chat_system_prompt', prompt, now],
    });
  }

  /**
   * Get the built-in default system prompt
   */
  private getBuiltInSystemPrompt(): string {
    return `You are an AI assistant for the Blogging Desktop Server (bDS) application.
You help users manage their blog posts and media files.

You have access to tools that allow you to:
- Search for posts using full-text search with optional category/tag filters
- Read individual post content and metadata
- List and filter posts by status, category, or tags
- View information about media files (images)
- Update metadata for posts and media files
- List all tags with post counts
- List all categories with post counts

When answering questions about the user's blog content:
1. Use the search or list tools to find relevant posts
2. Read specific posts to get detailed content
3. Use list_tags and list_categories to understand the taxonomy
4. Provide helpful summaries and suggestions

Be concise but thorough in your responses. When displaying post information, format it clearly.`;
  }

  /**
   * Get a setting by key
   */
  async getSetting(key: string): Promise<string | null> {
    const client = this.db.getLocalClient();
    if (!client) return null;

    const result = await client.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [key],
    });

    if (result.rows.length > 0) {
      return result.rows[0].value as string;
    }
    return null;
  }

  /**
   * Set a setting by key
   */
  async setSetting(key: string, value: string): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const now = Date.now();
    await client.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      args: [key, value, now],
    });
  }

  /**
   * Get selected model for new conversations
   */
  async getSelectedModel(): Promise<string> {
    const client = this.db.getLocalClient();
    if (!client) {
      return 'claude-sonnet-4';
    }

    const result = await client.execute({
      sql: `SELECT value FROM settings WHERE key = 'chat_model'`,
      args: [],
    });

    if (result.rows.length > 0) {
      return result.rows[0].value as string;
    }

    return 'claude-sonnet-4';
  }

  /**
   * Set selected model for new conversations
   */
  async setSelectedModel(model: string): Promise<void> {
    const client = this.db.getLocalClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const now = Date.now();
    await client.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      args: ['chat_model', model, now],
    });
  }
}
