/**
 * ChatEngine - Manages AI chat sessions and message persistence
 * 
 * Responsible for:
 * - Creating, updating, and deleting chat conversations
 * - Storing and retrieving chat messages
 * - Managing conversation state (titles, models, etc.)
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, desc, asc } from 'drizzle-orm';
import { DatabaseConnection } from '../database/connection';
import { chatConversations, chatMessages, settings } from '../database/schema';

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
    const drizzle = this.db.getLocal();
    const id = `chat_${uuidv4()}`;
    const title = input.title || 'New Chat';
    const model = input.model || 'claude-sonnet-4';
    const now = new Date();

    await drizzle.insert(chatConversations).values({
      id,
      title,
      model,
      createdAt: now,
      updatedAt: now,
    });

    // Add system prompt as first message if provided
    if (input.systemPrompt) {
      await this.addMessage({
        conversationId: id,
        role: 'system',
        content: input.systemPrompt,
        createdAt: now,
      });
    }

    return {
      id,
      title,
      model,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a conversation by ID with all messages
   */
  async getConversation(id: string): Promise<(ChatConversationData & { messages: ChatMessageData[] }) | null> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, id));

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const conversation: ChatConversationData = {
      id: row.id,
      title: row.title,
      model: row.model || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    const messageRows = await drizzle
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, id))
      .orderBy(asc(chatMessages.createdAt));

    const messages: ChatMessageData[] = messageRows.map(r => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content || undefined,
      toolCallId: r.toolCallId || undefined,
      toolCalls: r.toolCalls || undefined,
      createdAt: r.createdAt,
    }));

    return { ...conversation, messages };
  }

  /**
   * Get all conversations, sorted by most recently updated
   */
  async getRecentConversations(limit: number = 50): Promise<ChatConversationData[]> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(chatConversations)
      .orderBy(desc(chatConversations.updatedAt))
      .limit(limit);

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      model: row.model || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Update a conversation's metadata
   */
  async updateConversation(id: string, updates: Partial<Pick<ChatConversationData, 'title' | 'model'>>): Promise<void> {
    const drizzle = this.db.getLocal();

    await drizzle
      .update(chatConversations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(chatConversations.id, id));
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(id: string): Promise<void> {
    const drizzle = this.db.getLocal();

    // Messages are deleted via CASCADE, but let's be explicit
    await drizzle
      .delete(chatMessages)
      .where(eq(chatMessages.conversationId, id));

    await drizzle
      .delete(chatConversations)
      .where(eq(chatConversations.id, id));
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(message: Omit<ChatMessageData, 'id'>): Promise<ChatMessageData> {
    const drizzle = this.db.getLocal();
    const createdAt = message.createdAt || new Date();

    const result = await drizzle
      .insert(chatMessages)
      .values({
        conversationId: message.conversationId,
        role: message.role,
        content: message.content || null,
        toolCallId: message.toolCallId || null,
        toolCalls: message.toolCalls || null,
        createdAt,
      })
      .returning({ id: chatMessages.id });

    // Update conversation's updated_at timestamp
    await drizzle
      .update(chatConversations)
      .set({ updatedAt: createdAt })
      .where(eq(chatConversations.id, message.conversationId));

    return {
      id: result[0].id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls,
      createdAt,
    };
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string): Promise<ChatMessageData[]> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt));

    return rows.map(r => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content || undefined,
      toolCallId: r.toolCallId || undefined,
      toolCalls: r.toolCalls || undefined,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Clear all messages from a conversation (but keep the conversation)
   */
  async clearMessages(conversationId: string): Promise<void> {
    const drizzle = this.db.getLocal();

    await drizzle
      .delete(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId));
  }

  /**
   * Get default system prompt for new conversations
   */
  async getDefaultSystemPrompt(): Promise<string> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(settings)
      .where(eq(settings.key, 'chat_system_prompt'));

    // Return saved prompt if it exists and is non-empty
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }

    return this.getBuiltInSystemPrompt();
  }

  /**
   * Set default system prompt for new conversations.
   * Pass empty string to reset to built-in default.
   */
  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    const drizzle = this.db.getLocal();

    // If empty string, delete the setting to use built-in default
    if (!prompt || prompt.trim() === '') {
      await drizzle
        .delete(settings)
        .where(eq(settings.key, 'chat_system_prompt'));
      return;
    }

    await drizzle
      .insert(settings)
      .values({
        key: 'chat_system_prompt',
        value: prompt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: prompt,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Get the built-in default system prompt
   */
  private getBuiltInSystemPrompt(): string {
    return `You are an AI assistant integrated into the Blogging Desktop Server (bDS) application.
Your role is to help users manage their blog posts and media files using ONLY the tools provided to you.

IMPORTANT: You do NOT have access to the internet, real-time data, or any external services.
You can ONLY access information through the tools listed below. Do not claim otherwise.

Available Tools:
- search_posts: Search blog posts using full-text search. Supports category/tag filters.
- read_post: Read the full content and metadata of a specific post by ID.
- list_posts: List posts with optional filtering by status, category, or tags.
- get_media: Get information about a specific media file by ID.
- list_media: List media files with optional MIME type filtering.
- view_image: View an image to analyze its visual content. Use this when you need to describe or analyze what an image looks like.
- update_post_metadata: Update a post's title, excerpt, tags, or categories.
- update_media_metadata: Update a media file's alt text, caption, or tags.
- list_tags: List all tags with post counts.
- list_categories: List all categories with post counts.
- get_post_backlinks: Get posts that link TO a given post (backlinks). Use to discover what references a post.
- get_post_outlinks: Get posts that a given post links TO. Use to traverse outbound links.
- get_post_media: Get media files linked to a post (featured images, galleries).
- get_media_posts: Get posts that use a specific media file.

When answering questions:
1. USE THE TOOLS to find information. Never make up data about posts or media.
2. If asked about something outside your tools (weather, news, websites), explain that you can only access the user's local blog content.
3. Be concise and helpful. Format post information clearly when displaying it.
4. If a search returns no results, suggest alternative queries or filters.
5. When asked to describe or analyze an image, use the view_image tool to see the actual image content.`;
  }

  /**
   * Get a setting by key
   */
  async getSetting(key: string): Promise<string | null> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(settings)
      .where(eq(settings.key, key));

    if (rows.length > 0) {
      return rows[0].value;
    }
    return null;
  }

  /**
   * Set a setting by key
   */
  async setSetting(key: string, value: string): Promise<void> {
    const drizzle = this.db.getLocal();

    await drizzle
      .insert(settings)
      .values({
        key,
        value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Get selected model for new conversations
   */
  async getSelectedModel(): Promise<string> {
    const drizzle = this.db.getLocal();

    const rows = await drizzle
      .select()
      .from(settings)
      .where(eq(settings.key, 'chat_model'));

    if (rows.length > 0) {
      return rows[0].value;
    }

    return 'claude-sonnet-4';
  }

  /**
   * Set selected model for new conversations
   */
  async setSelectedModel(model: string): Promise<void> {
    const drizzle = this.db.getLocal();

    await drizzle
      .insert(settings)
      .values({
        key: 'chat_model',
        value: model,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: model,
          updatedAt: new Date(),
        },
      });
  }
}
