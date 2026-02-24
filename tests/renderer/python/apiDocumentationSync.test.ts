import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateApiDocumentationMarkdownV1 } from '../../../src/renderer/python/generateApiDocumentationMarkdownV1';

describe('API documentation markdown sync', () => {
  it('matches generated contract documentation', () => {
    const apiMarkdownPath = resolve(process.cwd(), 'API.md');
    const committedMarkdown = readFileSync(apiMarkdownPath, 'utf8');
    const generatedMarkdown = generateApiDocumentationMarkdownV1();

    expect(committedMarkdown).toBe(generatedMarkdown);
  });
});