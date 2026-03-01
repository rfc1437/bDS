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
import {
  parseAnthropicStreamEvent,
  parseOpenAIStreamEvent,
  createAnthropicStreamAccumulator,
  createOpenAIStreamAccumulator,
  httpRequestStream,
  withRetry,
} from './streaming';
import { ChatEngine } from './ChatEngine';
import { PostEngine, type PostData } from './PostEngine';
import { MediaEngine, type MediaData } from './MediaEngine';
import type { PostMediaEngine } from './PostMediaEngine';
import { ModelCatalogEngine, DEFAULT_MAX_OUTPUT_TOKENS } from './ModelCatalogEngine';
import { isRenderTool, generateFromToolCall } from '../a2ui/generator';
import type { A2UIServerMessage } from '../a2ui/types';

// OpenCode Zen API endpoints
const ZEN_ANTHROPIC_URL = 'https://opencode.ai/zen/v1/messages';
const ZEN_OPENAI_URL = 'https://opencode.ai/zen/v1/chat/completions';
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';

// Known model display names: maps model IDs to polished names and serves as offline fallback
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Anthropic Claude
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-opus-4-1': 'Claude Opus 4.1',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-3-5-haiku': 'Claude 3.5 Haiku',
  // OpenAI GPT
  'gpt-5.3-codex': 'GPT 5.3 Codex',
  'gpt-5.2': 'GPT 5.2',
  'gpt-5.2-codex': 'GPT 5.2 Codex',
  'gpt-5.1': 'GPT 5.1',
  'gpt-5.1-codex': 'GPT 5.1 Codex',
  'gpt-5.1-codex-max': 'GPT 5.1 Codex Max',
  'gpt-5.1-codex-mini': 'GPT 5.1 Codex Mini',
  'gpt-5': 'GPT 5',
  'gpt-5-codex': 'GPT 5 Codex',
  'gpt-5-nano': 'GPT 5 Nano',
  // Google Gemini
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-3-pro': 'Gemini 3 Pro',
  'gemini-3-flash': 'Gemini 3 Flash',
  // Other providers
  'glm-5': 'GLM 5',
  'glm-5-free': 'GLM 5 Free',
  'glm-4.7': 'GLM 4.7',
  'glm-4.6': 'GLM 4.6',
  'qwen3-coder': 'Qwen3 Coder',
  'minimax-m2.5': 'MiniMax M2.5',
  'minimax-m2.5-free': 'MiniMax M2.5 Free',
  'minimax-m2.1': 'MiniMax M2.1',
  'minimax-m2.1-free': 'MiniMax M2.1 Free',
  'kimi-k2.5': 'Kimi K2.5',
  'kimi-k2.5-free': 'Kimi K2.5 Free',
  'kimi-k2': 'Kimi K2',
  'kimi-k2-thinking': 'Kimi K2 Thinking',
  'big-pickle': 'Big Pickle',
  'trinity-large-preview-free': 'Trinity Large Preview Free',
};



// Uppercase prefixes that should not be title-cased
const UPPERCASE_PREFIXES = ['gpt', 'glm'];

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface SendMessageOptions {
  metadata?: {
    surface?: 'tab' | 'sidebar';
  };
  onDelta?: (delta: string) => void;
  onToolCall?: (toolCall: { name: string; args: unknown }) => void;
  onToolResult?: (result: { name: string; result: unknown }) => void;
  onA2UIMessage?: (message: A2UIServerMessage) => void;
  onTokenUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeCacheReadTokens: number;
    cumulativeCacheWriteTokens: number;
    cumulativeTotalTokens: number;
  }) => void;
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
  content?: string | AnthropicToolResultContent[];
  is_error?: boolean;
  signature?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicToolResultContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface HttpResponse {
  statusCode: number;
  body: string;
}

