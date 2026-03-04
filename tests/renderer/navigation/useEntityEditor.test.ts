import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEntityLoader, useSaveShortcut } from '../../../src/renderer/navigation/useEntityEditor';
import { useAppStore } from '../../../src/renderer/store';

describe('useEntityLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      tabs: [{ type: 'scripts', id: 'entity-1', isTransient: false }],
      activeTabId: 'entity-1',
    });
  });

  it('defers loading until activeProject is set', async () => {
    useAppStore.setState({ activeProject: null });

    const fetcher = vi.fn().mockResolvedValue({ id: 'entity-1', title: 'Test' });
    const onLoaded = vi.fn();
    const onReset = vi.fn();

    const { result, rerender } = renderHook(
      ({ id }) => useEntityLoader(id, fetcher, { onLoaded, onReset }),
      { initialProps: { id: 'entity-1' } },
    );

    expect(result.current.isLoading).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    // onReset is called when activeProject is missing (clear state)
    expect(onReset).toHaveBeenCalled();

    onReset.mockClear();

    // Simulate project becoming available
    act(() => {
      useAppStore.setState({
        activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      });
    });
    rerender({ id: 'entity-1' });

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith('entity-1');
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-1', title: 'Test' });
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('loads entity data when activeProject is already set', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 'entity-1', title: 'Hello' });
    const onLoaded = vi.fn();
    const onReset = vi.fn();

    const { result } = renderHook(() =>
      useEntityLoader('entity-1', fetcher, { onLoaded, onReset }),
    );

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-1', title: 'Hello' });
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('closes tab when entity is not found', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const onLoaded = vi.fn();
    const onReset = vi.fn();

    renderHook(() =>
      useEntityLoader('entity-1', fetcher, { onLoaded, onReset }),
    );

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith('entity-1');
      expect(onLoaded).not.toHaveBeenCalled();
      expect(onReset).toHaveBeenCalled();
      const state = useAppStore.getState();
      expect(state.tabs.find(t => t.id === 'entity-1')).toBeUndefined();
    });
  });

  it('resets and reloads when entity ID changes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ id: 'entity-1', title: 'First' })
      .mockResolvedValueOnce({ id: 'entity-2', title: 'Second' });

    const onLoaded = vi.fn();
    const onReset = vi.fn();

    useAppStore.setState({
      tabs: [
        { type: 'scripts', id: 'entity-1', isTransient: false },
        { type: 'scripts', id: 'entity-2', isTransient: false },
      ],
    });

    const { rerender } = renderHook(
      ({ id }) => useEntityLoader(id, fetcher, { onLoaded, onReset }),
      { initialProps: { id: 'entity-1' } },
    );

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-1', title: 'First' });
    });

    onLoaded.mockClear();
    rerender({ id: 'entity-2' });

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-2', title: 'Second' });
    });
  });

  it('cancels in-flight load when entity ID changes quickly', async () => {
    let resolveFirst: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    const fetcher = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ id: 'entity-2', title: 'Second' });

    const onLoaded = vi.fn();
    const onReset = vi.fn();

    useAppStore.setState({
      tabs: [
        { type: 'scripts', id: 'entity-1', isTransient: false },
        { type: 'scripts', id: 'entity-2', isTransient: false },
      ],
    });

    const { rerender } = renderHook(
      ({ id }) => useEntityLoader(id, fetcher, { onLoaded, onReset }),
      { initialProps: { id: 'entity-1' } },
    );

    // Switch before first resolves
    rerender({ id: 'entity-2' });

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-2', title: 'Second' });
    });

    // Late resolve of first should have no effect
    resolveFirst!({ id: 'entity-1', title: 'First' });

    // onLoaded should only have been called once (for entity-2)
    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onReset and isLoading=false when entityId is null', async () => {
    const fetcher = vi.fn();
    const onLoaded = vi.fn();
    const onReset = vi.fn();

    const { result } = renderHook(() =>
      useEntityLoader(null, fetcher, { onLoaded, onReset }),
    );

    await vi.waitFor(() => {
      expect(onReset).toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  it('allows reload via returned reload function', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ id: 'entity-1', title: 'V1' })
      .mockResolvedValueOnce({ id: 'entity-1', title: 'V2' });

    const onLoaded = vi.fn();
    const onReset = vi.fn();

    const { result } = renderHook(() =>
      useEntityLoader('entity-1', fetcher, { onLoaded, onReset }),
    );

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-1', title: 'V1' });
    });

    await act(async () => {
      result.current.reload();
    });

    await vi.waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({ id: 'entity-1', title: 'V2' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useSaveShortcut', () => {
  let eventTarget: EventTarget;

  beforeEach(() => {
    eventTarget = new EventTarget();
    window.addEventListener = eventTarget.addEventListener.bind(eventTarget);
    window.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
    window.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);
  });

  it('calls onSave when Cmd+S is pressed', () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave));

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Ctrl+S is pressed', () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave));

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not call onSave for other key combinations', () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('cleans up event listener on unmount', () => {
    const onSave = vi.fn();
    const { unmount } = renderHook(() => useSaveShortcut(onSave));

    unmount();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
    }));

    expect(onSave).not.toHaveBeenCalled();
  });
});
