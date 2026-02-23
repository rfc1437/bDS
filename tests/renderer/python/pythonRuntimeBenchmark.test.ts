import { describe, it, expect } from 'vitest';
import { summarizeDurations, runPythonRuntimeBenchmark } from '../../../src/renderer/python/pythonRuntimeBenchmark';

describe('pythonRuntimeBenchmark', () => {
  it('computes p50 and p95 summary metrics', () => {
    const summary = summarizeDurations([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(summary.count).toBe(10);
    expect(summary.minMs).toBe(1);
    expect(summary.maxMs).toBe(10);
    expect(summary.meanMs).toBe(5.5);
    expect(summary.p50Ms).toBe(5.5);
    expect(summary.p95Ms).toBe(9.55);
  });

  it('runs benchmark phases and returns measured durations', async () => {
    const calls: string[] = [];
    const runtime = {
      async runPythonAsync(code: string): Promise<string> {
        calls.push(code);
        return 'ok';
      },
    };

    const timestamps = [0, 100, 100, 110, 110, 111, 111, 113, 113, 116, 116, 120];
    let index = 0;

    const result = await runPythonRuntimeBenchmark({
      iterations: 4,
      loadRuntime: async () => runtime,
      now: () => {
        const value = timestamps[index];
        index += 1;
        return value;
      },
    });

    expect(result.coldStartMs).toBe(100);
    expect(result.warmRunMs).toBe(10);
    expect(result.repeatedMacro.samplesMs).toEqual([1, 2, 3, 4]);
    expect(result.repeatedMacro.stats.p50Ms).toBe(2.5);
    expect(result.repeatedMacro.stats.p95Ms).toBe(3.85);
    expect(calls).toHaveLength(6);
  });
});
