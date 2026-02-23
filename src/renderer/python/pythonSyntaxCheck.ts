import type { PyodideInterface } from 'pyodide';
import type { PythonSyntaxError } from './runtimeProtocol';

const SYNTAX_CHECK_SCRIPT = [
  'import ast',
  'import json',
  '',
  '__bds_syntax_errors = []',
  'try:',
  '    ast.parse(__bds_syntax_source)',
  'except SyntaxError as exc:',
  '    line = exc.lineno or 1',
  '    column = exc.offset or 1',
  '    end_line = getattr(exc, "end_lineno", None) or line',
  '    end_column = getattr(exc, "end_offset", None) or (column + 1)',
  '    __bds_syntax_errors.append({',
  '        "line": line,',
  '        "column": column,',
  '        "endLine": end_line,',
  '        "endColumn": end_column,',
  '        "message": exc.msg or "invalid syntax",',
  '    })',
  '__bds_syntax_result_json = json.dumps({"errors": __bds_syntax_errors})',
  '__bds_syntax_result_json',
].join('\n');

function toResultString(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result === null || result === undefined) {
    return '';
  }

  return String(result);
}

function parseSyntaxErrors(rawJsonResult: unknown): PythonSyntaxError[] {
  const rawText = toResultString(rawJsonResult).trim();
  if (rawText.length === 0) {
    throw new Error('Python syntax check returned no JSON result');
  }

  const parsed = JSON.parse(rawText) as { errors?: unknown };
  if (!Array.isArray(parsed.errors)) {
    return [];
  }

  return parsed.errors
    .filter((item): item is PythonSyntaxError => {
      return item
        && typeof item === 'object'
        && Number.isFinite((item as { line?: number }).line)
        && Number.isFinite((item as { column?: number }).column)
        && Number.isFinite((item as { endLine?: number }).endLine)
        && Number.isFinite((item as { endColumn?: number }).endColumn)
        && typeof (item as { message?: unknown }).message === 'string';
    })
    .map((item) => ({
      line: Math.max(1, Math.floor(item.line)),
      column: Math.max(1, Math.floor(item.column)),
      endLine: Math.max(1, Math.floor(item.endLine)),
      endColumn: Math.max(1, Math.floor(item.endColumn)),
      message: item.message,
    }));
}

export async function runPythonSyntaxCheck(runtime: PyodideInterface, sourceCode: string): Promise<PythonSyntaxError[]> {
  runtime.globals.set('__bds_syntax_source', sourceCode);
  const rawJsonResult = await runtime.runPythonAsync(SYNTAX_CHECK_SCRIPT);
  return parseSyntaxErrors(rawJsonResult);
}
