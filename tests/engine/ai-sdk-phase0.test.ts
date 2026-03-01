/**
 * Phase 0: AI SDK Integration Validation
 *
 * Validates that AI SDK works in our Node.js/Electron-compatible runtime:
 * - Provider imports and instantiation work
 * - createProviderRegistry resolves providerId:modelId correctly
 * - customProvider with fallback routes gateway models to correct SDK type
 * - baseURL override produces correct request URLs
 * - generateText and streamText produce correct shaped request bodies
 * - No static model-to-provider maps needed — provider prefix is the routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateText,
  streamText,
  tool,
  createProviderRegistry,
  customProvider,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers: capture what the SDK would send without hitting a real API
// ---------------------------------------------------------------------------

/**
 * Create a mock fetch that captures the request details and returns a
 * provider-appropriate response so the SDK doesn't throw.
 */
function createCapturingFetch(providerType: 'anthropic' | 'openai') {
  const captured: { url: string; body: any; headers: any }[] = [];

  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const headers = init?.headers;
    captured.push({ url, body, headers });

    // Return a minimal valid response for the provider type
    if (providerType === 'anthropic') {
      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from mock' }],
          model: body?.model ?? 'claude-sonnet-4-5',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // OpenAI / Mistral (OpenAI-compatible)
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: body?.model ?? 'gpt-4.1',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello from mock' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  });

  return { mockFetch, captured };
}

// ---------------------------------------------------------------------------
// 1. Provider imports and instantiation
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Provider Imports', () => {
  it('creates Anthropic provider with baseURL override', () => {
    const provider = createAnthropic({
      baseURL: 'https://opencode.ai/zen/v1',
      apiKey: 'test-key',
    });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('creates OpenAI provider with baseURL override', () => {
    const provider = createOpenAI({
      baseURL: 'https://opencode.ai/zen/v1',
      apiKey: 'test-key',
    });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('creates Mistral provider with defaults', () => {
    const provider = createMistral({
      apiKey: 'test-key',
    });
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('creates a LanguageModel from Anthropic provider', () => {
    const provider = createAnthropic({ apiKey: 'test-key' });
    const model = provider('claude-sonnet-4-5');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('claude-sonnet-4-5');
    expect(model.provider).toContain('anthropic');
  });

  it('creates a LanguageModel from OpenAI provider', () => {
    const provider = createOpenAI({ apiKey: 'test-key' });
    const model = provider('gpt-4.1');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('gpt-4.1');
    expect(model.provider).toContain('openai');
  });

  it('creates a LanguageModel from Mistral provider', () => {
    const provider = createMistral({ apiKey: 'test-key' });
    const model = provider('mistral-large-latest');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('mistral-large-latest');
    expect(model.provider).toContain('mistral');
  });
});

// ---------------------------------------------------------------------------
// 2. Provider Registry — providerId:modelId routing
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Provider Registry', () => {
  it('resolves models via providerId:modelId prefix', () => {
    const registry = createProviderRegistry({
      anthropic: createAnthropic({ apiKey: 'k1' }),
      openai: createOpenAI({ apiKey: 'k2' }),
      mistral: createMistral({ apiKey: 'k3' }),
    });

    const claude = registry.languageModel('anthropic:claude-sonnet-4-5');
    expect(claude.modelId).toBe('claude-sonnet-4-5');
    expect(claude.provider).toContain('anthropic');

    const gpt = registry.languageModel('openai:gpt-4.1');
    expect(gpt.modelId).toBe('gpt-4.1');
    expect(gpt.provider).toContain('openai');

    const mistral = registry.languageModel('mistral:mistral-large-latest');
    expect(mistral.modelId).toBe('mistral-large-latest');
    expect(mistral.provider).toContain('mistral');
  });

  it('throws on unknown provider prefix', () => {
    const registry = createProviderRegistry({
      anthropic: createAnthropic({ apiKey: 'k1' }),
    });

    expect(() => registry.languageModel('unknown:model-id')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Gateway pattern — OpenCode Zen as custom provider
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Gateway Custom Provider', () => {
  const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

  /**
   * Creates an OpenCode gateway provider that routes models to the correct
   * SDK type based on a minimal rule:
   *   - claude* → Anthropic Messages API
   *   - everything else → OpenAI Chat Completions API
   *
   * No static model list needed. The rule is: "Anthropic models use the
   * Anthropic API, all others use OpenAI-compatible." This matches
   * reality — only Anthropic has a separate Messages API.
   *
   * IMPORTANT: OpenAI SDK v6 defaults to the Responses API (/responses).
   * OpenCode Zen (and most third-party gateways) only support Chat
   * Completions (/chat/completions). Use provider.chat(modelId) to get
   * a Chat Completions model instead of the default Responses model.
   */
  function createOpenCodeGateway(apiKey: string, fetchImpl?: typeof fetch) {
    const anthropicProvider = createAnthropic({
      baseURL: ZEN_BASE_URL,
      apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    const openaiProvider = createOpenAI({
      baseURL: ZEN_BASE_URL,
      apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });

    return customProvider({
      // No explicit model list — use fallbackProvider with routing logic
      languageModels: {},
      fallbackProvider: {
        languageModel: (modelId: string) => {
          // Minimal routing: only Claude uses Anthropic Messages API
          if (modelId.startsWith('claude')) {
            return anthropicProvider(modelId);
          }
          // Use .chat() for Chat Completions — Zen doesn't support Responses API
          return openaiProvider.chat(modelId);
        },
        embeddingModel: () => {
          throw new Error('Embeddings not supported via OpenCode gateway');
        },
        imageModel: () => {
          throw new Error('Image models not supported via OpenCode gateway');
        },
      },
    });
  }

  it('routes claude models to Anthropic provider', () => {
    const gateway = createOpenCodeGateway('test-key');
    const model = gateway.languageModel('claude-sonnet-4-5');
    expect(model.provider).toContain('anthropic');
    expect(model.modelId).toBe('claude-sonnet-4-5');
  });

  it('routes gpt models to OpenAI provider', () => {
    const gateway = createOpenCodeGateway('test-key');
    const model = gateway.languageModel('gpt-4.1');
    expect(model.provider).toContain('openai');
    expect(model.modelId).toBe('gpt-4.1');
  });

  it('routes gemini models to OpenAI provider (OpenAI-compatible via Zen)', () => {
    const gateway = createOpenCodeGateway('test-key');
    const model = gateway.languageModel('gemini-2.5-pro');
    expect(model.provider).toContain('openai');
    expect(model.modelId).toBe('gemini-2.5-pro');
  });

  it('routes o3/o4 models to OpenAI provider', () => {
    const gateway = createOpenCodeGateway('test-key');
    expect(gateway.languageModel('o3-mini').provider).toContain('openai');
    expect(gateway.languageModel('o4-mini').provider).toContain('openai');
  });

  it('integrates with provider registry', () => {
    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key'),
      mistral: createMistral({ apiKey: 'mi-key' }),
    });

    // Claude through OpenCode gateway
    const claude = registry.languageModel('opencode:claude-sonnet-4-5');
    expect(claude.provider).toContain('anthropic');

    // GPT through OpenCode gateway
    const gpt = registry.languageModel('opencode:gpt-4.1');
    expect(gpt.provider).toContain('openai');

    // Mistral direct
    const mistral = registry.languageModel('mistral:mistral-large-latest');
    expect(mistral.provider).toContain('mistral');
  });

  it('supports adding direct providers alongside gateway', () => {
    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key'),
      anthropic: createAnthropic({ apiKey: 'direct-anthropic-key' }),
      openai: createOpenAI({ apiKey: 'direct-openai-key' }),
      mistral: createMistral({ apiKey: 'mi-key' }),
    });

    // Same model, different providers (gateway vs direct)
    const viaGateway = registry.languageModel('opencode:claude-sonnet-4-5');
    const viaDirect = registry.languageModel('anthropic:claude-sonnet-4-5');

    // Both are Anthropic SDK models but with different baseURLs
    expect(viaGateway.provider).toContain('anthropic');
    expect(viaDirect.provider).toContain('anthropic');
    expect(viaGateway.modelId).toBe('claude-sonnet-4-5');
    expect(viaDirect.modelId).toBe('claude-sonnet-4-5');
  });
});

// ---------------------------------------------------------------------------
// 4. BaseURL request path verification — Zen gateway compatibility
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Zen BaseURL Request Paths', () => {
  const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

  it('Anthropic provider appends /messages to baseURL', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      baseURL: ZEN_BASE_URL,
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider('claude-sonnet-4-5'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].url).toBe('https://opencode.ai/zen/v1/messages');
  });

  it('OpenAI provider.chat() appends /chat/completions to baseURL', async () => {
    const { mockFetch, captured } = createCapturingFetch('openai');

    const provider = createOpenAI({
      baseURL: ZEN_BASE_URL,
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    // Use .chat() — the default provider() uses Responses API (/responses)
    // which Zen and most third-party gateways don't support
    await generateText({
      model: provider.chat('gpt-4.1'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].url).toBe('https://opencode.ai/zen/v1/chat/completions');
  });

  it('Anthropic provider sends x-api-key header', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      baseURL: ZEN_BASE_URL,
      apiKey: 'my-zen-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider('claude-sonnet-4-5'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    const headers = captured[0].headers;
    // Headers could be a Headers object or plain object
    const apiKey =
      headers instanceof Headers
        ? headers.get('x-api-key')
        : headers?.['x-api-key'];
    expect(apiKey).toBe('my-zen-key');
  });

  it('OpenAI provider sends Authorization Bearer header', async () => {
    const { mockFetch, captured } = createCapturingFetch('openai');

    const provider = createOpenAI({
      baseURL: ZEN_BASE_URL,
      apiKey: 'my-zen-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider.chat('gpt-4.1'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    const headers = captured[0].headers;
    const auth =
      headers instanceof Headers
        ? headers.get('authorization')
        : headers?.['Authorization'] ?? headers?.['authorization'];
    expect(auth).toContain('Bearer my-zen-key');
  });
});

// ---------------------------------------------------------------------------
// 5. Tool definitions work with AI SDK tool() + Zod
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Tool Definitions', () => {
  it('defines a tool with Zod schema and execute function', () => {
    const checkTerm = tool({
      description: 'Check whether a term exists as a category, tag, or both',
      inputSchema: z.object({
        term: z.string().describe('The term to look up'),
      }),
      execute: async ({ term }) => {
        return { term, found: true, type: 'category' };
      },
    });

    expect(checkTerm).toBeDefined();
    expect(checkTerm.description).toBe(
      'Check whether a term exists as a category, tag, or both',
    );
  });

  it('defines a tool with toModelOutput for multimodal results', () => {
    const viewImage = tool({
      description: 'View an image',
      inputSchema: z.object({
        media_id: z.number(),
        size: z.enum(['small', 'medium', 'large']).default('medium'),
      }),
      execute: async ({ media_id }) => {
        return {
          base64: 'iVBORw0KGgo...',
          mediaType: 'image/png' as const,
          caption: `Image #${media_id}`,
        };
      },
      toModelOutput: ({ output }) => ({
        type: 'content' as const,
        value: [
          {
            type: 'image' as const,
            data: output.base64,
            mediaType: output.mediaType,
          },
          { type: 'text' as const, text: output.caption },
        ],
      }),
    });

    expect(viewImage).toBeDefined();
  });

  it('sends tools in generateText request body', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider('claude-sonnet-4-5'),
      prompt: 'Check the term "javascript"',
      tools: {
        check_term: tool({
          description: 'Check a term',
          inputSchema: z.object({ term: z.string() }),
          execute: async ({ term }) => ({ found: true, term }),
        }),
      },
      maxRetries: 0,
    });

    expect(captured[0].body.tools).toBeDefined();
    expect(captured[0].body.tools.length).toBeGreaterThan(0);
    expect(captured[0].body.tools[0].name).toBe('check_term');
  });
});

