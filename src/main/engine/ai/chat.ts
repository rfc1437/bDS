/**
 * ChatService — streaming chat using AI SDK's streamText().
 *
 * Streaming chat service using AI SDK v6 streamText().
 *
 * AI SDK handles:
 *   - SSE parsing, reconnection, abort
 *   - Provider-specific request/response format (Anthropic Messages, OpenAI Chat Completions)
 *   - Tool call/result loop (maxSteps)
 *   - Token usage extraction
 */

import { streamText, generateText, stepCountIs } from 'ai';
import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { BrowserWindow } from 'electron';
import type { ChatEngine, ChatMessageData } from '../ChatEngine';
import { isRenderTool, generateFromToolCall } from '../../a2ui/generator';
import type { A2UIServerMessage } from '../../a2ui/types';
import { ProviderRegistry } from './providers';
import { createBlogTools, type BlogToolDeps } from './blog-tools';
import { createA2UITools } from './a2ui-tools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatCallbacks {
  onDelta?: (delta: string) => void;
  onToolCall?: (toolCall: { name: string; args: unknown }) => void;
  onToolResult?: (result: { name: string; result: unknown }) => void;
  onA2UIMessage?: (message: A2UIServerMessage) => void;
  onTokenUsage?: (usage: TokenUsageReport) => void;
}

export interface TokenUsageReport {
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
}

export interface SendResult {
  success: boolean;
  message?: string;
  error?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
}

// Maximum tool-call rounds per request
const MAX_TOOL_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Message serialization — DB flat rows ↔ AI SDK messages
// ---------------------------------------------------------------------------

/**
 * Convert DB message rows into AI SDK Message[] for `streamText({ messages })`.
 * DB stores flat rows: role, content, toolCallId, toolCalls (JSON).
 * AI SDK expects structured messages with content parts.
 *
 * Per Open Questions #3: only user/assistant messages are sent, tool call
 * details from previous turns are appended as text annotations.
 */
function dbMessagesToAIMessages(
  dbMessages: Pick<ChatMessageData, 'role' | 'content' | 'toolCalls'>[],
): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content || '' });
    } else if (msg.role === 'assistant') {
      let content = msg.content || '';
      // Append tool-call annotation from previous turns
      if (msg.toolCalls) {
        try {
          const calls = JSON.parse(msg.toolCalls) as Array<{ name: string; args: unknown }>;
          if (calls.length > 0) {
            const summary = calls
              .map(tc => `- ${tc.name}(${JSON.stringify(tc.args)})`)
              .join('\n');
            content += `\n\n[Tools used in this turn:\n${summary}\n]`;
          }
        } catch {
          // Ignore malformed tool call JSON
        }
      }
      messages.push({ role: 'assistant', content });
    }
    // System and tool messages from DB are not sent — system is passed separately,
    // tool results are only used within the same request via maxSteps.
  }

  return messages;
}

// ---------------------------------------------------------------------------
// System prompt augmentation
// ---------------------------------------------------------------------------

/** Append live blog stats to the system prompt for data-volume awareness. */
async function appendBlogStats(
  basePrompt: string,
  blogToolDeps: BlogToolDeps,
): Promise<string> {
  try {
    const stats = await blogToolDeps.postEngine.getBlogStats();
    const mediaList = await blogToolDeps.mediaEngine.getAllMedia();

    if (stats.totalPosts === 0) return basePrompt;

    const dateRange = stats.oldestPostDate && stats.newestPostDate
      ? `from ${stats.oldestPostDate.toISOString().split('T')[0]} to ${stats.newestPostDate.toISOString().split('T')[0]}`
      : 'unknown';

    const yearBreakdown = Object.entries(stats.postsPerYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => `${year}: ${count}`)
      .join(', ');

    return basePrompt + `

--- CURRENT BLOG DATA SUMMARY ---
Total posts: ${stats.totalPosts} (${stats.publishedCount} published, ${stats.draftCount} drafts, ${stats.archivedCount} archived)
Date range: ${dateRange}
Posts per year: ${yearBreakdown}
Unique tags: ${stats.tagCount}, Unique categories: ${stats.categoryCount}
Total media files: ${mediaList.length}
NOTE: Use pagination (offset/limit) in list_posts and search_posts to access all data. Default page size is 20.`;
  } catch {
    return basePrompt;
  }
}

