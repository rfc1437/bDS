import { vi } from 'vitest';

type ConsoleMethod = 'error' | 'warn' | 'log' | 'info' | 'debug';

function stringifyConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }

  if (typeof arg === 'string') {
    return arg;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export async function withCapturedConsole<T>(
  method: ConsoleMethod,
  run: (captured: {
    spy: ReturnType<typeof vi.spyOn>;
    calls: () => unknown[][];
    text: () => string;
  }) => Promise<T> | T,
): Promise<T> {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});

  try {
    return await run({
      spy,
      calls: () => spy.mock.calls,
      text: () => spy.mock.calls.map((call) => call.map(stringifyConsoleArg).join(' ')).join('\n'),
    });
  } finally {
    spy.mockRestore();
  }
}