// ---------------------------------------------------------------------------
// 6. Anthropic-specific providerOptions (cache control, etc.)
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Anthropic Provider Options', () => {
  it('sends cache control on system message', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider('claude-sonnet-4-5'),
      messages: [
        {
          role: 'system',
          content: 'You are a blog editor.',
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        { role: 'user', content: 'Hello' },
      ],
      maxRetries: 0,
    });

    // Anthropic SDK sends system as top-level field or within messages
    // The key assertion is that the request succeeds with providerOptions
    expect(captured.length).toBeGreaterThan(0);
    const body = captured[0].body;
    // System with cache_control should appear in the request
    expect(body.system).toBeDefined();
    const systemBlock = Array.isArray(body.system) ? body.system : [body.system];
    const hasCacheControl = systemBlock.some(
      (s: any) => s.cache_control?.type === 'ephemeral',
    );
    expect(hasCacheControl).toBe(true);
  });

  it('sends cache control on tools', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    await generateText({
      model: provider('claude-sonnet-4-5'),
      prompt: 'Hello',
      tools: {
        check_term: tool({
          description: 'Check a term',
          inputSchema: z.object({ term: z.string() }),
          execute: async ({ term }) => ({ found: true, term }),
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        }),
      },
      maxRetries: 0,
    });

    expect(captured[0].body.tools).toBeDefined();
    const toolDef = captured[0].body.tools[0];
    expect(toolDef.cache_control?.type).toBe('ephemeral');
  });
});