// ---------------------------------------------------------------------------
// Token estimation (for context truncation)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Drop oldest user+assistant pairs to fit within context budget.
 * Preserves the most recent messages for continuity.
 */
function truncateMessages(
  messages: ModelMessage[],
  systemPrompt: string,
  toolsJson: string,
  maxContextTokens: number,
): ModelMessage[] {
  const systemTokens = estimateTokens(systemPrompt);
  const toolsTokens = estimateTokens(toolsJson);
  const responseReserve = 4096;
  const availableBudget = maxContextTokens - systemTokens - toolsTokens - responseReserve;

  if (availableBudget <= 0) return messages.slice(-1);

  const messageTokens = () =>
    messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0);

  if (messageTokens() <= availableBudget) return messages;

  let truncated = [...messages];
  while (truncated.length > 2 && messageTokens.call(null) > availableBudget) {
    if (truncated[0].role === 'user') {
      truncated = truncated.slice(2); // Drop user + assistant pair
    } else {
      truncated = truncated.slice(1);
    }
  }

  return truncated;
}

// ---------------------------------------------------------------------------
// ChatService
// ---------------------------------------------------------------------------

export class ChatService {
  private chatEngine: ChatEngine;
  private providers: ProviderRegistry;
  private blogToolDeps: BlogToolDeps;
  private getMainWindow: () => BrowserWindow | null;

  // Abort controllers per conversation
  private abortControllers = new Map<string, AbortController>();

  // Cumulative token usage per conversation
  private conversationUsage = new Map<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>();

  constructor(
    chatEngine: ChatEngine,
    providers: ProviderRegistry,
    blogToolDeps: BlogToolDeps,
    getMainWindow: () => BrowserWindow | null,
  ) {
    this.chatEngine = chatEngine;
    this.providers = providers;
    this.blogToolDeps = blogToolDeps;
    this.getMainWindow = getMainWindow;
  }

