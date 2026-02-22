import { describe, expect, it, vi } from 'vitest';
import { createDeferredEventGate } from '../../../src/renderer/navigation/deferredEventGate';

describe('createDeferredEventGate', () => {
  it('queues events until marked ready', () => {
    const gate = createDeferredEventGate<string>();
    const consume = vi.fn();

    gate.push('first', consume);
    gate.push('second', consume);

    expect(consume).not.toHaveBeenCalled();

    gate.markReady(consume);

    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenNthCalledWith(1, 'first');
    expect(consume).toHaveBeenNthCalledWith(2, 'second');
  });

  it('consumes immediately after ready', () => {
    const gate = createDeferredEventGate<string>();
    const consume = vi.fn();

    gate.markReady(consume);
    gate.push('now', consume);

    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith('now');
  });
});
