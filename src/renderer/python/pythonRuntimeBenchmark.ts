import { loadPyodide } from 'pyodide';

export interface BenchmarkStats {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface BenchmarkResult {
  coldStartMs: number;
  warmRunMs: number;
  repeatedMacro: {
    samplesMs: number[];
    stats: BenchmarkStats;
  };
}

interface PythonRuntimeLike {
  runPythonAsync(code: string): Promise<unknown>;
}

interface BenchmarkOptions {
  iterations?: number;
  loadRuntime?: () => Promise<PythonRuntimeLike>;
  now?: () => number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  if (values.length === 1) {
    return values[0];
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeDurations(durationsMs: number[]): BenchmarkStats {
  if (durationsMs.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
  }

  const minMs = Math.min(...durationsMs);
  const maxMs = Math.max(...durationsMs);
  const meanMs = durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length;

  return {
    count: durationsMs.length,
    minMs: round2(minMs),
    maxMs: round2(maxMs),
    meanMs: round2(meanMs),
    p50Ms: round2(percentile(durationsMs, 0.5)),
    p95Ms: round2(percentile(durationsMs, 0.95)),
  };
}

export async function runPythonRuntimeBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
  const iterations = options.iterations ?? 200;
  const loadRuntime = options.loadRuntime ?? (async () => loadPyodide());
  const now = options.now ?? (() => performance.now());

  const coldStartStart = now();
  const runtime = await loadRuntime();
  const coldStartMs = now() - coldStartStart;

  const warmStart = now();
  await runtime.runPythonAsync('1 + 1');
  const warmRunMs = now() - warmStart;

  await runtime.runPythonAsync(`
def render(context):
    title = context.get("title", "")
    return {"html": f"<p>{title}</p>"}
`);

  const samplesMs: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = now();
    await runtime.runPythonAsync('render({"title": "Benchmark"})["html"]');
    samplesMs.push(now() - started);
  }

  return {
    coldStartMs: round2(coldStartMs),
    warmRunMs: round2(warmRunMs),
    repeatedMacro: {
      samplesMs: samplesMs.map(round2),
      stats: summarizeDurations(samplesMs),
    },
  };
}
