import type { MacroContextV1, MacroResultV1 } from './abiV1';

export type PythonWorkerRequest =
  | {
      type: 'run';
      requestId: string;
      code: string;
    }
  | {
      type: 'renderMacroV1';
      requestId: string;
      code: string;
      context: MacroContextV1;
    };

export type PythonWorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'stdout'; requestId: string; chunk: string }
  | { type: 'runResult'; requestId: string; result: string }
  | { type: 'macroResult'; requestId: string; result: MacroResultV1 }
  | { type: 'runError'; requestId: string; error: string };