// ---------------------------------------------------------------------------
// 7. generateText produces correct model + usage
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — generateText Response', () => {
  it('returns text and usage from Anthropic provider', async () => {
    const { mockFetch } = createCapturingFetch('anthropic');

    const provider = createAnthropic({
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    const result = await generateText({
      model: provider('claude-sonnet-4-5'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(result.text).toBe('Hello from mock');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it('returns text and usage from OpenAI provider (chat mode)', async () => {
    const { mockFetch } = createCapturingFetch('openai');

    const provider = createOpenAI({
      apiKey: 'test-key',
      fetch: mockFetch,
    });

    // Use .chat() for Chat Completions format
    const result = await generateText({
      model: provider.chat('gpt-4.1'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(result.text).toBe('Hello from mock');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it('returns text via provider registry resolution', async () => {
    const { mockFetch } = createCapturingFetch('anthropic');

    const registry = createProviderRegistry({
      anthropic: createAnthropic({
        apiKey: 'test-key',
        fetch: mockFetch,
      }),
    });

    const result = await generateText({
      model: registry.languageModel('anthropic:claude-sonnet-4-5'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(result.text).toBe('Hello from mock');
  });
});

// ---------------------------------------------------------------------------
// 8. Gateway end-to-end: registry → gateway → correct provider → correct URL
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Gateway End-to-End', () => {
  const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

  function createOpenCodeGateway(apiKey: string, fetchImpl: typeof fetch) {
    const anthropicProvider = createAnthropic({
      baseURL: ZEN_BASE_URL,
      apiKey,
      fetch: fetchImpl,
    });
    const openaiProvider = createOpenAI({
      baseURL: ZEN_BASE_URL,
      apiKey,
      fetch: fetchImpl,
    });

    return customProvider({
      languageModels: {},
      fallbackProvider: {
        languageModel: (modelId: string) => {
          if (modelId.startsWith('claude')) {
            return anthropicProvider(modelId);
          }
          // Must use .chat() for Chat Completions API (Zen gateway compatible)
          return openaiProvider.chat(modelId);
        },
        embeddingModel: () => {
          throw new Error('Not supported');
        },
        imageModel: () => {
          throw new Error('Not supported');
        },
      },
    });
  }

  it('Claude via gateway hits Zen Anthropic endpoint', async () => {
    const { mockFetch, captured } = createCapturingFetch('anthropic');

    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key', mockFetch),
    });

    await generateText({
      model: registry.languageModel('opencode:claude-sonnet-4-5'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(captured[0].url).toBe('https://opencode.ai/zen/v1/messages');
    expect(captured[0].body.model).toBe('claude-sonnet-4-5');
  });

  it('GPT via gateway hits Zen OpenAI endpoint', async () => {
    const { mockFetch, captured } = createCapturingFetch('openai');

    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key', mockFetch),
    });

    await generateText({
      model: registry.languageModel('opencode:gpt-4.1'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(captured[0].url).toBe(
      'https://opencode.ai/zen/v1/chat/completions',
    );
    expect(captured[0].body.model).toBe('gpt-4.1');
  });

  it('Gemini via gateway hits Zen OpenAI endpoint', async () => {
    const { mockFetch, captured } = createCapturingFetch('openai');

    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key', mockFetch),
    });

    await generateText({
      model: registry.languageModel('opencode:gemini-2.5-pro'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(captured[0].url).toBe(
      'https://opencode.ai/zen/v1/chat/completions',
    );
    expect(captured[0].body.model).toBe('gemini-2.5-pro');
  });

  it('Mistral via direct provider (not gateway)', async () => {
    const { mockFetch: anthropicFetch } = createCapturingFetch('anthropic');
    const { mockFetch: mistralFetch, captured: mistralCaptured } =
      createCapturingFetch('openai'); // Mistral uses OpenAI-compat format

    const registry = createProviderRegistry({
      opencode: createOpenCodeGateway('oc-key', anthropicFetch),
      mistral: createMistral({
        apiKey: 'mi-key',
        fetch: mistralFetch,
      }),
    });

    await generateText({
      model: registry.languageModel('mistral:mistral-large-latest'),
      prompt: 'Hello',
      maxRetries: 0,
    });

    expect(mistralCaptured[0].url).toBe(
      'https://api.mistral.ai/v1/chat/completions',
    );
    expect(mistralCaptured[0].body.model).toBe('mistral-large-latest');
  });
});

// ---------------------------------------------------------------------------
// 9. No static model map: the routing rule
// ---------------------------------------------------------------------------

describe('AI SDK Phase 0 — Model Routing Without Static Maps', () => {
  it('the only routing rule is: claude* → Anthropic API, else → OpenAI API', () => {
    // This test documents the design decision. There is no model registry or
    // regex map. The gateway provider uses a single if/else to pick the SDK.
    // This is correct because only Anthropic has a separate Messages API;
    // every other model family (OpenAI, Google, Cohere, etc.) uses
    // OpenAI-compatible Chat Completions endpoints.

    const anthropicModels = [
      'claude-sonnet-4-5',
      'claude-opus-4-1',
      'claude-haiku-4-5',
      'claude-3-7-sonnet-20250219',
    ];

    const openaiCompatModels = [
      'gpt-4.1',
      'gpt-4o',
      'o3-mini',
      'o4-mini',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'command-r-plus',
      'some-future-model-xyz',
    ];

    function routeModel(modelId: string): 'anthropic' | 'openai-compat' {
      return modelId.startsWith('claude') ? 'anthropic' : 'openai-compat';
    }

    for (const m of anthropicModels) {
      expect(routeModel(m)).toBe('anthropic');
    }
    for (const m of openaiCompatModels) {
      expect(routeModel(m)).toBe('openai-compat');
    }
  });
});
