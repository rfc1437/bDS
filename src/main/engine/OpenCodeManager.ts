/**
 * OpenCodeManager - Handles AI chat using OpenCode Zen API gateway
 *
 * Supports Anthropic Claude (Messages API with native tool_use) and
 * OpenAI-compatible models via the OpenCode Zen gateway.
 *
 * Tools are provided as proper Anthropic tool definitions so the AI
 * can call them natively via tool_use blocks.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { BrowserWindow } from 'electron';
import { ChatEngine } from './ChatEngine';
import { PostEngine } from './PostEngine';
import { MediaEngine } from './MediaEngine';

// OpenCode Zen API endpoints
const ZEN_ANTHROPIC_URL = 'https://opencode.ai/zen/v1/messages';
const ZEN_OPENAI_URL = 'https://opencode.ai/zen/v1/chat/completions';
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';

// Full model catalog from OpenCode Zen (fallback when API unavailable)
const AVAILABLE_MODELS: ModelInfo[] = [
  // Anthropic Claude
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-3-5-haiku', name: 'Claude Haiku 3.5', provider: 'anthropic' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', provider: 'anthropic' },
  // OpenAI GPT
  { id: 'gpt-5.2', name: 'GPT 5.2', provider: 'openai' },
  { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', provider: 'openai' },
  { id: 'gpt-5.1', name: 'GPT 5.1', provider: 'openai' },
  { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', provider: 'openai' },
  { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max', provider: 'openai' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini', provider: 'openai' },
  { id: 'gpt-5', name: 'GPT 5', provider: 'openai' },
  { id: 'gpt-5-codex', name: 'GPT 5 Codex', provider: 'openai' },
  { id: 'gpt-5-nano', name: 'GPT 5 Nano (Free)', provider: 'openai' },
  // Google Gemini
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google' },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'google' },
  // Other providers
  { id: 'qwen3-coder', name: 'Qwen3 Coder 480B', provider: 'other' },
  { id: 'minimax-m2.1', name: 'MiniMax M2.1', provider: 'other' },
  { id: 'minimax-m2.1-free', name: 'MiniMax M2.1 (Free)', provider: 'other' },
  { id: 'glm-4.7', name: 'GLM 4.7', provider: 'other' },
  { id: 'glm-4.7-free', name: 'GLM 4.7 (Free)', provider: 'other' },
  { id: 'glm-4.6', name: 'GLM 4.6', provider: 'other' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'other' },
  { id: 'kimi-k2.5-free', name: 'Kimi K2.5 (Free)', provider: 'other' },
  { id: 'kimi-k2', name: 'Kimi K2', provider: 'other' },
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'other' },
  { id: 'big-pickle', name: 'Big Pickle (Free)', provider: 'other' },
  { id: 'trinity-large-preview-free', name: 'Trinity Large Preview (Free)', provider: 'other' },
];

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface SendMessageOptions {
  onDelta?: (delta: string) => void;
  onToolCall?: (toolCall: { name: string; args: unknown }) => void;
  onToolResult?: (result: { name: string; result: unknown }) => void;
}

export interface SendMessageResult {
  success: boolean;
  message?: string;
  error?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface HttpResponse {
  statusCode: number;
  body: string;
}

export class OpenCodeManager {
  private chatEngine: ChatEngine;
  private postEngine: PostEngine;
  private mediaEngine: MediaEngine;
  private getMainWindow: () => BrowserWindow | null;
  private apiKey: string = '';
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    chatEngine: ChatEngine,
    postEngine: PostEngine,
    mediaEngine: MediaEngine,
    getMainWindow: () => BrowserWindow | null
  ) {
    this.chatEngine = chatEngine;
    this.postEngine = postEngine;
    this.mediaEngine = mediaEngine;
    this.getMainWindow = getMainWindow;
  }

  /**
   * Set API key for OpenCode Zen
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Get current API key
   */
  getApiKey(): string {
    return this.apiKey;
  }

  /**
   * Check if the service is configured and ready
   */
  async checkReady(): Promise<{ ready: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ready: false, error: 'API key not configured' };
    }
    return { ready: true };
  }

  /**
   * Validate an API key by calling the models endpoint
   */
  async validateApiKey(apiKey: string): Promise<{ isValid: boolean; models: ModelInfo[] }> {
    if (!apiKey || apiKey.length < 3) {
      return { isValid: false, models: [] };
    }

    // Try both auth header styles (OpenCode Zen quirk)
    const attempts: Record<string, string>[] = [
      { 'Authorization': `Bearer ${apiKey}` },
      { 'x-api-key': apiKey },
    ];

    for (const headers of attempts) {
      try {
        const response = await this.httpRequest(ZEN_MODELS_URL, {
          method: 'GET',
          headers,
        });
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return { isValid: true, models: AVAILABLE_MODELS };
        }
      } catch {
        // Try next auth method
      }
    }

    return { isValid: false, models: [] };
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    // Try fetching from API, fall back to hardcoded list
    if (this.apiKey) {
      try {
        const response = await this.httpRequest(ZEN_MODELS_URL, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'x-api-key': this.apiKey,
          },
        });
        if (response.statusCode === 200) {
          const data = JSON.parse(response.body);
          if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || this.formatModelName(m.id),
              provider: this.detectProvider(m.id),
            }));
          }
        }
      } catch {
        // Fall through to hardcoded
      }
    }
    return AVAILABLE_MODELS;
  }

  /**
   * Send a message to a conversation with tool use support
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
    options: SendMessageOptions = {}
  ): Promise<SendMessageResult> {
    const { onDelta, onToolCall, onToolResult } = options;

    try {
      const readyCheck = await this.checkReady();
      if (!readyCheck.ready) {
        return { success: false, error: readyCheck.error };
      }

      // Get conversation from database
      const conversation = await this.chatEngine.getConversation(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      // Add user message to database
      await this.chatEngine.addMessage({
        conversationId,
        role: 'user',
        content: userMessage,
        createdAt: new Date(),
      });

      // Set up abort controller
      const abortController = new AbortController();
      this.abortControllers.set(conversationId, abortController);

      try {
        const modelId = conversation.model || 'claude-sonnet-4';
        const provider = this.detectProvider(modelId);

        // Get system prompt
        const systemMessage = conversation.messages.find(m => m.role === 'system');
        const systemPrompt = systemMessage?.content || await this.chatEngine.getDefaultSystemPrompt();

        // Build message history from DB (excluding system messages)
        const dbMessages = conversation.messages.filter(m => m.role !== 'system');
        // Add the new user message
        dbMessages.push({
          conversationId,
          role: 'user',
          content: userMessage,
          createdAt: new Date(),
        });

        let fullResponse = '';
        const toolCallsCollected: Array<{ name: string; args: unknown }> = [];

        if (provider === 'anthropic') {
          const result = await this.sendAnthropicMessage(
            modelId,
            systemPrompt,
            dbMessages,
            abortController.signal,
            { onDelta, onToolCall, onToolResult }
          );
          fullResponse = result.content;
          toolCallsCollected.push(...result.toolCalls);
        } else {
          const result = await this.sendOpenAIMessage(
            modelId,
            systemPrompt,
            dbMessages,
            abortController.signal,
            { onDelta }
          );
          fullResponse = result.content;
        }

        // Save assistant response
        if (fullResponse) {
          await this.chatEngine.addMessage({
            conversationId,
            role: 'assistant',
            content: fullResponse,
            toolCalls: toolCallsCollected.length > 0 ? JSON.stringify(toolCallsCollected) : undefined,
            createdAt: new Date(),
          });
        }

        // Generate title after first exchange
        const userMsgCount = conversation.messages.filter(m => m.role === 'user').length;
        if (userMsgCount === 0 && fullResponse) {
          this.generateConversationTitle(conversationId, userMessage, fullResponse).catch(err =>
            console.error('[OpenCodeManager] Error generating title:', err)
          );
        }

        return {
          success: true,
          message: fullResponse,
          toolCalls: toolCallsCollected.length > 0 ? toolCallsCollected : undefined,
        };
      } finally {
        this.abortControllers.delete(conversationId);
      }
    } catch (error) {
      console.error('[OpenCodeManager] Error sending message:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Send via Anthropic Messages API with native tool_use
   */
  private async sendAnthropicMessage(
    modelId: string,
    systemPrompt: string,
    dbMessages: Array<{ role: string; content?: string; toolCalls?: string; toolCallId?: string }>,
    signal: AbortSignal,
    callbacks: {
      onDelta?: (delta: string) => void;
      onToolCall?: (toolCall: { name: string; args: unknown }) => void;
      onToolResult?: (result: { name: string; result: unknown }) => void;
    }
  ): Promise<{ content: string; toolCalls: Array<{ name: string; args: unknown }> }> {
    const tools = this.getToolDefinitions();
    const allToolCalls: Array<{ name: string; args: unknown }> = [];

    // Convert DB messages to Anthropic format
    let messages = this.buildAnthropicMessages(dbMessages);

    // Tool use loop - keep going until the model stops calling tools
    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools,
      };

      const response = await this.httpRequest(ZEN_ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'Authorization': `Bearer ${this.apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (response.statusCode >= 400) {
        const errorMsg = this.parseErrorResponse(response);
        throw new Error(errorMsg);
      }

      const data = JSON.parse(response.body);

      if (!data.content) {
        throw new Error('API response missing content field');
      }

      // Check if there are tool_use blocks
      const toolUseBlocks = (data.content as AnthropicContentBlock[]).filter(
        (b: AnthropicContentBlock) => b.type === 'tool_use'
      );
      const textBlocks = (data.content as AnthropicContentBlock[]).filter(
        (b: AnthropicContentBlock) => b.type === 'text'
      );

      // Stream text content to frontend
      for (const block of textBlocks) {
        if (block.text && callbacks.onDelta) {
          callbacks.onDelta(block.text);
        }
      }

      if (toolUseBlocks.length === 0 || data.stop_reason !== 'tool_use') {
        // No more tool calls - extract final text and return
        const finalText = textBlocks.map((b: AnthropicContentBlock) => b.text || '').join('');
        return { content: finalText, toolCalls: allToolCalls };
      }

      // Execute tool calls
      const toolResults: AnthropicContentBlock[] = [];

      for (const toolBlock of toolUseBlocks) {
        const toolName = toolBlock.name!;
        const toolArgs = toolBlock.input;
        const toolUseId = toolBlock.id!;

        allToolCalls.push({ name: toolName, args: toolArgs });

        if (callbacks.onToolCall) {
          callbacks.onToolCall({ name: toolName, args: toolArgs });
        }

        // Execute the tool
        const result = await this.executeTool(toolName, toolArgs as Record<string, unknown>);

        if (callbacks.onToolResult) {
          callbacks.onToolResult({ name: toolName, result });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(result),
        });
      }

      // Add assistant response and tool results to messages for next round
      messages = [
        ...messages,
        { role: 'assistant' as const, content: data.content },
        { role: 'user' as const, content: toolResults },
      ];
    }

    // If we hit max rounds, return whatever we have
    return { content: 'I reached the maximum number of tool calls. Please try again.', toolCalls: allToolCalls };
  }

  /**
   * Send via OpenAI-compatible API (non-Claude models)
   */
  private async sendOpenAIMessage(
    modelId: string,
    systemPrompt: string,
    dbMessages: Array<{ role: string; content?: string }>,
    signal: AbortSignal,
    callbacks: { onDelta?: (delta: string) => void }
  ): Promise<{ content: string }> {
    // Build OpenAI-format messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...dbMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role,
          content: m.content || '',
        })),
    ];

    // Build OpenAI tools format
    const anthropicTools = this.getToolDefinitions();
    const openaiTools = anthropicTools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 4096,
      messages,
      tools: openaiTools,
    };

    const response = await this.httpRequest(ZEN_OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (response.statusCode >= 400) {
      const errorMsg = this.parseErrorResponse(response);
      throw new Error(errorMsg);
    }

    const data = JSON.parse(response.body);
    const choice = data.choices?.[0];

    if (!choice?.message) {
      throw new Error('API response missing expected message content');
    }

    // Handle tool calls in OpenAI format
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      // Execute tools and do follow-up call
      const toolMessages = [
        ...messages,
        choice.message,
      ];

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        const result = await this.executeTool(toolName, toolArgs);

        toolMessages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        } as Record<string, unknown> as typeof messages[0]);
      }

      // Make follow-up call with tool results
      const followUpBody: Record<string, unknown> = {
        model: modelId,
        max_tokens: 4096,
        messages: toolMessages,
        tools: openaiTools,
      };

      const followUpResponse = await this.httpRequest(ZEN_OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(followUpBody),
        signal,
      });

      if (followUpResponse.statusCode >= 400) {
        throw new Error(this.parseErrorResponse(followUpResponse));
      }

      const followUpData = JSON.parse(followUpResponse.body);
      const content = followUpData.choices?.[0]?.message?.content || '';

      if (callbacks.onDelta) {
        callbacks.onDelta(content);
      }

      return { content };
    }

    const content = choice.message.content || '';
    if (callbacks.onDelta) {
      callbacks.onDelta(content);
    }

    return { content };
  }

  /**
   * Get Anthropic-format tool definitions for all available tools
   */
  private getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'search_posts',
        description: 'Search blog posts using full-text search. Can filter by category or tags. Returns matching posts with their metadata.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query text to find in posts' },
            category: { type: 'string', description: 'Optional category to filter by (e.g., "article", "picture", "aside", "page")' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional array of tags to filter by' },
            limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_post',
        description: 'Read the full content and metadata of a specific blog post by its ID.',
        input_schema: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The unique ID of the post to read' },
          },
          required: ['postId'],
        },
      },
      {
        name: 'list_posts',
        description: 'List blog posts with optional filtering by status, category, or tags.',
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Filter by post status' },
            category: { type: 'string', description: 'Filter by category' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (posts must have all specified tags)' },
            limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
            offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
          },
        },
      },
      {
        name: 'get_media',
        description: 'Get information about a specific media file (image) by its ID.',
        input_schema: {
          type: 'object',
          properties: {
            mediaId: { type: 'string', description: 'The unique ID of the media file' },
          },
          required: ['mediaId'],
        },
      },
      {
        name: 'list_media',
        description: 'List all media files in the current project with optional filtering.',
        input_schema: {
          type: 'object',
          properties: {
            mimeTypeFilter: { type: 'string', description: 'Filter by MIME type prefix (e.g., "image/")' },
            limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
          },
        },
      },
      {
        name: 'update_post_metadata',
        description: 'Update metadata for a blog post (title, excerpt, tags, categories). Does NOT update post content.',
        input_schema: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The unique ID of the post to update' },
            title: { type: 'string', description: 'New title for the post' },
            excerpt: { type: 'string', description: 'New excerpt/summary for the post' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the post' },
            categories: { type: 'array', items: { type: 'string' }, description: 'New categories for the post' },
          },
          required: ['postId'],
        },
      },
      {
        name: 'update_media_metadata',
        description: 'Update metadata for a media file (alt text, caption, tags).',
        input_schema: {
          type: 'object',
          properties: {
            mediaId: { type: 'string', description: 'The unique ID of the media to update' },
            alt: { type: 'string', description: 'New alt text for the image' },
            caption: { type: 'string', description: 'New caption for the image' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags for the media' },
          },
          required: ['mediaId'],
        },
      },
      {
        name: 'list_tags',
        description: 'List all tags used across blog posts, with the count of posts using each tag. Useful for understanding the tag taxonomy.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_categories',
        description: 'List all categories used across blog posts, with the count of posts in each category. Useful for understanding the category structure.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  /**
   * Execute a tool by name with given arguments
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'search_posts': {
          const searchResults = await this.postEngine.searchPosts(args.query as string);
          const fullPosts = await Promise.all(
            searchResults.map(sr => this.postEngine.getPost(sr.id))
          );
          let filteredPosts = fullPosts.filter(p => p !== null);

          if (args.category) {
            filteredPosts = filteredPosts.filter(p => p!.categories.includes(args.category as string));
          }
          if (args.tags && Array.isArray(args.tags) && (args.tags as string[]).length > 0) {
            filteredPosts = filteredPosts.filter(p =>
              (args.tags as string[]).every(tag => p!.tags.includes(tag))
            );
          }

          const limit = (args.limit as number) || 10;
          filteredPosts = filteredPosts.slice(0, limit);

          return {
            success: true,
            count: filteredPosts.length,
            posts: filteredPosts.map(p => ({
              id: p!.id, title: p!.title, slug: p!.slug,
              excerpt: p!.excerpt, status: p!.status,
              categories: p!.categories, tags: p!.tags,
              createdAt: p!.createdAt, updatedAt: p!.updatedAt,
            })),
          };
        }

        case 'read_post': {
          const post = await this.postEngine.getPost(args.postId as string);
          if (!post) return { success: false, error: 'Post not found' };
          return {
            success: true,
            post: {
              id: post.id, title: post.title, slug: post.slug,
              content: post.content, excerpt: post.excerpt,
              status: post.status, author: post.author,
              categories: post.categories, tags: post.tags,
              createdAt: post.createdAt, updatedAt: post.updatedAt,
              publishedAt: post.publishedAt,
            },
          };
        }

        case 'list_posts': {
          const filter: { status?: 'draft' | 'published' | 'archived'; tags?: string[]; categories?: string[] } = {};
          if (args.status) filter.status = args.status as 'draft' | 'published' | 'archived';
          if (args.tags) filter.tags = args.tags as string[];
          if (args.category) filter.categories = [args.category as string];

          let posts;
          if (Object.keys(filter).length > 0) {
            posts = await this.postEngine.getPostsFiltered(filter);
          } else {
            const result = await this.postEngine.getAllPosts({
              limit: (args.limit as number) || 20,
              offset: (args.offset as number) || 0,
            });
            posts = result.items;
          }

          const offset = (args.offset as number) || 0;
          const limit = (args.limit as number) || 20;
          const slicedPosts = posts.slice(offset, offset + limit);

          return {
            success: true,
            count: slicedPosts.length,
            total: posts.length,
            hasMore: offset + limit < posts.length,
            posts: slicedPosts.map(p => ({
              id: p.id, title: p.title, slug: p.slug,
              status: p.status, categories: p.categories,
              tags: p.tags, createdAt: p.createdAt, updatedAt: p.updatedAt,
            })),
          };
        }

        case 'get_media': {
          const media = await this.mediaEngine.getMedia(args.mediaId as string);
          if (!media) return { success: false, error: 'Media not found' };
          return {
            success: true,
            media: {
              id: media.id, filename: media.filename,
              originalName: media.originalName, mimeType: media.mimeType,
              size: media.size, width: media.width, height: media.height,
              alt: media.alt, caption: media.caption, tags: media.tags,
              createdAt: media.createdAt, updatedAt: media.updatedAt,
            },
          };
        }

        case 'list_media': {
          let mediaList = await this.mediaEngine.getAllMedia();
          if (args.mimeTypeFilter) {
            mediaList = mediaList.filter(m => m.mimeType.startsWith(args.mimeTypeFilter as string));
          }
          const limit = (args.limit as number) || 20;
          mediaList = mediaList.slice(0, limit);
          return {
            success: true,
            count: mediaList.length,
            media: mediaList.map(m => ({
              id: m.id, filename: m.filename,
              originalName: m.originalName, mimeType: m.mimeType,
              alt: m.alt, tags: m.tags,
            })),
          };
        }

        case 'update_post_metadata': {
          const updates: Record<string, unknown> = {};
          if (args.title !== undefined) updates.title = args.title;
          if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
          if (args.tags !== undefined) updates.tags = args.tags;
          if (args.categories !== undefined) updates.categories = args.categories;

          if (Object.keys(updates).length === 0) {
            return { success: false, error: 'No updates provided' };
          }

          await this.postEngine.updatePost(args.postId as string, updates);
          return { success: true, message: `Post ${args.postId} metadata updated successfully` };
        }

        case 'update_media_metadata': {
          const updates: Record<string, unknown> = {};
          if (args.alt !== undefined) updates.alt = args.alt;
          if (args.caption !== undefined) updates.caption = args.caption;
          if (args.tags !== undefined) updates.tags = args.tags;

          if (Object.keys(updates).length === 0) {
            return { success: false, error: 'No updates provided' };
          }

          await this.mediaEngine.updateMedia(args.mediaId as string, updates);
          return { success: true, message: `Media ${args.mediaId} metadata updated successfully` };
        }

        case 'list_tags': {
          const tagsWithCounts = await this.postEngine.getTagsWithCounts();
          return {
            success: true,
            count: tagsWithCounts.length,
            tags: tagsWithCounts,
          };
        }

        case 'list_categories': {
          const categoriesWithCounts = await this.postEngine.getCategoriesWithCounts();
          return {
            success: true,
            count: categoriesWithCounts.length,
            categories: categoriesWithCounts,
          };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Build Anthropic-format messages from DB message history
   */
  private buildAnthropicMessages(
    dbMessages: Array<{ role: string; content?: string; toolCalls?: string; toolCallId?: string }>
  ): AnthropicMessage[] {
    const messages: AnthropicMessage[] = [];

    for (const msg of dbMessages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content || '' });
      } else if (msg.role === 'assistant') {
        messages.push({ role: 'assistant', content: msg.content || '' });
      }
      // Tool messages from history are already incorporated into assistant responses
    }

    return messages;
  }

  /**
   * Generate a title for a conversation
   */
  private async generateConversationTitle(
    conversationId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    try {
      const body = {
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        system: 'Generate a short, concise title (max 6 words) for this conversation. Only output the title, nothing else.',
        messages: [
          {
            role: 'user',
            content: `User: ${userMessage.substring(0, 200)}\nAssistant: ${assistantResponse.substring(0, 200)}`,
          },
        ],
      };

      const response = await this.httpRequest(ZEN_ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'Authorization': `Bearer ${this.apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        let title = '';
        if (Array.isArray(data.content)) {
          title = data.content
            .filter((b: AnthropicContentBlock) => b.type === 'text')
            .map((b: AnthropicContentBlock) => b.text || '')
            .join('');
        } else {
          title = data.content || '';
        }

        title = title.trim().replace(/^["']|["']$/g, '');

        if (title) {
          await this.chatEngine.updateConversation(conversationId, { title });

          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('chat-title-updated', { conversationId, title });
          }
        }
      }
    } catch (error) {
      console.error('[OpenCodeManager] Error generating title:', error);
    }
  }

  /**
   * Abort a running message
   */
  async abortMessage(conversationId: string): Promise<{ success: boolean; error?: string }> {
    const controller = this.abortControllers.get(conversationId);
    if (!controller) {
      return { success: false, error: 'No active request for this conversation' };
    }

    controller.abort();
    this.abortControllers.delete(conversationId);
    return { success: true };
  }

  /**
   * Stop/cleanup
   */
  async stop(): Promise<void> {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  // ── Helpers ──

  private detectProvider(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt') || id.startsWith('o3') || id.startsWith('o4')) return 'openai';
    if (id.startsWith('gemini')) return 'google';
    return 'other';
  }

  private formatModelName(modelId: string): string {
    return modelId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private parseErrorResponse(response: HttpResponse): string {
    let errorMsg = `API error: ${response.statusCode}`;
    try {
      const errorBody = JSON.parse(response.body);
      const rawMsg = errorBody.error?.message || errorBody.message || '';
      if (rawMsg.includes('prompt_tokens') || rawMsg.includes('usage')) {
        errorMsg = `Model is currently unavailable on the API gateway. Try a different model.`;
      } else {
        errorMsg = rawMsg || errorMsg;
      }
    } catch {
      errorMsg = `${errorMsg}: ${response.body.slice(0, 200)}`;
    }
    return errorMsg;
  }

  private httpRequest(
    urlStr: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    }
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(url, {
        method: options.method || 'POST',
        headers: options.headers || {},
        timeout: 120000,
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request cancelled'));
        });
      }

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}
