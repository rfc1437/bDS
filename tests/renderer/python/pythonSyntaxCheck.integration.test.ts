import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { runPythonSyntaxCheck } from '../../../src/renderer/python/pythonSyntaxCheck';

describe('pythonSyntaxCheck integration (real pyodide)', () => {
  let runtime: PyodideInterface;

  beforeAll(async () => {
    runtime = await loadPyodide();
  }, 60000);

  it('returns no errors for syntactically valid python', async () => {
    const source = [
      'def normalize_blogmark(post):',
      '    title = (post.get("title") or "").strip()',
      '    if title:',
      '        post["title"] = title',
      '    return post',
      '',
    ].join('\n');

    const errors = await runPythonSyntaxCheck(runtime, source);

    expect(errors).toEqual([]);
  });

  it('returns structured syntax diagnostics for invalid python', async () => {
    const source = [
      'def normalize_blogmark(post):',
      '    if post.get("title")',
      '        return post',
      '',
    ].join('\n');

    const errors = await runPythonSyntaxCheck(runtime, source);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toEqual(expect.objectContaining({
      line: 2,
      message: expect.any(String),
    }));
  });
});
