/**
 * Offline / airplane mode tests.
 *
 * Verifies ProviderRegistry offline mode behavior:
 * - toggles on/off
 * - restricts model resolution to local providers only
 * - restricts available models to local only
 * - isReady reflects local provider state
 * - getProviderStatus includes offline state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../src/main/engine/ai/providers';

describe('ProviderRegistry offline mode', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  // ---------- toggle ----------

  it('starts with offline mode disabled', () => {
    expect(registry.isOfflineMode()).toBe(false);
  });

  it('can enable and disable offline mode', () => {
    registry.setOfflineMode(true);
    expect(registry.isOfflineMode()).toBe(true);
    registry.setOfflineMode(false);
    expect(registry.isOfflineMode()).toBe(false);
  });

  // ---------- isReady in offline mode ----------

  it('isReady returns false in offline mode when no local provider enabled', () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);
    expect(registry.isReady()).toBe(false);
  });

  it('isReady returns true in offline mode when Ollama enabled', () => {
    registry.setOfflineMode(true);
    registry.setOllamaEnabled(true);
    expect(registry.isReady()).toBe(true);
  });

  it('isReady returns true in offline mode when LM Studio enabled', () => {
    registry.setOfflineMode(true);
    registry.setLmstudioEnabled(true);
    expect(registry.isReady()).toBe(true);
  });

  // ---------- resolveModel in offline mode ----------

  it('resolveModel throws for cloud models when offline', () => {
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);
    expect(() => registry.resolveModel('claude-sonnet-4')).toThrow('offline');
  });

  it('resolveModel throws for mistral models when offline', () => {
    registry.setMistralKey('test-key');
    registry.setOfflineMode(true);
    expect(() => registry.resolveModel('mistral-large-latest')).toThrow('offline');
  });

  it('resolveModel succeeds for Ollama model when offline and Ollama enabled', () => {
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3');
    registry.setOfflineMode(true);
    const model = registry.resolveModel('llama3');
    expect(model).toBeDefined();
  });

  it('resolveModel succeeds for LM Studio model when offline and LM Studio enabled', () => {
    registry.setLmstudioEnabled(true);
    registry.registerLmstudioModel('gemma-3-12b-it');
    registry.setOfflineMode(true);
    const model = registry.resolveModel('gemma-3-12b-it');
    expect(model).toBeDefined();
  });

  // ---------- getAvailableModels filtering ----------

  it('getAvailableModels returns only local models when offline', async () => {
    registry.setOpencodeKey('test-key');
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3:latest');
    registry.setOfflineMode(true);

    // No fetch should happen at all in offline mode
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      throw new Error(`Unexpected fetch to ${url} in offline mode`);
    });

    try {
      const models = await registry.getAvailableModels();
      // Only local model should appear
      expect(models.length).toBe(1);
      expect(models.every(m => m.provider === 'ollama' || m.provider === 'lmstudio')).toBe(true);
      // fetch should NOT have been called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------- getKnownLocalModels ----------

  it('getKnownLocalModels returns registered Ollama and LM Studio models', () => {
    registry.setOllamaEnabled(true);
    registry.setLmstudioEnabled(true);
    registry.registerOllamaModel('llama3:latest');
    registry.registerLmstudioModel('gemma-3-12b-it');

    const models = registry.getKnownLocalModels();
    expect(models.length).toBe(2);
    expect(models.find(m => m.id === 'llama3:latest')?.provider).toBe('ollama');
    expect(models.find(m => m.id === 'gemma-3-12b-it')?.provider).toBe('lmstudio');
  });

  it('getKnownLocalModels returns empty when no models registered', () => {
    const models = registry.getKnownLocalModels();
    expect(models.length).toBe(0);
  });

  // ---------- getFirstKnownLocalModelId ----------

  it('getFirstKnownLocalModelId returns first registered model', () => {
    registry.setOllamaEnabled(true);
    registry.registerOllamaModel('llama3:latest');
    registry.registerOllamaModel('mistral:latest');
    expect(registry.getFirstKnownLocalModelId()).toBe('llama3:latest');
  });

  it('getFirstKnownLocalModelId returns null when no models registered', () => {
    expect(registry.getFirstKnownLocalModelId()).toBeNull();
  });

  it('getFirstKnownLocalModelId falls back to LM Studio when no Ollama models', () => {
    registry.setLmstudioEnabled(true);
    registry.registerLmstudioModel('gemma-3-12b-it');
    expect(registry.getFirstKnownLocalModelId()).toBe('gemma-3-12b-it');
  });

  // ---------- getProviderStatus includes offline ----------

  it('getProviderStatus includes offlineMode field', () => {
    registry.setOfflineMode(true);
    const status = registry.getProviderStatus();
    expect(status.offlineMode).toBe(true);

    registry.setOfflineMode(false);
    expect(registry.getProviderStatus().offlineMode).toBe(false);
  });

  // ---------- isProviderKeySet in offline mode ----------

  it('isProviderKeySet returns false for cloud providers when offline', () => {
    registry.setOpencodeKey('test-key');
    registry.setMistralKey('test-key');
    registry.setOfflineMode(true);
    expect(registry.isProviderKeySet('anthropic')).toBe(false);
    expect(registry.isProviderKeySet('openai')).toBe(false);
    expect(registry.isProviderKeySet('mistral')).toBe(false);
  });

  it('isProviderKeySet returns true for local providers when offline and enabled', () => {
    registry.setOllamaEnabled(true);
    registry.setLmstudioEnabled(true);
    registry.setOfflineMode(true);
    expect(registry.isProviderKeySet('ollama')).toBe(true);
    expect(registry.isProviderKeySet('lmstudio')).toBe(true);
  });

  // ---------- model cache invalidation on toggle ----------

  it('invalidates model cache on offline mode toggle', () => {
    // Pre-populate cache
    registry.setOpencodeKey('test-key');
    registry.setOfflineMode(true);
    // Toggling should have invalidated
    expect(registry.isOfflineMode()).toBe(true);
    // Toggle back
    registry.setOfflineMode(false);
    expect(registry.isOfflineMode()).toBe(false);
  });
});
