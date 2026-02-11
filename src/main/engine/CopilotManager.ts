/**
 * CopilotManager - Handles AI chat using GitHub Copilot SDK
 * 
 * Provides native Copilot integration with custom tool support for:
 * - Searching posts with full-text search and filters
 * - Reading post content and metadata
 * - Viewing media file information
 * - Updating post and media metadata
 */

import { BrowserWindow, app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { ChatEngine, ChatMessageData } from './ChatEngine';
import { PostEngine } from './PostEngine';
import { MediaEngine } from './MediaEngine';

// ESM modules - loaded dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CopilotClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let defineTool: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let z: any = null;

let modulesLoaded = false;

// Dynamic import that bypasses TypeScript transformation to properly handle ESM
// TypeScript compiles import() to require() in CommonJS, which breaks ESM-only packages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

/**
 * Load ESM modules dynamically (required for CommonJS compatibility)
 */
async function loadModules(): Promise<boolean> {
  if (modulesLoaded) return true;

  try {
    // Use dynamicImport to bypass TypeScript's transformation of import() to require()
    const copilotSdk = await dynamicImport('@github/copilot-sdk');
    CopilotClient = copilotSdk.CopilotClient;
    defineTool = copilotSdk.defineTool;

    const zod = await dynamicImport('zod');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    z = (zod as any).z || (zod as any).default?.z || zod;

    modulesLoaded = true;
    console.log('[CopilotManager] ESM modules loaded successfully');
    return true;
  } catch (error) {
    console.error('[CopilotManager] Failed to load ESM modules:', error);
    return false;
  }
}

interface CopilotSession {
  sessionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  conversationId: string;
  isResumed?: boolean;
  model?: string;
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

export class CopilotManager {
  private chatEngine: ChatEngine;
  private postEngine: PostEngine;
  private mediaEngine: MediaEngine;
  private getMainWindow: () => BrowserWindow | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private sessions: Map<string, CopilotSession> = new Map();
  private isInitialized = false;
  private initError: string | null = null;
  private initPromise: Promise<{ success: boolean; error?: string }> | null = null;
  private isStopping = false;

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
   * Get tools for the Copilot SDK
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getToolsForCopilot(): any[] {
    if (!modulesLoaded || !defineTool || !z) {
      console.warn('[CopilotManager] Modules not loaded, returning empty tools list');
      return [];
    }

    const tools = [
      // Search posts with full-text search and filters
      defineTool('search_posts', {
        description: 'Search blog posts using full-text search. Can filter by category or tags. Returns matching posts with their metadata.',
        parameters: z.object({
          query: z.string().describe('The search query text to find in posts'),
          category: z.string().optional().describe('Optional category to filter by (e.g., "article", "picture", "aside", "page")'),
          tags: z.array(z.string()).optional().describe('Optional array of tags to filter by'),
          limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
        }),
        handler: async (args: { query: string; category?: string; tags?: string[]; limit?: number }) => {
          try {
            // Get search results (returns id, title, slug, excerpt)
            const searchResults = await this.postEngine.searchPosts(args.query);
            
            // Fetch full post data for filtering
            const fullPosts = await Promise.all(
              searchResults.map(sr => this.postEngine.getPost(sr.id))
            );
            
            // Filter by category and tags
            let filteredPosts = fullPosts.filter(p => p !== null);
            
            if (args.category) {
              filteredPosts = filteredPosts.filter(p => p!.categories.includes(args.category!));
            }
            
            if (args.tags && args.tags.length > 0) {
              filteredPosts = filteredPosts.filter(p => 
                args.tags!.every(tag => p!.tags.includes(tag))
              );
            }
            
            // Apply limit
            const limit = args.limit || 10;
            filteredPosts = filteredPosts.slice(0, limit);

            return {
              success: true,
              count: filteredPosts.length,
              posts: filteredPosts.map(p => ({
                id: p!.id,
                title: p!.title,
                slug: p!.slug,
                excerpt: p!.excerpt,
                status: p!.status,
                categories: p!.categories,
                tags: p!.tags,
                createdAt: p!.createdAt,
                updatedAt: p!.updatedAt,
              })),
            };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // Read a single post
      defineTool('read_post', {
        description: 'Read the full content and metadata of a specific blog post by its ID.',
        parameters: z.object({
          postId: z.string().describe('The unique ID of the post to read'),
        }),
        handler: async (args: { postId: string }) => {
          try {
            const post = await this.postEngine.getPost(args.postId);
            if (!post) {
              return { success: false, error: 'Post not found' };
            }
            return {
              success: true,
              post: {
                id: post.id,
                title: post.title,
                slug: post.slug,
                content: post.content,
                excerpt: post.excerpt,
                status: post.status,
                author: post.author,
                categories: post.categories,
                tags: post.tags,
                createdAt: post.createdAt,
                updatedAt: post.updatedAt,
                publishedAt: post.publishedAt,
              },
            };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // Get media file information
      defineTool('get_media', {
        description: 'Get information about a specific media file (image) by its ID.',
        parameters: z.object({
          mediaId: z.string().describe('The unique ID of the media file'),
        }),
        handler: async (args: { mediaId: string }) => {
          try {
            const media = await this.mediaEngine.getMedia(args.mediaId);
            if (!media) {
              return { success: false, error: 'Media not found' };
            }
            return {
              success: true,
              media: {
                id: media.id,
                filename: media.filename,
                originalName: media.originalName,
                mimeType: media.mimeType,
                size: media.size,
                width: media.width,
                height: media.height,
                alt: media.alt,
                caption: media.caption,
                tags: media.tags,
                createdAt: media.createdAt,
                updatedAt: media.updatedAt,
              },
            };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // List all media files
      defineTool('list_media', {
        description: 'List all media files in the current project with optional filtering.',
        parameters: z.object({
          mimeTypeFilter: z.string().optional().describe('Filter by MIME type prefix (e.g., "image/")'),
          limit: z.number().optional().describe('Maximum number of results (default: 20)'),
        }),
        handler: async (args: { mimeTypeFilter?: string; limit?: number }) => {
          try {
            let mediaList = await this.mediaEngine.getAllMedia();
            
            if (args.mimeTypeFilter) {
              mediaList = mediaList.filter(m => m.mimeType.startsWith(args.mimeTypeFilter!));
            }
            
            const limit = args.limit || 20;
            mediaList = mediaList.slice(0, limit);

            return {
              success: true,
              count: mediaList.length,
              media: mediaList.map(m => ({
                id: m.id,
                filename: m.filename,
                originalName: m.originalName,
                mimeType: m.mimeType,
                alt: m.alt,
                tags: m.tags,
              })),
            };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // Update post metadata
      defineTool('update_post_metadata', {
        description: 'Update metadata for a blog post (title, excerpt, tags, categories). Does NOT update post content.',
        parameters: z.object({
          postId: z.string().describe('The unique ID of the post to update'),
          title: z.string().optional().describe('New title for the post'),
          excerpt: z.string().optional().describe('New excerpt/summary for the post'),
          tags: z.array(z.string()).optional().describe('New tags for the post'),
          categories: z.array(z.string()).optional().describe('New categories for the post'),
        }),
        handler: async (args: { postId: string; title?: string; excerpt?: string; tags?: string[]; categories?: string[] }) => {
          try {
            const updates: Record<string, unknown> = {};
            if (args.title !== undefined) updates.title = args.title;
            if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
            if (args.tags !== undefined) updates.tags = args.tags;
            if (args.categories !== undefined) updates.categories = args.categories;

            if (Object.keys(updates).length === 0) {
              return { success: false, error: 'No updates provided' };
            }

            await this.postEngine.updatePost(args.postId, updates);
            return { success: true, message: `Post ${args.postId} metadata updated successfully` };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // Update media metadata
      defineTool('update_media_metadata', {
        description: 'Update metadata for a media file (alt text, caption, tags).',
        parameters: z.object({
          mediaId: z.string().describe('The unique ID of the media to update'),
          alt: z.string().optional().describe('New alt text for the image'),
          caption: z.string().optional().describe('New caption for the image'),
          tags: z.array(z.string()).optional().describe('New tags for the media'),
        }),
        handler: async (args: { mediaId: string; alt?: string; caption?: string; tags?: string[] }) => {
          try {
            const updates: Record<string, unknown> = {};
            if (args.alt !== undefined) updates.alt = args.alt;
            if (args.caption !== undefined) updates.caption = args.caption;
            if (args.tags !== undefined) updates.tags = args.tags;

            if (Object.keys(updates).length === 0) {
              return { success: false, error: 'No updates provided' };
            }

            await this.mediaEngine.updateMedia(args.mediaId, updates);
            return { success: true, message: `Media ${args.mediaId} metadata updated successfully` };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),

      // List posts with filtering
      defineTool('list_posts', {
        description: 'List blog posts with optional filtering by status, category, or tags.',
        parameters: z.object({
          status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by post status'),
          category: z.string().optional().describe('Filter by category'),
          tags: z.array(z.string()).optional().describe('Filter by tags (posts must have all specified tags)'),
          limit: z.number().optional().describe('Maximum number of results (default: 20)'),
          offset: z.number().optional().describe('Offset for pagination (default: 0)'),
        }),
        handler: async (args: { status?: 'draft' | 'published' | 'archived'; category?: string; tags?: string[]; limit?: number; offset?: number }) => {
          try {
            // Use getPostsFiltered for filtering
            const filter: { status?: 'draft' | 'published' | 'archived'; tags?: string[]; categories?: string[] } = {};
            if (args.status) filter.status = args.status;
            if (args.tags) filter.tags = args.tags;
            if (args.category) filter.categories = [args.category];

            let posts;
            if (Object.keys(filter).length > 0) {
              posts = await this.postEngine.getPostsFiltered(filter);
            } else {
              const result = await this.postEngine.getAllPosts({
                limit: args.limit || 20,
                offset: args.offset || 0,
              });
              posts = result.items;
            }

            // Apply offset/limit for filtered results
            const offset = args.offset || 0;
            const limit = args.limit || 20;
            const slicedPosts = posts.slice(offset, offset + limit);

            return {
              success: true,
              count: slicedPosts.length,
              total: posts.length,
              hasMore: offset + limit < posts.length,
              posts: slicedPosts.map(p => ({
                id: p.id,
                title: p.title,
                slug: p.slug,
                status: p.status,
                categories: p.categories,
                tags: p.tags,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
              })),
            };
          } catch (error) {
            return { success: false, error: (error as Error).message };
          }
        },
      }),
    ];

    return tools;
  }

  /**
   * Initialize the Copilot client
   * Uses a lock to prevent concurrent initialization attempts
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    // Already initialized
    if (this.isInitialized && this.client) {
      return { success: true };
    }

    // If stopping, don't initialize
    if (this.isStopping) {
      return { success: false, error: 'Client is stopping' };
    }

    // If already initializing, wait for that to complete
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this.doInitialize();
    const result = await this.initPromise;
    this.initPromise = null;
    return result;
  }

  private async doInitialize(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[CopilotManager] Initializing Copilot client...');

      const loaded = await loadModules();
      if (!loaded) {
        return { success: false, error: 'Failed to load Copilot SDK modules' };
      }

      // Check again in case stop was called during module loading
      if (this.isStopping) {
        return { success: false, error: 'Client is stopping' };
      }

      console.log('[CopilotManager] Creating CopilotClient instance...');
      this.client = new CopilotClient({
        autoStart: true,
        autoRestart: true,
        useLoggedInUser: true,
        logLevel: 'info',
      });

      console.log('[CopilotManager] Starting client...');
      await this.client.start();
      console.log('[CopilotManager] Client started successfully');

      this.isInitialized = true;
      this.initError = null;

      console.log('[CopilotManager] Copilot client initialized successfully');
      return { success: true };
    } catch (error) {
      console.error('[CopilotManager] Failed to initialize Copilot client:', error);
      this.initError = (error as Error).message;
      this.isInitialized = false;
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Check if Copilot is ready
   */
  async checkReady(): Promise<{ ready: boolean; error?: string; requiresCLI?: boolean }> {
    try {
      if (!this.isInitialized) {
        const result = await this.initialize();
        if (!result.success) {
          const isCLIError =
            result.error?.includes('copilot') ||
            result.error?.includes('ENOENT') ||
            result.error?.includes('spawn');

          return {
            ready: false,
            error: result.error,
            requiresCLI: isCLIError,
          };
        }
      }

      await this.client.ping();
      return { ready: true };
    } catch (error) {
      console.error('[CopilotManager] Ready check failed:', error);
      return {
        ready: false,
        error: (error as Error).message,
        requiresCLI:
          (error as Error).message?.includes('copilot') ||
          (error as Error).message?.includes('ENOENT'),
      };
    }
  }

  /**
   * Get or create a session for a conversation
   */
  private async getOrCreateSession(
    conversationId: string,
    options: { model?: string; systemMessage?: string; copilotSessionId?: string; forceNewSession?: boolean } = {}
  ): Promise<CopilotSession> {
    console.log(`[CopilotManager] getOrCreateSession called with model: ${options.model || 'default (gpt-4.1)'}`);

    if (this.sessions.has(conversationId)) {
      const existingSession = this.sessions.get(conversationId)!;
      if (options.model && existingSession.model !== options.model) {
        console.log(`[CopilotManager] Model changed, creating new session`);
        this.sessions.delete(conversationId);
      } else {
        return existingSession;
      }
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    const tools = this.getToolsForCopilot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let session: any;
    let isResumed = false;

    // Try to resume existing session
    if (options.copilotSessionId && !options.forceNewSession) {
      try {
        console.log(`[CopilotManager] Resuming session: ${options.copilotSessionId}`);
        session = await this.client.resumeSession(options.copilotSessionId, {
          streaming: true,
          tools,
        });
        isResumed = true;
        console.log(`[CopilotManager] Session resumed successfully`);
      } catch (error) {
        console.log(`[CopilotManager] Failed to resume session, creating new: ${(error as Error).message}`);
        session = null;
      }
    }

    // Create new session if needed
    if (!session) {
      const modelToUse = options.model || 'gpt-4.1';
      console.log(`[CopilotManager] Creating new session for conversation: ${conversationId} with model: ${modelToUse}`);
      session = await this.client.createSession({
        model: modelToUse,
        streaming: true,
        tools,
        systemMessage: options.systemMessage
          ? {
              content: options.systemMessage,
            }
          : undefined,
      });
      console.log(`[CopilotManager] New session created: ${session.sessionId}`);

      // Store session ID in database
      try {
        await this.chatEngine.updateConversation(conversationId, {
          copilotSessionId: session.sessionId,
        });
      } catch (error) {
        console.error(`[CopilotManager] Failed to save session ID: ${(error as Error).message}`);
      }
    }

    const copilotSession: CopilotSession = {
      sessionId: session.sessionId,
      session,
      conversationId,
      isResumed,
      model: options.model || 'gpt-4.1',
    };

    this.sessions.set(conversationId, copilotSession);
    return copilotSession;
  }

  /**
   * Send a message to a conversation
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

      // Get or create session
      const systemMessage = conversation.messages.find(m => m.role === 'system');
      const copilotSession = await this.getOrCreateSession(conversationId, {
        model: conversation.model,
        systemMessage: systemMessage?.content,
        copilotSessionId: conversation.copilotSessionId,
      });

      // Add user message to database
      await this.chatEngine.addMessage({
        conversationId,
        role: 'user',
        content: userMessage,
        createdAt: new Date(),
      });

      // Collect response
      let fullResponse = '';
      const toolCalls: Array<{ name: string; args: unknown }> = [];

      // Set up event handlers
      const unsubscribeDelta = copilotSession.session.on('assistant.message_delta', (event: { data: { deltaContent?: string } }) => {
        fullResponse += event.data.deltaContent || '';
        if (onDelta) {
          onDelta(event.data.deltaContent || '');
        }
      });

      const unsubscribeToolStart = copilotSession.session.on('tool.execution_start', (event: { data?: { toolName?: string; args?: unknown } }) => {
        if (onToolCall) {
          onToolCall({
            name: event.data?.toolName || 'unknown',
            args: event.data?.args,
          });
        }
        toolCalls.push({
          name: event.data?.toolName || 'unknown',
          args: event.data?.args,
        });
      });

      const unsubscribeToolEnd = copilotSession.session.on('tool.execution_end', (event: { data?: { toolName?: string; result?: unknown } }) => {
        if (onToolResult) {
          onToolResult({
            name: event.data?.toolName || 'unknown',
            result: event.data?.result,
          });
        }
      });

      try {
        // Send message and wait for completion (5 minute timeout)
        const response = await copilotSession.session.sendAndWait(
          {
            prompt: userMessage,
          },
          300000
        );

        // Use final content if available
        if (response?.data?.content) {
          fullResponse = response.data.content;
        }

        // Save assistant response
        if (fullResponse) {
          await this.chatEngine.addMessage({
            conversationId,
            role: 'assistant',
            content: fullResponse,
            toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
            createdAt: new Date(),
          });
        }

        // Generate title after first exchange
        const userMsgCount = conversation.messages.filter(m => m.role === 'user').length;
        if (userMsgCount === 0 && fullResponse) {
          this.generateConversationTitle(conversationId, userMessage, fullResponse).catch(err =>
            console.error('[CopilotManager] Error generating title:', err)
          );
        }

        return {
          success: true,
          message: fullResponse,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      } finally {
        unsubscribeDelta();
        unsubscribeToolStart();
        unsubscribeToolEnd();
      }
    } catch (error) {
      console.error('[CopilotManager] Error sending message:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Generate a title for a conversation based on first exchange
   */
  private async generateConversationTitle(conversationId: string, userMessage: string, assistantResponse: string): Promise<void> {
    try {
      // Create a quick session just for title generation
      const titleSession = await this.client.createSession({
        model: 'gpt-4.1-mini',
        streaming: false,
      });

      const response = await titleSession.sendAndWait({
        prompt: `Generate a short, concise title (max 6 words) for this conversation. Only output the title, nothing else.
        
User: ${userMessage.substring(0, 200)}
Assistant: ${assistantResponse.substring(0, 200)}`,
      });

      if (response?.data?.content) {
        const title = response.data.content.trim().replace(/^["']|["']$/g, '');
        await this.chatEngine.updateConversation(conversationId, { title });

        // Notify UI of title update
        const mainWindow = this.getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('chat-title-updated', { conversationId, title });
        }
      }

      await titleSession.destroy();
    } catch (error) {
      console.error('[CopilotManager] Error generating title:', error);
    }
  }

  /**
   * Abort a currently running message
   */
  async abortMessage(conversationId: string): Promise<{ success: boolean; error?: string }> {
    const copilotSession = this.sessions.get(conversationId);
    if (!copilotSession) {
      return { success: false, error: 'No active session for this conversation' };
    }

    try {
      await copilotSession.session.abort();
      console.log('[CopilotManager] Aborted message for conversation:', conversationId);
      return { success: true };
    } catch (error) {
      console.error('[CopilotManager] Error aborting message:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Destroy a session
   */
  async destroySession(conversationId: string): Promise<void> {
    const copilotSession = this.sessions.get(conversationId);
    if (copilotSession) {
      try {
        await copilotSession.session.destroy();
      } catch (error) {
        console.error('[CopilotManager] Error destroying session:', error);
      }
      this.sessions.delete(conversationId);
    }
  }

  /**
   * Get authentication status
   * Does not auto-initialize - returns unauthenticated if client not ready
   */
  async getAuthStatus(): Promise<{ isAuthenticated: boolean; authType?: string; login?: string; error?: string }> {
    try {
      // Don't auto-initialize on auth check - let frontend trigger login explicitly
      if (!this.isInitialized || !this.client) {
        return { isAuthenticated: false };
      }

      const authStatus = await this.client.getAuthStatus();
      return {
        isAuthenticated: authStatus.isAuthenticated,
        authType: authStatus.authType,
        login: authStatus.login,
      };
    } catch (error) {
      console.error('[CopilotManager] Error getting auth status:', error);
      return { isAuthenticated: false, error: (error as Error).message };
    }
  }

  /**
   * Get CLI path for the native Copilot binary
   */
  private getCLIPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const packageName = `@github/copilot-${platform}-${arch}`;
    const exeName = platform === 'win32' ? 'copilot.exe' : 'copilot';

    // In production (packaged app), node_modules is in resources/app.asar.unpacked
    // In development, it's in the project root
    const isPackaged = app.isPackaged;

    let cliPath: string;
    if (isPackaged) {
      // In packaged app, asarUnpack puts these in app.asar.unpacked
      const resourcesPath = process.resourcesPath;
      cliPath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', packageName, exeName);
    } else {
      // In development
      cliPath = path.join(__dirname, '..', '..', '..', 'node_modules', packageName, exeName);
    }

    console.log('[CopilotManager] CLI path:', cliPath);
    return cliPath;
  }

  /**
   * Trigger interactive login using the CLI
   */
  async triggerLogin(options: {
    onDeviceCode?: (deviceCode: { verificationUri: string; userCode: string }) => void;
    onMessage?: (message: string) => void;
  } = {}): Promise<{ success: boolean; error?: string; login?: string }> {
    const { onDeviceCode, onMessage } = options;

    return new Promise((resolve) => {
      const cliPath = this.getCLIPath();

      console.log('[CopilotManager] Triggering interactive login...');
      if (onMessage) onMessage('Starting authentication...');

      // Spawn the CLI with 'login' command
      const cliProcess = spawn(cliPath, ['login'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';
      let deviceCodeSent = false;

      cliProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        console.log('[CopilotManager] CLI stdout:', text);

        // Parse for device code information
        if (!deviceCodeSent) {
          const urlMatch = text.match(/https:\/\/github\.com\/login\/device/);
          const codeMatch = text.match(/code[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i);

          if (urlMatch && codeMatch) {
            deviceCodeSent = true;
            if (onDeviceCode) {
              onDeviceCode({
                verificationUri: 'https://github.com/login/device',
                userCode: codeMatch[1]
              });
            }
          }
        }

        if (onMessage) {
          onMessage(text.trim());
        }
      });

      cliProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        console.log('[CopilotManager] CLI stderr:', text);

        // Some CLIs output to stderr for prompts
        if (!deviceCodeSent) {
          const urlMatch = text.match(/https:\/\/github\.com\/login\/device/);
          const codeMatch = text.match(/code[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i);

          if (urlMatch && codeMatch) {
            deviceCodeSent = true;
            if (onDeviceCode) {
              onDeviceCode({
                verificationUri: 'https://github.com/login/device',
                userCode: codeMatch[1]
              });
            }
          }
        }

        if (onMessage) {
          onMessage(text.trim());
        }
      });

      cliProcess.on('close', (code: number) => {
        console.log('[CopilotManager] CLI login process exited with code:', code);

        if (code === 0) {
          // Re-initialize client to pick up new credentials
          this.isInitialized = false;
          this.client = null;
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr || `Login failed with code ${code}` });
        }
      });

      cliProcess.on('error', (error: Error) => {
        console.error('[CopilotManager] CLI spawn error:', error);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Logout from Copilot (stops client - no CLI logout command exists)
   */
  async logout(): Promise<{ success: boolean; error?: string }> {
    console.log('[CopilotManager] Logging out (stopping client)...');

    try {
      await this.stop();
      return { success: true };
    } catch (error) {
      console.error('[CopilotManager] Error during logout:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const models = await this.client.getAvailableModels();
      return models || ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4'];
    } catch (error) {
      console.error('[CopilotManager] Error getting models:', error);
      return ['gpt-4.1', 'gpt-4.1-mini', 'claude-sonnet-4'];
    }
  }

  /**
   * Stop the client
   */
  async stop(): Promise<void> {
    // Set stopping flag to prevent new initialization attempts
    this.isStopping = true;

    // Wait for any pending initialization to complete (or fail)
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Ignore initialization errors during shutdown
      }
    }

    // Clear sessions first
    for (const [conversationId] of this.sessions) {
      try {
        await this.destroySession(conversationId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.sessions.clear();

    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        // Ignore errors during cleanup - client may not be fully initialized
      }
      this.client = null;
      this.isInitialized = false;
    }
  }
}