export class OpenCodeManager {
  private chatEngine: ChatEngine;
  private postEngine: PostEngine;
  private mediaEngine: MediaEngine;
  private postMediaEngine: PostMediaEngine;
  private getMainWindow: () => BrowserWindow | null;
  private apiKey: string = '';
  private abortControllers: Map<string, AbortController> = new Map();
  private cachedModels: ModelInfo[] | null = null;
  private cachedModelsAt: number = 0;
  private static MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private modelCatalogEngine = new ModelCatalogEngine();
  private conversationUsage: Map<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }> = new Map();

  constructor(
    chatEngine: ChatEngine,
    postEngine: PostEngine,
    mediaEngine: MediaEngine,
    postMediaEngine: PostMediaEngine,
    getMainWindow: () => BrowserWindow | null
  ) {
    this.chatEngine = chatEngine;
    this.postEngine = postEngine;
    this.mediaEngine = mediaEngine;
    this.postMediaEngine = postMediaEngine;
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
          return { isValid: true, models: Object.entries(MODEL_DISPLAY_NAMES).map(([id, name]) => ({ id, name, provider: this.detectProvider(id) })) };
        }
      } catch {
        // Try next auth method
      }
    }

    return { isValid: false, models: [] };
  }

  /**
   * Get available models (cached with 5-minute TTL)
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    // Return cached models if within TTL
    if (this.cachedModels && Date.now() - this.cachedModelsAt < OpenCodeManager.MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    // Try fetching from API
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
            const models = data.data.map((m: { id: string }) => ({
              id: m.id,
              name: this.formatModelName(m.id),
              provider: this.detectProvider(m.id),
            }));
            this.cachedModels = models;
            this.cachedModelsAt = Date.now();
            return models;
          }
        }
      } catch {
        // Fall through to fallback
      }
    }

    // Build fallback from display name map
    const fallback = Object.entries(MODEL_DISPLAY_NAMES).map(([id, name]) => ({
      id,
      name,
      provider: this.detectProvider(id),
    }));
    return fallback;
  }

  /**
   * Send a message to a conversation with tool use support
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
    options: SendMessageOptions = {}
  ): Promise<SendMessageResult> {
    const { metadata, onDelta, onToolCall, onToolResult, onA2UIMessage, onTokenUsage } = options;

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

      const modelId = conversation.model || 'claude-sonnet-4';
      const provider = this.detectProvider(modelId);

      // Get system prompt
      const systemMessage = conversation.messages.find(m => m.role === 'system');
      const basePrompt = systemMessage?.content || await this.chatEngine.getDefaultSystemPrompt();

      // Inject live blog stats into system prompt for data volume awareness
      const systemPrompt = await this.appendBlogStats(basePrompt);

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

      // Compute turn index for surface-to-message association
      const turnIndex = dbMessages.filter(m => m.role === 'user').length - 1;

      // Wrap onA2UIMessage emission for render tools
      const emitA2UIMessages = (messages: A2UIServerMessage[]) => {
        if (onA2UIMessage) {
          for (const msg of messages) {
            if (msg.type === 'createSurface') {
              msg.metadata = { ...msg.metadata, turnIndex };
            }
            onA2UIMessage(msg);
          }
        }
      };

      const requestProvider = async (
        prompt: string,
        messages: Array<{ role: string; content?: string; toolCalls?: string; toolCallId?: string }>,
      ) => {
        if (provider === 'anthropic') {
          return this.sendAnthropicMessage(
            modelId,
            prompt,
            messages,
            abortController.signal,
            { onDelta, onToolCall, onToolResult, onTokenUsage },
            conversationId,
            emitA2UIMessages,
          );
        }

        return this.sendOpenAIMessage(
          modelId,
          prompt,
          messages,
          abortController.signal,
          { onDelta, onToolCall, onToolResult, onTokenUsage },
          conversationId,
          emitA2UIMessages,
        );
      };

      try {
        console.log('[OpenCodeManager] Sending to provider:', provider, 'model:', modelId);
        const firstResult = await requestProvider(systemPrompt, dbMessages);
        fullResponse = firstResult.content;
        toolCallsCollected.push(...firstResult.toolCalls);
        console.log('[OpenCodeManager] fullResponse length:', fullResponse.length);
      } catch (error) {
        console.error('[OpenCodeManager] Request error:', (error as Error).message);
        const isAborted = abortController.signal.aborted || (error as Error).message === 'Request cancelled';
        if (!isAborted) {
          throw error;
        }
      } finally {
        this.abortControllers.delete(conversationId);
      }

      // Save assistant response to history
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
      onTokenUsage?: SendMessageOptions['onTokenUsage'];
    },
    conversationId: string,
    emitA2UIMessages: (messages: A2UIServerMessage[]) => void,
  ): Promise<{ content: string; toolCalls: Array<{ name: string; args: unknown }> }> {
    const tools = this.getToolDefinitions();
    const allToolCalls: Array<{ name: string; args: unknown }> = [];
    let accumulatedText = '';

    // Convert DB messages to Anthropic format
    let messages = this.buildAnthropicMessages(dbMessages);

    // Truncate to fit within context window
    messages = this.truncateToTokenBudget(messages, systemPrompt, tools);

    // Tool use loop - keep going until the model stops calling tools
    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      if (signal.aborted) break;

      const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: await this.getMaxOutputTokens(modelId),
        system: systemPrompt,
        messages,
        tools,
        stream: true,
        cache_control: { type: 'ephemeral' },
      };

      // Retry only the HTTP connection (429/502/503 are caught before any events are emitted).
      // Event processing is outside retry scope to prevent double-emission of onDelta on retry.
      const { events } = await withRetry(async () => {
        return httpRequestStream(ZEN_ANTHROPIC_URL, {
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
      });

      // Process stream events outside retry scope — onDelta is never called twice for the same text
      const streamAccumulator = createAnthropicStreamAccumulator();
      let stopReason = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let roundText = '';
      let receivedUsage = false;

      try {
        for await (const event of events) {
          const result = parseAnthropicStreamEvent(event, streamAccumulator);

          if (result.textDelta) {
            roundText += result.textDelta;
            if (callbacks.onDelta) {
              callbacks.onDelta(result.textDelta);
            }
          }

          if (result.usage) {
            receivedUsage = true;
            if (result.usage.inputTokens !== undefined) inputTokens = result.usage.inputTokens;
            if (result.usage.cacheReadTokens !== undefined) cacheReadTokens = result.usage.cacheReadTokens;
            if (result.usage.cacheWriteTokens !== undefined) cacheWriteTokens = result.usage.cacheWriteTokens;
            if (result.usage.outputTokens !== undefined) outputTokens = result.usage.outputTokens;
          }

          if (result.finishReason) {
            stopReason = result.finishReason;
          }

          if (result.done) break;
        }
      } finally {
        // Preserve text already emitted via onDelta even if the stream errors mid-round
        accumulatedText += roundText;
      }

      const streamToolCalls = streamAccumulator.toolCalls;
      const streamThinkingBlocks = streamAccumulator.thinkingBlocks;

      // Emit token usage after stream completes (only when usage data was received)
      if (callbacks.onTokenUsage && receivedUsage) {
        const adjustedInputTokens = inputTokens - cacheReadTokens - cacheWriteTokens;
        const totalTokens = inputTokens + outputTokens;

        const prev = this.conversationUsage.get(conversationId) || {
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        };
        const cumulative = {
          inputTokens: prev.inputTokens + adjustedInputTokens,
          outputTokens: prev.outputTokens + outputTokens,
          cacheReadTokens: prev.cacheReadTokens + cacheReadTokens,
          cacheWriteTokens: prev.cacheWriteTokens + cacheWriteTokens,
        };
        this.conversationUsage.set(conversationId, cumulative);

        callbacks.onTokenUsage({
          inputTokens: adjustedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens,
          cumulativeInputTokens: cumulative.inputTokens,
          cumulativeOutputTokens: cumulative.outputTokens,
          cumulativeCacheReadTokens: cumulative.cacheReadTokens,
          cumulativeCacheWriteTokens: cumulative.cacheWriteTokens,
          cumulativeTotalTokens: cumulative.inputTokens + cumulative.outputTokens + cumulative.cacheReadTokens + cumulative.cacheWriteTokens,
        });
      }

      // Collect tool calls from stream accumulator
      const toolUseBlocks: Array<{ id: string; name: string; input: unknown; parseError?: string }> = [];
      for (const [, tc] of streamToolCalls) {
        try {
          toolUseBlocks.push({ id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) });
        } catch (e) {
          console.error(`[OpenCodeManager] Failed to parse tool arguments for ${tc.name}:`, tc.arguments);
          toolUseBlocks.push({ id: tc.id, name: tc.name, input: {}, parseError: `Failed to parse tool arguments: ${(e as Error).message}` });
        }
      }

      console.log('[OpenCodeManager] Round', round, 'stopReason:', stopReason, 'accumulatedText length:', accumulatedText.length, 'toolCalls:', toolUseBlocks.length);

      if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
        // No more tool calls - return all accumulated text
        console.log('[OpenCodeManager] Returning accumulated text length:', accumulatedText.length);
        return { content: accumulatedText, toolCalls: allToolCalls };
      }

      // Execute tool calls
      const toolResults: AnthropicContentBlock[] = [];
      // Build assistant content blocks for the next message round
      const assistantContentBlocks: AnthropicContentBlock[] = [];

      // Add thinking blocks first (Anthropic requires thinking before text when extended thinking is enabled)
      for (const [, tb] of streamThinkingBlocks) {
        if (tb.text) {
          const thinkingBlock: AnthropicContentBlock = { type: 'thinking', text: tb.text };
          if (tb.signature) {
            thinkingBlock.signature = tb.signature;
          }
          assistantContentBlocks.push(thinkingBlock);
        }
      }

      // Add text block with text from this round
      if (roundText) {
        assistantContentBlocks.push({ type: 'text', text: roundText });
      }

      for (const toolBlock of toolUseBlocks) {
        const toolName = toolBlock.name;
        const toolArgs = toolBlock.input;
        const toolUseId = toolBlock.id;

        // Add tool_use block to assistant content
        assistantContentBlocks.push({
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: toolArgs,
        });

        allToolCalls.push({ name: toolName, args: toolArgs });

        if (callbacks.onToolCall) {
          callbacks.onToolCall({ name: toolName, args: toolArgs });
        }

        // If JSON parsing of tool arguments failed, report the error to the model
        if (toolBlock.parseError) {
          const errorResult = { error: true, message: toolBlock.parseError };
          if (callbacks.onToolResult) {
            callbacks.onToolResult({ name: toolName, result: errorResult });
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(errorResult),
            is_error: true,
          });
          continue;
        }

        // Check if this is a render tool — generate A2UI messages instead of executing
        if (isRenderTool(toolName)) {
          const a2uiMessages = generateFromToolCall(
            conversationId,
            toolName,
            toolArgs as Record<string, unknown>,
          );
          if (a2uiMessages) {
            emitA2UIMessages(a2uiMessages);
          }

          if (callbacks.onToolResult) {
            callbacks.onToolResult({ name: toolName, result: { success: true, rendered: true } });
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify({ success: true, rendered: true }),
          });
          continue;
        }

        // Execute the tool (check abort before each tool execution)
        if (signal.aborted) break;
        const result = await this.executeTool(toolName, toolArgs as Record<string, unknown>);

        if (callbacks.onToolResult) {
          callbacks.onToolResult({ name: toolName, result });
        }

        // Check if this is an image result that needs special formatting
        if (result && typeof result === 'object' && (result as Record<string, unknown>).__isImageResult) {
          const imageResult = result as {
            __isImageResult: boolean;
            success: boolean;
            mediaType: string;
            base64: string;
            metadata: Record<string, unknown>;
          };
          
          // Format as Anthropic multimodal content (image + text)
          const imageContent: AnthropicToolResultContent[] = [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageResult.mediaType,
                data: imageResult.base64,
              },
            },
            {
              type: 'text',
              text: JSON.stringify({ success: true, metadata: imageResult.metadata }),
            },
          ];
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: imageContent,
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(result),
          });
        }
      }

      if (signal.aborted) break;

      // Add assistant response and tool results to messages for next round
      messages = [
        ...messages,
        { role: 'assistant' as const, content: assistantContentBlocks },
        { role: 'user' as const, content: toolResults },
      ];
    }

    // If we hit max rounds, return whatever we have
    const fallbackText = accumulatedText || 'I reached the maximum number of tool calls. Please try again.';
    return { content: fallbackText, toolCalls: allToolCalls };
  }

  /**
   * Send via OpenAI-compatible API (non-Claude models)
   */
  private async sendOpenAIMessage(
    modelId: string,
    systemPrompt: string,
    dbMessages: Array<{ role: string; content?: string }>,
    signal: AbortSignal,
    callbacks: {
      onDelta?: (delta: string) => void;
      onToolCall?: (toolCall: { name: string; args: unknown }) => void;
      onToolResult?: (result: { name: string; result: unknown }) => void;
      onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; cumulativeInputTokens: number; cumulativeOutputTokens: number; cumulativeCacheReadTokens: number; cumulativeCacheWriteTokens: number; cumulativeTotalTokens: number }) => void;
    },
    conversationId: string,
    emitA2UIMessages: (messages: A2UIServerMessage[]) => void,
  ): Promise<{ content: string; toolCalls: Array<{ name: string; args: unknown }> }> {
    // Build OpenAI-format messages
    const allMessages: Array<Record<string, unknown>> = [
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

    // Truncate conversation history to fit within context window
    // Keep system message (index 0), truncate from oldest conversation messages
    const conversationMessages = allMessages.slice(1);
    const anthropicFmt = conversationMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: (m.content as string) || '',
    }));
    const truncated = this.truncateToTokenBudget(anthropicFmt, systemPrompt, anthropicTools);
    const messages: Array<Record<string, unknown>> = [
      allMessages[0],
      ...truncated.map(m => ({ role: m.role, content: m.content })),
    ];

    let accumulatedText = '';
    const allToolCalls: Array<{ name: string; args: unknown }> = [];
    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      if (signal.aborted) break;

      const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: await this.getMaxOutputTokens(modelId),
        messages,
        tools: openaiTools,
        stream: true,
        stream_options: { include_usage: true },
      };

      // Retry only the HTTP connection (429/502/503 are caught before any events are emitted).
      // Event processing is outside retry scope to prevent double-emission of onDelta on retry.
      const { events } = await withRetry(async () => {
        return httpRequestStream(ZEN_OPENAI_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      });

      // Process stream events outside retry scope — onDelta is never called twice for the same text
      const streamAccumulator = createOpenAIStreamAccumulator();
      let finishReason = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let cacheReadTokens = 0;
      let roundText = '';
      let receivedUsage = false;

      try {
        for await (const event of events) {
          const result = parseOpenAIStreamEvent(event, streamAccumulator);

          if (result.textDelta) {
            roundText += result.textDelta;
            if (callbacks.onDelta) {
              callbacks.onDelta(result.textDelta);
            }
          }

          if (result.usage) {
            receivedUsage = true;
            if (result.usage.promptTokens !== undefined) promptTokens = result.usage.promptTokens;
            if (result.usage.completionTokens !== undefined) completionTokens = result.usage.completionTokens;
            if (result.usage.totalTokens !== undefined) totalTokens = result.usage.totalTokens;
            if (result.usage.cacheReadTokens !== undefined) cacheReadTokens = result.usage.cacheReadTokens;
          }

          if (result.finishReason) {
            finishReason = result.finishReason;
          }

          if (result.done) break;
        }
      } finally {
        // Preserve text already emitted via onDelta even if the stream errors mid-round
        accumulatedText += roundText;
      }

      const streamToolCalls = streamAccumulator.toolCalls;

      // Emit token usage after stream completes (only when usage data was received)
      if (callbacks.onTokenUsage && receivedUsage) {
        const inputTokens = promptTokens - cacheReadTokens;
        const outputTokens = completionTokens;

        const prev = this.conversationUsage.get(conversationId) || {
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        };
        const cumulative = {
          inputTokens: prev.inputTokens + inputTokens,
          outputTokens: prev.outputTokens + outputTokens,
          cacheReadTokens: prev.cacheReadTokens + cacheReadTokens,
          cacheWriteTokens: prev.cacheWriteTokens,
        };
        this.conversationUsage.set(conversationId, cumulative);

        callbacks.onTokenUsage({
          inputTokens, outputTokens, cacheReadTokens,
          cacheWriteTokens: 0, // OpenAI streaming does not report cache write tokens
          totalTokens: totalTokens || inputTokens + outputTokens,
          cumulativeInputTokens: cumulative.inputTokens,
          cumulativeOutputTokens: cumulative.outputTokens,
          cumulativeCacheReadTokens: cumulative.cacheReadTokens,
          cumulativeCacheWriteTokens: cumulative.cacheWriteTokens,
          cumulativeTotalTokens: cumulative.inputTokens + cumulative.outputTokens + cumulative.cacheReadTokens + cumulative.cacheWriteTokens,
        });
      }

      // Collect tool calls from stream accumulator
      const parsedToolCalls: Array<{ id: string; name: string; args: unknown; parseError?: string }> = [];
      for (const [, tc] of streamToolCalls) {
        try {
          parsedToolCalls.push({ id: tc.id, name: tc.name, args: JSON.parse(tc.arguments) });
        } catch (e) {
          console.error(`[OpenCodeManager:OpenAI] Failed to parse tool arguments for ${tc.name}:`, tc.arguments);
          parsedToolCalls.push({ id: tc.id, name: tc.name, args: {}, parseError: `Failed to parse tool arguments: ${(e as Error).message}` });
        }
      }

      console.log('[OpenCodeManager:OpenAI] Round', round, 'finishReason:', finishReason, 'text length:', accumulatedText.length, 'toolCalls:', parsedToolCalls.length);

      // If no tool calls, we're done
      if (parsedToolCalls.length === 0 || finishReason !== 'tool_calls') {
        console.log('[OpenCodeManager:OpenAI] Done. Accumulated text length:', accumulatedText.length);
        return { content: accumulatedText, toolCalls: allToolCalls };
      }

      // Build the assistant message with tool_calls for conversation history
      const assistantMessage: Record<string, unknown> = {
        role: 'assistant',
        content: roundText || null,
        tool_calls: parsedToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
      messages.push(assistantMessage);

      // Execute tool calls and add results
      for (const toolCall of parsedToolCalls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args;

        allToolCalls.push({ name: toolName, args: toolArgs });
        if (callbacks.onToolCall) {
          callbacks.onToolCall({ name: toolName, args: toolArgs });
        }

        // If JSON parsing of tool arguments failed, report the error to the model
        if (toolCall.parseError) {
          const errorResult = { error: true, message: toolCall.parseError };
          if (callbacks.onToolResult) {
            callbacks.onToolResult({ name: toolName, result: errorResult });
          }
          messages.push({
            role: 'tool',
            content: JSON.stringify(errorResult),
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // Check if this is a render tool
        if (isRenderTool(toolName)) {
          const a2uiMessages = generateFromToolCall(conversationId, toolName, toolArgs as Record<string, unknown>);
          if (a2uiMessages) {
            emitA2UIMessages(a2uiMessages);
          }

          if (callbacks.onToolResult) {
            callbacks.onToolResult({ name: toolName, result: { success: true, rendered: true } });
          }

          messages.push({
            role: 'tool',
            content: JSON.stringify({ success: true, rendered: true }),
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // Check abort before each tool execution
        if (signal.aborted) break;
        const result = await this.executeTool(toolName, toolArgs as Record<string, unknown>);

        if (callbacks.onToolResult) {
          callbacks.onToolResult({ name: toolName, result });
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }

      if (signal.aborted) break;
    }

    // Hit max rounds
    const fallbackText = accumulatedText || 'I reached the maximum number of tool calls. Please try again.';
    return { content: fallbackText, toolCalls: allToolCalls };
  }

  /**
   * Get Anthropic-format tool definitions for all available tools
   */
  private getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'search_posts',
        description: 'Search blog posts using full-text search. Can filter by category, tags, year, or month. Returns paginated results with totalMatches count. Use offset to page through results when totalMatches > limit.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query text to find in posts' },
            category: { type: 'string', description: 'Optional category to filter by (e.g., "article", "picture", "aside", "page")' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional array of tags to filter by' },
            year: { type: 'number', description: 'Filter to posts created in this year (e.g., 2024)' },
            month: { type: 'number', description: 'Filter to posts created in this month (1-12). Requires year.' },
            limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
            offset: { type: 'number', description: 'Offset for pagination (default: 0). Use with limit to page through results.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_post',
        description: 'Read the full content and metadata of a specific blog post by its ID. Includes backlinks (posts linking to this post).',
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
        description: 'List blog posts with optional filtering by status, category, tags, year, or month. Returns paginated results. Each post includes backlinks (posts linking to it). The response includes "total" (global post count in the blog) and "filteredTotal" (count matching current filters). Use year/month filters to efficiently narrow to a time period instead of paginating through all posts. Use offset/limit to page through filtered results.',
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Filter by post status' },
            category: { type: 'string', description: 'Filter by category' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (posts must have all specified tags)' },
            year: { type: 'number', description: 'Filter to posts created in this year (e.g., 2024). Use this to efficiently narrow results by time period.' },
            month: { type: 'number', description: 'Filter to posts created in this month (1-12). Requires year.' },
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
        description: 'List media files in the current project with optional filtering by MIME type, year, month, or tags. Returns paginated results with total count. Use year/month filters to efficiently narrow to a time period.',
        input_schema: {
          type: 'object',
          properties: {
            mimeTypeFilter: { type: 'string', description: 'Filter by MIME type prefix (e.g., "image/")' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (media must have all specified tags)' },
            year: { type: 'number', description: 'Filter to media created in this year (e.g., 2024)' },
            month: { type: 'number', description: 'Filter to media created in this month (1-12). Requires year.' },
            limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
            offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
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
        description: 'Update metadata for a media file (title, alt text, caption, tags).',
        input_schema: {
          type: 'object',
          properties: {
            mediaId: { type: 'string', description: 'The unique ID of the media to update' },
            title: { type: 'string', description: 'New title for display in lists and search results' },
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
      {
        name: 'get_blog_stats',
        description: 'Get comprehensive blog statistics: total posts, drafts, published, archived counts, date range (oldest to newest post), posts per year breakdown, number of unique tags and categories, and total media count. Use this FIRST to understand the full scope of the blog before making queries. This is essential to understand the data volume.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'view_image',
        description: 'View an image to analyze its visual content. Returns the actual image for visual inspection. Use this when you need to see, describe, or analyze what an image looks like. Only works with image files (not PDFs or other media types).',
        input_schema: {
          type: 'object',
          properties: {
            mediaId: { type: 'string', description: 'The unique ID of the image to view' },
            size: {
              type: 'string',
              enum: ['small', 'medium', 'large'],
              description: 'Image size: small (150px) for quick reference, medium (400px, default) for details, large (800px) for full analysis',
            },
          },
          required: ['mediaId'],
        },
      },
      {
        name: 'get_post_backlinks',
        description: 'Get all posts that link TO a specific post (backlinks/inbound links). Use this to discover which other posts reference or cite a given post. Helpful for understanding how content is interconnected and finding related posts.',
        input_schema: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The ID of the post to find backlinks for' },
          },
          required: ['postId'],
        },
      },
      {
        name: 'get_post_outlinks',
        description: 'Get all posts that a specific post links TO (outbound links). Use this to discover what other posts are referenced or cited by a given post. Helpful for understanding content relationships and traversing linked posts.',
        input_schema: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The ID of the post to find outbound links for' },
          },
          required: ['postId'],
        },
      },
      {
        name: 'get_post_media',
        description: 'Get all media files linked to a specific post. Returns media that has been explicitly associated with the post (featured images, galleries, etc.). Use this to discover images and other media attached to a post.',
        input_schema: {
          type: 'object',
          properties: {
            postId: { type: 'string', description: 'The ID of the post to get linked media for' },
          },
          required: ['postId'],
        },
      },
      {
        name: 'get_media_posts',
        description: 'Get all posts that a specific media file is linked to. Use this to find which posts use or reference a particular image or media file. Helpful for understanding media usage across posts.',
        input_schema: {
          type: 'object',
          properties: {
            mediaId: { type: 'string', description: 'The ID of the media file to find linked posts for' },
          },
          required: ['mediaId'],
        },
      },
      // ── A2UI Render Tools ──
      {
        name: 'render_chart',
        description: 'Render an interactive chart in the chat UI. Use this when the user asks for a chart, graph, or data visualization. The chart will be displayed as a rich UI element in the conversation.',
        input_schema: {
          type: 'object',
          properties: {
            chartType: { type: 'string', enum: ['bar', 'stacked-bar', 'line', 'area', 'pie', 'donut', 'heatmap'], description: 'The type of chart to render. Use stacked-bar when each bar has multiple segments (categories). Use area for trend/cumulative data. Use donut for proportional data with a total in the center. Use heatmap for grid/matrix visualizations where color intensity shows magnitude (e.g., posts per month across years). Prefer heatmap over tables with emojis for intensity data.' },
            title: { type: 'string', description: 'Optional chart title' },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Data point label (row label for heatmaps, e.g., year)' },
                  value: { type: 'number', description: 'Data point value (total for stacked bars, ignored for heatmaps)' },
                  segments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: 'Segment/column label (e.g., month name for heatmaps)' },
                        value: { type: 'number', description: 'Segment value (color intensity for heatmaps)' },
                      },
                      required: ['label', 'value'],
                    },
                    description: 'Segments within this data point. Required for stacked-bar and heatmap charts. For heatmaps, each segment becomes a cell in that row.',
                  },
                },
                required: ['label', 'value'],
              },
              description: 'Array of data points. For stacked-bar and heatmap charts, include segments. For heatmaps, each entry is a row and segments are columns.',
            },
          },
          required: ['chartType', 'series'],
        },
      },
      {
        name: 'render_table',
        description: 'Render a data table in the chat UI. Use this when the user asks for tabular data, comparisons, or structured information. The table will be displayed as a rich UI element.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Optional table title' },
            columns: { type: 'array', items: { type: 'string' }, description: 'Column header names' },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Table rows, each row is an array of cell values' },
          },
          required: ['columns', 'rows'],
        },
      },
      {
        name: 'render_form',
        description: 'Render an interactive form in the chat UI. Use this when you need to collect structured input from the user, such as metadata updates, configuration, or multi-field data entry.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Optional form title' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'Field identifier' },
                  label: { type: 'string', description: 'Field label shown to user' },
                  inputType: { type: 'string', enum: ['text', 'textarea', 'select', 'checkbox', 'date', 'number'], description: 'Type of input control' },
                  placeholder: { type: 'string', description: 'Placeholder text' },
                  defaultValue: { description: 'Default value for the field' },
                  options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] }, description: 'Options for select fields' },
                  required: { type: 'boolean', description: 'Whether the field is required' },
                },
                required: ['key', 'label', 'inputType'],
              },
              description: 'Form fields to display',
            },
            submitLabel: { type: 'string', description: 'Label for the submit button' },
            submitAction: { type: 'string', description: 'Action to dispatch on submit' },
          },
          required: ['fields', 'submitLabel'],
        },
      },
      {
        name: 'render_card',
        description: 'Render an information card in the chat UI. Use this for displaying a summary, highlight, or actionable item with a title, body, and optional action buttons.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Card title' },
            body: { type: 'string', description: 'Card body text (supports markdown)' },
            subtitle: { type: 'string', description: 'Optional subtitle' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Button label' },
                  action: { type: 'string', description: 'Action name to dispatch (e.g., openPost, openMedia)' },
                  payload: { type: 'object', description: 'Optional action payload' },
                },
                required: ['label', 'action'],
              },
              description: 'Optional action buttons on the card',
            },
          },
          required: ['title', 'body'],
        },
      },
      {
        name: 'render_metric',
        description: 'Render a single metric/KPI display in the chat UI. Use this for showing a single important value with a label, such as post counts, statistics, or status indicators.',
        input_schema: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Metric label' },
            value: { type: 'string', description: 'Metric value (displayed prominently)' },
          },
          required: ['label', 'value'],
        },
      },
      {
        name: 'render_list',
        description: 'Render a list of items in the chat UI. Use this for displaying bullet-point style lists, checklists, or simple enumerations.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Optional list title' },
            items: { type: 'array', items: { type: 'string' }, description: 'List items' },
          },
          required: ['items'],
        },
      },
      {
        name: 'render_tabs',
        description: 'Render a tabbed interface in the chat UI. Use this when you want to organize information into multiple tabs that the user can switch between. Each tab can contain any combination of text, metrics, lists, charts, and tables.',
        input_schema: {
          type: 'object',
          properties: {
            tabs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Tab label' },
                  content: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['text', 'metric', 'list', 'chart', 'table'], description: 'Content type' },
                        text: { type: 'string', description: 'Text content (for type text)' },
                        label: { type: 'string', description: 'Label (for type metric)' },
                        value: { type: 'string', description: 'Display value (for type metric)' },
                        title: { type: 'string', description: 'Title (for type list, chart, or table)' },
                        items: { type: 'array', items: { type: 'string' }, description: 'Items (for type list)' },
                        chartType: { type: 'string', enum: ['bar', 'stacked-bar', 'line', 'area', 'pie', 'donut', 'heatmap'], description: 'Chart type (for type chart). Use heatmap for intensity grids.' },
                        series: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              label: { type: 'string' },
                              value: { type: 'number' },
                              segments: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: { label: { type: 'string' }, value: { type: 'number' } },
                                  required: ['label', 'value'],
                                },
                                description: 'Segments for stacked-bar and heatmap charts',
                              },
                            },
                            required: ['label', 'value'],
                          },
                          description: 'Data series (for type chart)',
                        },
                        columns: { type: 'array', items: { type: 'string' }, description: 'Column headers (for type table)' },
                        rows: {
                          type: 'array',
                          items: { type: 'array', items: { type: 'string' } },
                          description: 'Table rows (for type table)',
                        },
                      },
                      required: ['type'],
                    },
                    description: 'Content items within the tab',
                  },
                },
                required: ['label', 'content'],
              },
              description: 'Array of tabs',
            },
          },
          required: ['tabs'],
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
          const filter: { status?: 'draft' | 'published' | 'archived'; tags?: string[]; categories?: string[]; year?: number; month?: number } = {};
          if (args.category) filter.categories = [args.category as string];
          if (args.tags && Array.isArray(args.tags) && (args.tags as string[]).length > 0) filter.tags = args.tags as string[];
          if (args.year !== undefined) filter.year = args.year as number;
          if (args.month !== undefined && args.year !== undefined) filter.month = args.month as number;

          const hasFilters = Object.keys(filter).length > 0;
          const offset = (args.offset as number) || 0;
          const limit = (args.limit as number) || 10;

          let filteredPosts;
          // Use searchPostsFiltered for all paths — it handles FTS + structural
          // filters in a single SQL JOIN and returns full PostData[]
          filteredPosts = await this.postEngine.searchPostsFiltered(
            args.query as string, filter, { offset, limit },
          );

          const totalMatches = filteredPosts.length;

          return {
            success: true,
            count: filteredPosts.length,
            totalMatches,
            hasMore: false,
            offset,
            limit,
            posts: await Promise.all(filteredPosts.map(async p => {
              const [backlinks, linksTo] = await Promise.all([
                this.postEngine.getLinkedBy(p.id),
                this.postEngine.getLinksTo(p.id),
              ]);
              return {
                id: p.id, title: p.title, slug: p.slug,
                excerpt: p.excerpt, status: p.status,
                categories: p.categories, tags: p.tags,
                createdAt: p.createdAt, updatedAt: p.updatedAt,
                backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
                linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
              };
            })),
          };
        }

        case 'read_post': {
          const post = await this.postEngine.getPost(args.postId as string);
          if (!post) return { success: false, error: 'Post not found' };
          const [backlinks, linksTo] = await Promise.all([
            this.postEngine.getLinkedBy(post.id),
            this.postEngine.getLinksTo(post.id),
          ]);
          return {
            success: true,
            post: {
              id: post.id, title: post.title, slug: post.slug,
              content: post.content, excerpt: post.excerpt,
              status: post.status, author: post.author,
              categories: post.categories, tags: post.tags,
              createdAt: post.createdAt, updatedAt: post.updatedAt,
              publishedAt: post.publishedAt,
              backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
              linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
            },
          };
        }

        case 'list_posts': {
          const filter: { status?: 'draft' | 'published' | 'archived'; tags?: string[]; categories?: string[]; year?: number; month?: number } = {};
          if (args.status) filter.status = args.status as 'draft' | 'published' | 'archived';
          if (args.tags) filter.tags = args.tags as string[];
          if (args.category) filter.categories = [args.category as string];
          if (args.year !== undefined) filter.year = args.year as number;
          if (args.month !== undefined && args.year !== undefined) filter.month = args.month as number;

          const offset = (args.offset as number) || 0;
          const limit = (args.limit as number) || 20;

          // Always get global total for awareness
          const globalStats = await this.postEngine.getDashboardStats();
          const globalTotal = globalStats.totalPosts;

          let pageItems: PostData[];
          let filteredTotal: number;

          if (Object.keys(filter).length > 0) {
            const allFiltered = await this.postEngine.getPostsFiltered(filter);
            filteredTotal = allFiltered.length;
            pageItems = allFiltered.slice(offset, offset + limit);
          } else {
            const result = await this.postEngine.getAllPosts({ limit, offset });
            pageItems = result.items;
            filteredTotal = result.total;
          }

          return {
            success: true,
            count: pageItems.length,
            total: globalTotal,
            filteredTotal,
            hasMore: offset + limit < filteredTotal,
            offset,
            limit,
            posts: await Promise.all(pageItems.map(async p => {
              const [backlinks, linksTo] = await Promise.all([
                this.postEngine.getLinkedBy(p.id),
                this.postEngine.getLinksTo(p.id),
              ]);
              return {
                id: p.id, title: p.title, slug: p.slug,
                status: p.status, categories: p.categories,
                tags: p.tags, createdAt: p.createdAt, updatedAt: p.updatedAt,
                backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
                linksTo: linksTo.map(l => ({ id: l.id, title: l.title, slug: l.slug })),
              };
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
              title: media.title, alt: media.alt, caption: media.caption, tags: media.tags,
              createdAt: media.createdAt, updatedAt: media.updatedAt,
            },
          };
        }

        case 'list_media': {
          const hasMediaFilter = args.year !== undefined || (args.tags && Array.isArray(args.tags) && (args.tags as string[]).length > 0);
          let mediaList: MediaData[];

          if (hasMediaFilter) {
            const mediaFilter: { year?: number; month?: number; tags?: string[] } = {};
            if (args.year !== undefined) mediaFilter.year = args.year as number;
            if (args.month !== undefined && args.year !== undefined) mediaFilter.month = args.month as number;
            if (args.tags) mediaFilter.tags = args.tags as string[];
            mediaList = await this.mediaEngine.getMediaFiltered(mediaFilter);
          } else {
            mediaList = await this.mediaEngine.getAllMedia();
          }

          const totalMedia = mediaList.length;
          if (args.mimeTypeFilter) {
            mediaList = mediaList.filter(m => m.mimeType.startsWith(args.mimeTypeFilter as string));
          }
          const filteredTotal = mediaList.length;
          const offset = (args.offset as number) || 0;
          const limit = (args.limit as number) || 20;
          const pageItems = mediaList.slice(offset, offset + limit);
          return {
            success: true,
            count: pageItems.length,
            total: totalMedia,
            filteredTotal,
            hasMore: offset + limit < filteredTotal,
            offset,
            limit,
            media: pageItems.map(m => ({
              id: m.id, filename: m.filename,
              originalName: m.originalName, mimeType: m.mimeType,
              title: m.title, alt: m.alt, tags: m.tags,
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
          if (args.title !== undefined) updates.title = args.title;
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

        case 'view_image': {
          const mediaId = args.mediaId as string;
          const size = (args.size as 'small' | 'medium' | 'large') || 'medium';
          
          // Get media metadata first
          const mediaItem = await this.mediaEngine.getMedia(mediaId);
          if (!mediaItem) {
            return { success: false, error: 'Image not found' };
          }
          
          // Verify it's an image (not PDF, video, etc)
          if (!mediaItem.mimeType.startsWith('image/')) {
            return { success: false, error: `Cannot view this file type: ${mediaItem.mimeType}. Only images are supported.` };
          }
          
          // Get thumbnail data URL (base64)
          const dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, size);
          if (!dataUrl) {
            return { success: false, error: 'Thumbnail not available. Try regenerating thumbnails from Settings.' };
          }
          
          // Extract base64 data (remove data:image/webp;base64, prefix)
          const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          
          // Return special image result format
          return {
            __isImageResult: true,
            success: true,
            mediaType: 'image/webp',
            base64: base64Data,
            metadata: {
              id: mediaItem.id,
              filename: mediaItem.filename,
              originalName: mediaItem.originalName,
              width: mediaItem.width,
              height: mediaItem.height,
              title: mediaItem.title,
              alt: mediaItem.alt,
              caption: mediaItem.caption,
              size: size,
            },
          };
        }

        case 'get_post_backlinks': {
          const linkedBy = await this.postEngine.getLinkedBy(args.postId as string);
          return {
            success: true,
            postId: args.postId,
            count: linkedBy.length,
            linkedBy: linkedBy.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
            })),
          };
        }

        case 'get_post_outlinks': {
          const linksTo = await this.postEngine.getLinksTo(args.postId as string);
          return {
            success: true,
            postId: args.postId,
            count: linksTo.length,
            linksTo: linksTo.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
            })),
          };
        }

        case 'get_post_media': {
          const postMediaEngine = this.postMediaEngine;
          const linkedMedia = await postMediaEngine.getLinkedMediaDataForPost(args.postId as string);
          return {
            success: true,
            postId: args.postId,
            count: linkedMedia.length,
            media: linkedMedia.map(link => ({
              id: link.media.id,
              filename: link.media.filename,
              originalName: link.media.originalName,
              mimeType: link.media.mimeType,
              title: link.media.title,
              alt: link.media.alt,
              caption: link.media.caption,
              width: link.media.width,
              height: link.media.height,
              sortOrder: link.sortOrder,
            })),
          };
        }

        case 'get_media_posts': {
          const postMediaEngine = this.postMediaEngine;
          const linkedPosts = await postMediaEngine.getLinkedPostsForMedia(args.mediaId as string);
          
          // Fetch full post data for each linked post
          const postsData = await Promise.all(
            linkedPosts.map(async (link) => {
              const post = await this.postEngine.getPost(link.postId);
              return post ? {
                id: post.id,
                title: post.title,
                slug: post.slug,
                status: post.status,
              } : null;
            })
          );
          
          const validPosts = postsData.filter(p => p !== null);
          return {
            success: true,
            mediaId: args.mediaId,
            count: validPosts.length,
            posts: validPosts,
          };
        }

        case 'get_blog_stats': {
          const stats = await this.postEngine.getBlogStats();
          const mediaList = await this.mediaEngine.getAllMedia();
          return {
            success: true,
            totalPosts: stats.totalPosts,
            draftCount: stats.draftCount,
            publishedCount: stats.publishedCount,
            archivedCount: stats.archivedCount,
            dateRange: stats.oldestPostDate && stats.newestPostDate
              ? { oldest: stats.oldestPostDate, newest: stats.newestPostDate }
              : null,
            postsPerYear: stats.postsPerYear,
            tagCount: stats.tagCount,
            categoryCount: stats.categoryCount,
            totalMedia: mediaList.length,
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
   * Estimate token count for a string using a rough character heuristic.
   * ~3.5 characters per token for English text (conservative, tends to overestimate).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Estimate total tokens for an array of Anthropic messages.
   */
  private estimateMessageTokens(messages: AnthropicMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += this.estimateTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text) total += this.estimateTokens(block.text);
          if (typeof block.content === 'string') total += this.estimateTokens(block.content);
        }
      }
    }
    return total;
  }

  /**
   * Truncate messages to fit within a token budget.
   * Drops oldest user/assistant pairs first, keeping the most recent messages.
   */
  private truncateToTokenBudget(
    messages: AnthropicMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    maxContextTokens: number = 150000,
  ): AnthropicMessage[] {
    const systemTokens = this.estimateTokens(systemPrompt);
    const toolsTokens = this.estimateTokens(JSON.stringify(tools));
    const responseReserve = 4096;
    const availableBudget = maxContextTokens - systemTokens - toolsTokens - responseReserve;

    if (availableBudget <= 0) {
      return messages.slice(-1);
    }

    if (this.estimateMessageTokens(messages) <= availableBudget) {
      return messages;
    }

    // Drop oldest pairs until we fit
    let truncated = [...messages];
    while (truncated.length > 2 && this.estimateMessageTokens(truncated) > availableBudget) {
      // Ensure valid message structure (must start with user for Anthropic)
      if (truncated[0].role === 'user') {
        truncated = truncated.slice(2); // Drop user + assistant pair
      } else {
        truncated = truncated.slice(1);
      }
    }

    if (truncated.length !== messages.length) {
      console.log(`[OpenCodeManager] Truncated conversation from ${messages.length} to ${truncated.length} messages (budget: ${availableBudget} tokens)`);
    }

    return truncated;
  }

  /**
   * Build Anthropic-format messages from DB message history.
   * For assistant messages that had tool calls, appends a summary annotation
   * so the model retains context about what tools were used on resume.
   */
  private buildAnthropicMessages(
    dbMessages: Array<{ role: string; content?: string; toolCalls?: string; toolCallId?: string }>
  ): AnthropicMessage[] {
    const messages: AnthropicMessage[] = [];

    for (const msg of dbMessages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content || '' });
      } else if (msg.role === 'assistant') {
        let content = msg.content || '';

        // If this message had tool calls, append a summary for context on resume
        if (msg.toolCalls) {
          try {
            const toolCalls = JSON.parse(msg.toolCalls) as Array<{ name: string; args: unknown }>;
            if (toolCalls.length > 0) {
              const summary = toolCalls
                .map(tc => `- ${tc.name}(${JSON.stringify(tc.args)})`)
                .join('\n');
              content += `\n\n[Tools used in this turn:\n${summary}\n]`;
            }
          } catch {
            // Ignore malformed toolCalls JSON
          }
        }

        messages.push({ role: 'assistant', content });
      }
    }

    return messages;
  }

  /**
   * Generate a title for a conversation
   */
  private async generateConversationTitle(
    conversationId: string,
    userMessage: string,
    _assistantResponse: string
  ): Promise<void> {
    try {
      const body = {
        model: 'claude-haiku-4-5',
        max_tokens: 20,
        system: 'Generate an ultra-short title (2-3 words, max 25 characters) for this conversation. Focus ONLY on the topic. Ignore any capability disclaimers. Output ONLY the title text.',
        messages: [
          {
            role: 'user',
            content: `Topic: ${userMessage.substring(0, 100)}`,
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

        // Clean up and truncate title
        title = title.trim().replace(/^["']|["']$/g, '').replace(/[.!?]+$/, '');
        
        // Hard limit on title length
        const MAX_TITLE_LENGTH = 30;
        if (title.length > MAX_TITLE_LENGTH) {
          title = title.substring(0, MAX_TITLE_LENGTH - 1) + '…';
        }

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

  /**
   * Append live blog statistics to the system prompt so the AI
   * knows the true scale of the data before its first tool call.
   */
  private async appendBlogStats(basePrompt: string): Promise<string> {
    try {
      const stats = await this.postEngine.getBlogStats();
      const mediaList = await this.mediaEngine.getAllMedia();

      if (stats.totalPosts === 0) {
        return basePrompt;
      }

      const dateRange = stats.oldestPostDate && stats.newestPostDate
        ? `from ${stats.oldestPostDate.toISOString().split('T')[0]} to ${stats.newestPostDate.toISOString().split('T')[0]}`
        : 'unknown';

      const yearBreakdown = Object.entries(stats.postsPerYear)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([year, count]) => `${year}: ${count}`)
        .join(', ');

      const statsSummary = `

--- CURRENT BLOG DATA SUMMARY ---
Total posts: ${stats.totalPosts} (${stats.publishedCount} published, ${stats.draftCount} drafts, ${stats.archivedCount} archived)
Date range: ${dateRange}
Posts per year: ${yearBreakdown}
Unique tags: ${stats.tagCount}, Unique categories: ${stats.categoryCount}
Total media files: ${mediaList.length}
NOTE: Use pagination (offset/limit) in list_posts and search_posts to access all data. Default page size is 20.`;

      return basePrompt + statsSummary;
    } catch (error) {
      console.error('[OpenCodeManager] Failed to append blog stats:', error);
      return basePrompt;
    }
  }

  /**
   * Get max output tokens for a model from the model catalog (DB-backed).
   * Falls back to DEFAULT_MAX_OUTPUT_TOKENS (16384) when not catalogued.
   */
  private async getMaxOutputTokens(modelId: string): Promise<number> {
    return this.modelCatalogEngine.getMaxOutputTokens(modelId);
  }

  /**
   * Access the model catalog engine (used by IPC handlers).
   */
  getModelCatalogEngine(): ModelCatalogEngine {
    return this.modelCatalogEngine;
  }

  private detectProvider(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt') || id.startsWith('o3') || id.startsWith('o4')) return 'openai';
    if (id.startsWith('gemini')) return 'google';
    return 'other';
  }

  private formatModelName(modelId: string): string {
    // Check display name map first
    if (MODEL_DISPLAY_NAMES[modelId]) {
      return MODEL_DISPLAY_NAMES[modelId];
    }
    // Auto-format: split on hyphens, handle uppercase prefixes and version dots
    const words = modelId.split('-');
    return words
      .map((word, index) => {
        // First word: check for uppercase prefixes
        if (index === 0 && UPPERCASE_PREFIXES.includes(word.toLowerCase())) {
          return word.toUpperCase();
        }
        // Capitalize first letter
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
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

  /**
   * Analyze taxonomy items (tags and categories) and suggest mappings
   * This is a one-shot request without conversation context
   */
  async analyzeTaxonomy(
    categories: Array<{ name: string; slug: string; existsInProject: boolean }>,
    tags: Array<{ name: string; slug: string; existsInProject: boolean }>,
    modelId: string
  ): Promise<{
    success: boolean;
    categoryMappings?: Record<string, string>;
    tagMappings?: Record<string, string>;
    error?: string;
  }> {
    if (!this.apiKey) {
      return { success: false, error: 'API key not set' };
    }

    const provider = this.detectProvider(modelId);
    
    // Build the prompt for taxonomy analysis
    const existingCategories = categories.filter(c => c.existsInProject).map(c => c.name);
    const newCategories = categories.filter(c => !c.existsInProject).map(c => c.name);
    const existingTags = tags.filter(t => t.existsInProject).map(t => t.name);
    const newTags = tags.filter(t => !t.existsInProject).map(t => t.name);

    const systemPrompt = `You are an expert at analyzing taxonomy terms (tags and categories) for a blog import system.

Your task is to identify NEW tags/categories from an import that should be mapped to EXISTING tags/categories in the project to avoid creating duplicates.

CRITICAL RULES:
1. ONLY map NEW items to EXISTING items - never map new to new
2. The goal is to prevent duplicate creation, NOT to reduce the number of new items
3. A new item should only map to an existing item if they represent the same concept
4. Consider language differences: a new tag can match an existing tag in a different language (e.g., "Photography" should map to "Fotografie" if that exists)
5. Consider variations like: different casing, singular/plural, abbreviations, hyphenation, synonyms
6. Only suggest mappings where there is a clear semantic match - not every new item needs a mapping

EXAMPLES OF VALID MAPPINGS (new → existing):
- "Photos" → "Photography" (if Photography exists)
- "Fotografie" → "Photography" (language variation, if Photography exists)  
- "tech" → "Technology" (abbreviation, if Technology exists)
- "Web Dev" → "Web Development" (abbreviation, if Web Development exists)

DO NOT:
- Map a new item to another new item
- Suggest mappings just because items are in the same topic area
- Create mappings for items that are distinct concepts

RESPONSE FORMAT:
You MUST respond with valid JSON only, no other text. Use this exact structure:
{
  "categoryMappings": { "New Category": "Existing Category", ... },
  "tagMappings": { "New Tag": "Existing Tag", ... }
}

The source (key) MUST be from the NEW items list, and the target (value) MUST be from the EXISTING items list.
If there are no sensible mappings to suggest, return empty objects.`;

    const userPrompt = `Analyze these taxonomy items from a WordPress import. Identify NEW items that should be mapped to EXISTING items to avoid duplicates.

EXISTING CATEGORIES IN PROJECT (map TO these):
${existingCategories.length > 0 ? existingCategories.join(', ') : '(none)'}

NEW CATEGORIES FROM IMPORT (map FROM these):
${newCategories.length > 0 ? newCategories.join(', ') : '(none)'}

EXISTING TAGS IN PROJECT (map TO these):
${existingTags.length > 0 ? existingTags.join(', ') : '(none)'}

NEW TAGS FROM IMPORT (map FROM these):
${newTags.length > 0 ? newTags.join(', ') : '(none)'}

Remember: Only suggest mappings from NEW items to EXISTING items. Consider language differences (e.g., German/English equivalents). Response must be valid JSON only.`;

    try {
      let responseText = '';

      if (provider === 'anthropic') {
        const body = {
          model: modelId,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        };

        const response = await this.httpRequest(ZEN_ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });

        if (response.statusCode !== 200) {
          console.error('[OpenCodeManager] Taxonomy analysis failed:', response.body);
          return { success: false, error: `API request failed: ${response.statusCode}` };
        }

        const data = JSON.parse(response.body);
        // Extract text from Anthropic response
        for (const block of data.content || []) {
          if (block.type === 'text') {
            responseText += block.text;
          }
        }
      } else {
        // OpenAI-compatible
        const body = {
          model: modelId,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        };

        const response = await this.httpRequest(ZEN_OPENAI_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (response.statusCode !== 200) {
          console.error('[OpenCodeManager] Taxonomy analysis failed:', response.body);
          return { success: false, error: `API request failed: ${response.statusCode}` };
        }

        const data = JSON.parse(response.body);
        responseText = data.choices?.[0]?.message?.content || '';
      }

      // Parse the JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[OpenCodeManager] No JSON found in response:', responseText);
        return { success: false, error: 'Invalid response format from AI' };
      }

      const result = JSON.parse(jsonMatch[0]);
      
      // Validate and filter mappings to ensure they follow the new→existing rule
      const validatedCategoryMappings: Record<string, string> = {};
      const validatedTagMappings: Record<string, string> = {};
      
      // Filter category mappings: source must be new, target must be existing
      const newCatSet = new Set(newCategories);
      const existingCatSet = new Set(existingCategories);
      for (const [source, target] of Object.entries(result.categoryMappings || {})) {
        if (newCatSet.has(source) && existingCatSet.has(target as string)) {
          validatedCategoryMappings[source] = target as string;
        } else {
          console.log(`[OpenCodeManager] Filtered out invalid category mapping: "${source}" → "${target}"`);
        }
      }
      
      // Filter tag mappings: source must be new, target must be existing
      const newTagSet = new Set(newTags);
      const existingTagSet = new Set(existingTags);
      for (const [source, target] of Object.entries(result.tagMappings || {})) {
        if (newTagSet.has(source) && existingTagSet.has(target as string)) {
          validatedTagMappings[source] = target as string;
        } else {
          console.log(`[OpenCodeManager] Filtered out invalid tag mapping: "${source}" → "${target}"`);
        }
      }
      
      return {
        success: true,
        categoryMappings: validatedCategoryMappings,
        tagMappings: validatedTagMappings,
      };
    } catch (error) {
      console.error('[OpenCodeManager] Error analyzing taxonomy:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Analyze a media image and generate title, alt text, and caption using AI
   * This is a one-shot request that looks at the image and suggests metadata
   */
  async analyzeMediaImage(mediaId: string, language: string = 'en'): Promise<{
    success: boolean;
    title?: string;
    alt?: string;
    caption?: string;
    error?: string;
  }> {
    if (!this.apiKey) {
      return { success: false, error: 'API key not configured. Please set your OpenCode API key in Settings.' };
    }

    // Get media metadata
    const mediaItem = await this.mediaEngine.getMedia(mediaId);
    if (!mediaItem) {
      return { success: false, error: 'Media item not found' };
    }

    // Verify it's an image
    if (!mediaItem.mimeType.startsWith('image/')) {
      return { success: false, error: `Cannot analyze this file type: ${mediaItem.mimeType}. Only images are supported.` };
    }

    // Get the large thumbnail for better quality analysis (or medium as fallback)
    let dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'large');
    if (!dataUrl) {
      dataUrl = await this.mediaEngine.getThumbnailDataUrl(mediaId, 'medium');
    }
    if (!dataUrl) {
      return { success: false, error: 'Image thumbnail not available. Try regenerating thumbnails from Settings.' };
    }

    // Extract base64 data (remove data:image/webp;base64, prefix)
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');

    // Map language code to full name for clearer instructions
    const languageNames: Record<string, string> = {
      en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
      pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', ja: 'Japanese',
      zh: 'Chinese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish',
      sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech',
    };
    const languageName = languageNames[language] || language;

    const systemPrompt = `Generate title, alt text, and caption for this image in ${languageName}.

TITLE: A short, descriptive title for display in lists and search results (3-8 words). Should identify the main subject.
ALT: Describe ONLY what is visually present in the image. Be factual, neutral, and concise (5-12 words max). No interpretations, emotions, or "Image of" prefix. Example: "Red bicycle leaning against white brick wall"
CAPTION: Short, engaging blog caption (5-20 words).

Respond with JSON only: {"title": "...", "alt": "...", "caption": "..."}`;

    try {
      // Using Claude Sonnet 4.5 for best image analysis
      const modelId = 'claude-sonnet-4-5';
      
      const body = {
        model: modelId,
        max_tokens: 200,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/webp',
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: 'Analyze and respond with JSON.',
              },
            ],
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

      if (response.statusCode !== 200) {
        console.error('[OpenCodeManager] Image analysis failed:', response.body);
        const errorMsg = this.parseErrorResponse(response);
        return { success: false, error: errorMsg };
      }

      const data = JSON.parse(response.body);
      
      // Extract text from Anthropic response
      let responseText = '';
      for (const block of data.content || []) {
        if (block.type === 'text') {
          responseText += block.text;
        }
      }

      // Parse the JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[OpenCodeManager] No JSON found in image analysis response:', responseText);
        return { success: false, error: 'Invalid response format from AI' };
      }

      const result = JSON.parse(jsonMatch[0]);
      
      return {
        success: true,
        title: result.title || undefined,
        alt: result.alt || undefined,
        caption: result.caption || undefined,
      };
    } catch (error) {
      console.error('[OpenCodeManager] Error analyzing media image:', error);
      return { success: false, error: (error as Error).message };
    }
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
        }, { once: true });
      }

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}
