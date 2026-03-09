import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from '../../../src/main/engine/ai/retry';

describe('retryWithBackoff', () => {
  it('returns immediately on success (no retries)', async () => {
    const fn = vi.fn(async () => ({ success: true, value: 42 }));

    const result = await retryWithBackoff(fn);

    expect(result).toEqual({ success: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxRetries times with exponential delays on failure', async () => {
    vi.useFakeTimers();

    const fn = vi.fn(async () => ({ success: false, error: 'rate limited' }));

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 5000 });

    // Initial call happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Retry 1 after 5s
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Retry 2 after 10s
    await vi.advanceTimersByTimeAsync(10000);
    expect(fn).toHaveBeenCalledTimes(3);

    // Retry 3 after 20s
    await vi.advanceTimersByTimeAsync(20000);
    expect(fn).toHaveBeenCalledTimes(4);

    const result = await promise;
    expect(result).toEqual({ success: false, error: 'rate limited' });

    vi.useRealTimers();
  });

  it('stops retrying once the function succeeds', async () => {
    vi.useFakeTimers();

    const fn = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'fail' })
      .mockResolvedValueOnce({ success: true, value: 'ok' });

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 5000 });

    // Initial call fails
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Retry 1 after 5s — succeeds
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toEqual({ success: true, value: 'ok' });
    // Should not retry further
    expect(fn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('uses default 3 retries with 5s base delay', async () => {
    vi.useFakeTimers();

    const fn = vi.fn(async () => ({ success: false }));

    const promise = retryWithBackoff(fn);

    // Initial + 3 retries = 4 total calls
    await vi.advanceTimersByTimeAsync(0);     // initial
    await vi.advanceTimersByTimeAsync(5000);   // retry 1 (5s)
    await vi.advanceTimersByTimeAsync(10000);  // retry 2 (10s)
    await vi.advanceTimersByTimeAsync(20000);  // retry 3 (20s)

    await promise;
    expect(fn).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('applies exponential doubling: 5s, 10s, 20s', async () => {
    vi.useFakeTimers();

    const delays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const fn = vi.fn(async () => ({ success: false }));

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 5000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    await promise;

    // Extract the delay values passed to setTimeout for our retries
    const timeoutCalls = setTimeoutSpy.mock.calls
      .filter(([, ms]) => typeof ms === 'number' && ms >= 5000)
      .map(([, ms]) => ms);

    expect(timeoutCalls).toContain(5000);
    expect(timeoutCalls).toContain(10000);
    expect(timeoutCalls).toContain(20000);

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