  /**
   * Send a user message, stream the AI response with tool use.
   * Send a message in a conversation, streaming the response.
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
    callbacks: ChatCallbacks = {},
  ): Promise<SendResult> {
    try {
      // Readiness check
      if (!this.providers.isReady()) {
        return { success: false, error: 'API key not configured' };
      }

      // Load conversation
      const conversation = await this.chatEngine.getConversation(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      // Add user message to DB
      await this.chatEngine.addMessage({
        conversationId,
        role: 'user',
        content: userMessage,
        createdAt: new Date(),
      });

      // Abort controller
      const abortController = new AbortController();
      this.abortControllers.set(conversationId, abortController);

      let modelId = conversation.model || 'claude-sonnet-4';

      // In offline mode, swap to the configured offline chat model
      if (this.providers.isOfflineMode()) {
        if (!this.providers.isOllamaModel(modelId) && !this.providers.isLmstudioModel(modelId)) {
          const offlineModel = await this.chatEngine.getSetting('offline_chat_model');
          if (offlineModel) {
            modelId = offlineModel;
          } else {
            return { success: false, error: 'No offline chat model configured. Set one in Settings → AI → Airplane Mode.' };
          }
        }
      }

      const provider = this.providers.detectModelProvider(modelId);

      // Verify provider key is available
      if (!this.providers.isProviderKeySet(provider)) {
        const providerLabel = provider === 'mistral' ? 'Mistral' : provider === 'ollama' ? 'Ollama' : 'OpenCode';
        return { success: false, error: `The model '${modelId}' requires a ${providerLabel} API key. Configure it in Settings.` };
      }

      // Build system prompt with live blog stats
      const systemMessage = conversation.messages.find(m => m.role === 'system');
      const basePrompt = systemMessage?.content || await this.chatEngine.getDefaultSystemPrompt();
      const systemPrompt = await appendBlogStats(basePrompt, this.blogToolDeps);

      // Convert DB messages to AI SDK format
      const dbMessages = conversation.messages.filter(m => m.role !== 'system');
      dbMessages.push({
        conversationId,
        role: 'user',
        content: userMessage,
        createdAt: new Date(),
      });

      const aiMessages = dbMessagesToAIMessages(dbMessages);

      // Build tools (skip for Ollama/LM Studio models unless capability override is set)
      const isOllama = this.providers.isOllamaModel(modelId);
      const isLmstudio = this.providers.isLmstudioModel(modelId);
      const skipTools = (isOllama && !this.providers.ollamaModelSupportsTools(modelId))
        || (isLmstudio && !this.providers.lmstudioModelSupportsTools(modelId));
      const blogTools = skipTools ? {} : createBlogTools(this.blogToolDeps);
      const a2uiToolsRaw = skipTools ? {} : createA2UITools();
      const allTools = { ...blogTools, ...a2uiToolsRaw };
      const hasTools = Object.keys(allTools).length > 0;

      // Get context window for truncation
      const contextWindow = await this.providers.getModelCatalogEngine().getContextWindow(modelId) ?? 150_000;
      const truncatedMessages = truncateMessages(
        aiMessages,
        systemPrompt,
        JSON.stringify(Object.keys(allTools)),
        contextWindow,
      );

      // Resolve model
      const model = this.providers.resolveModel(modelId);

      // Compute turn index for A2UI messages
      const turnIndex = dbMessages.filter(m => m.role === 'user').length - 1;

      // Track tool calls for response
      const allToolCalls: Array<{ name: string; args: unknown }> = [];

      // Build Anthropic-specific provider options for cache control
      const providerOptions = modelId.startsWith('claude')
        ? { anthropic: { cacheControl: { type: 'ephemeral' as const } } }
        : undefined;

      try {
        // --- streamText: the AI SDK replaces our entire SSE/accumulator/tool-loop ---
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools may be empty for Ollama models
        const toolsOption = hasTools ? allTools : undefined as any;
        const result = streamText({
          model,
          system: systemPrompt,
          messages: truncatedMessages,
          tools: toolsOption,
          stopWhen: hasTools ? stepCountIs(MAX_TOOL_ROUNDS) : undefined,
          abortSignal: abortController.signal,
          maxRetries: 3,
          providerOptions,
          onChunk: ({ chunk }) => {
            if (chunk.type === 'text-delta' && callbacks.onDelta) {
              callbacks.onDelta(chunk.text);
            }
          },
          onStepFinish: ({ staticToolCalls: stepToolCalls, staticToolResults: stepToolResults }) => {
            // Emit tool call/result events for each step
            if (stepToolCalls) {
              for (const tc of stepToolCalls) {
                allToolCalls.push({ name: tc.toolName, args: tc.input });
                callbacks.onToolCall?.({ name: tc.toolName, args: tc.input });
              }
            }
            if (stepToolResults) {
              for (const tr of stepToolResults) {
                const toolName = tr.toolName;
                const toolResult = tr.output;

                // Handle A2UI render tools
                if (isRenderTool(toolName)) {
                  // Find the matching tool call args
                  const matchingCall = stepToolCalls?.find(tc => tc.toolName === toolName);
                  if (matchingCall) {
                    const a2uiMessages = generateFromToolCall(
                      conversationId,
                      toolName,
                      matchingCall.input as Record<string, unknown>,
                    );
                    if (a2uiMessages && callbacks.onA2UIMessage) {
                      for (const msg of a2uiMessages) {
                        if (msg.type === 'createSurface') {
                          msg.metadata = { ...msg.metadata, turnIndex };
                        }
                        callbacks.onA2UIMessage(msg);
                      }
                    }
                  }
                }

                callbacks.onToolResult?.({ name: toolName, result: toolResult });
              }
            }
          },
        });

        // Consume the stream to completion
        const finalResult = await result.response;

        // Extract usage from the response
        const usage = await result.usage;
        this.emitUsage(conversationId, usage, callbacks);

        // Get the final text
        const fullResponse = await result.text;

        // Save assistant response to DB
        if (fullResponse) {
          await this.chatEngine.addMessage({
            conversationId,
            role: 'assistant',
            content: fullResponse,
            toolCalls: allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined,
            createdAt: new Date(),
          });
        }

        // Generate title after first user message
        const userMsgCount = conversation.messages.filter(m => m.role === 'user').length;
        if (userMsgCount === 0 && fullResponse) {
          this.generateConversationTitle(conversationId, userMessage).catch(err =>
            console.error('[ChatService] Error generating title:', err),
          );
        }

        return {
          success: true,
          message: fullResponse,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      } catch (error) {
        const isAborted = abortController.signal.aborted || (error as Error).message === 'Request cancelled';
        if (!isAborted) throw error;
        return { success: true, message: '' };
      } finally {
        this.abortControllers.delete(conversationId);
      }
    } catch (error) {
      console.error('[ChatService] Error sending message:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /** Abort an in-flight request for a conversation. */
  async abortMessage(conversationId: string): Promise<{ success: boolean; error?: string }> {
    const controller = this.abortControllers.get(conversationId);
    if (!controller) {
      return { success: false, error: 'No active request for this conversation' };
    }
    controller.abort();
    this.abortControllers.delete(conversationId);
    return { success: true };
  }

