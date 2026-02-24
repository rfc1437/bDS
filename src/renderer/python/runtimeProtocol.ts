import type { MacroContextV1, MacroResultV1 } from './abiV1';

export type PythonWorkerRequest =
  | {
      type: 'run';
      requestId: string;
      code: string;
      cacheKey?: string;
      entrypoint?: string;
    }
  | {
      type: 'apiResult';
      requestId: string;
      callId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      type: 'renderMacroV1';
      requestId: string;
      code: string;
      context: MacroContextV1;
      cacheKey?: string;
    }
  | {
      type: 'inspectEntrypoints';
      requestId: string;
      code: string;
      cacheKey?: string;
    }
  | {
      type: 'syntaxCheck';
      requestId: string;
      code: string;
      cacheKey?: string;
    };

export interface PythonSyntaxError {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

export type PythonWorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'stdout'; requestId: string; chunk: string }
  | { type: 'apiCall'; requestId: string; callId: string; method: string; args: Record<string, unknown> }
  | { type: 'runResult'; requestId: string; result: string }
  | { type: 'entrypoints'; requestId: string; entrypoints: string[] }
  | { type: 'syntaxResult'; requestId: string; errors: PythonSyntaxError[] }
  | { type: 'macroResult'; requestId: string; result: MacroResultV1 }
  | { type: 'runError'; requestId: string; error: string };
