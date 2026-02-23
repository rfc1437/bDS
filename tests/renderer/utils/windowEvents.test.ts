import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addWindowEventListener, dispatchWindowEvent } from '../../../src/renderer/utils/windowEvents';

describe('windowEvents utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const listeners = new Map<string, Set<(event: Event) => void>>();
    (window as any).addEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(listener);
    });
    (window as any).removeEventListener = vi.fn((type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    });
    (window as any).dispatchEvent = vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    });
  });

  it('dispatches custom events with detail payload', () => {
    const listener = vi.fn();
    addWindowEventListener('bds:scripts-changed', listener);

    const dispatched = dispatchWindowEvent('bds:scripts-changed', { scriptId: 'script-1' });

    expect(dispatched).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<{ scriptId: string }>;
    expect(event.detail).toEqual({ scriptId: 'script-1' });
  });

  it('returns no-op unsubscribe when listener APIs are unavailable', () => {
    const originalAdd = (window as any).addEventListener;
    const originalRemove = (window as any).removeEventListener;
    (window as any).addEventListener = undefined;
    (window as any).removeEventListener = undefined;

    const unsubscribe = addWindowEventListener('bds:scripts-changed', vi.fn());
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();

    (window as any).addEventListener = originalAdd;
    (window as any).removeEventListener = originalRemove;
  });

  it('subscribes and unsubscribes listeners', () => {
    const listener = vi.fn();
    const unsubscribe = addWindowEventListener('bds:scripts-changed', listener);

    dispatchWindowEvent('bds:scripts-changed');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    dispatchWindowEvent('bds:scripts-changed');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