  /** Abort all in-flight requests. */
  async stop(): Promise<void> {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  // ---- Private helpers ----

  /**
   * Generate a short conversation title from the first user message.
   * Non-streaming one-shot call using the configured title model.
   */
  private async generateConversationTitle(
    conversationId: string,
    userMessage: string,
  ): Promise<void> {
    try {
      let titleModel = await this.chatEngine.getSetting('chat_title_model');

      // Fallback chain: setting → haiku → mistral-small
      if (!titleModel || !this.providers.isProviderKeySet(this.providers.detectModelProvider(titleModel))) {
        titleModel = this.providers.getOpencodeKey()
          ? 'claude-haiku-4-5'
          : this.providers.getMistralKey()
            ? 'mistral-small-latest'
            : null;
      }

      // In offline mode, swap to the configured offline title model
      if (this.providers.isOfflineMode()) {
        const offlineModel = await this.chatEngine.getSetting('offline_title_model');
        if (offlineModel) {
          titleModel = offlineModel;
        } else if (!titleModel || (!this.providers.isOllamaModel(titleModel) && !this.providers.isLmstudioModel(titleModel))) {
          return; // No offline title model — skip title generation silently
        }
      }

      if (!titleModel) return;

      const model = this.providers.resolveModel(titleModel);

      const { text } = await generateText({
        model,
        system: 'Generate an ultra-short title (2-3 words, max 25 characters) for this conversation. Focus ONLY on the topic. Ignore any capability disclaimers. Output ONLY the title text.',
        prompt: `Topic: ${userMessage.substring(0, 100)}`,
        maxOutputTokens: 20,
        maxRetries: 2,
      });

      let title = text.trim().replace(/^["']|["']$/g, '').replace(/[.!?]+$/, '');
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
    } catch (error) {
      console.error('[ChatService] Error generating title:', error);
    }
  }

  /** Emit per-turn + cumulative token usage. */
  private emitUsage(
    conversationId: string,
    usage: LanguageModelUsage | undefined,
    callbacks: ChatCallbacks,
  ): void {
    if (!usage || !callbacks.onTokenUsage) return;

    // AI SDK v6 normalizes usage into inputTokens/outputTokens
    // Cache tokens are in inputTokenDetails
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
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
}
