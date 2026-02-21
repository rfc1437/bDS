import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutoExpandController } from '../../../src/renderer/components/MenuEditorView/menuAutoExpand';

describe('createAutoExpandController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs callback after configured delay', () => {
    const controller = createAutoExpandController(300);
    const callback = vi.fn();

    controller.schedule('node-a', callback);
    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled callback for a node', () => {
    const controller = createAutoExpandController(300);
    const callback = vi.fn();

    controller.schedule('node-a', callback);
    controller.cancel('node-a');
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
  });

  it('replaces existing schedule for same node id', () => {
    const controller = createAutoExpandController(300);
    const first = vi.fn();
    const second = vi.fn();

    controller.schedule('node-a', first);
    controller.schedule('node-a', second);
    vi.runAllTimers();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancels all pending callbacks', () => {
    const controller = createAutoExpandController(300);
    const first = vi.fn();
    const second = vi.fn();

    controller.schedule('node-a', first);
    controller.schedule('node-b', second);
    controller.cancelAll();
    vi.runAllTimers();

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
