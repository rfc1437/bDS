import { runPythonRuntimeBenchmark } from '../src/renderer/python/pythonRuntimeBenchmark';

async function main(): Promise<void> {
  const iterationsArg = process.argv[2];
  const iterations = iterationsArg ? Number(iterationsArg) : 200;

  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error('Iterations must be a positive integer');
  }

  const result = await runPythonRuntimeBenchmark({ iterations });

  const output = {
    measuredAt: new Date().toISOString(),
    iterations,
    coldStartMs: result.coldStartMs,
    warmRunMs: result.warmRunMs,
    repeatedMacro: result.repeatedMacro.stats,
  };

  console.log(JSON.stringify(output, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[python-runtime-benchmark] ${message}`);
  process.exit(1);
});
