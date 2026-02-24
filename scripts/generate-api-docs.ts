import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateApiDocumentationMarkdownV1 } from '../src/renderer/python/generateApiDocumentationMarkdownV1';

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), 'API.md');
  const markdown = generateApiDocumentationMarkdownV1();
  await writeFile(outputPath, markdown, 'utf8');
  console.log(`Generated API documentation at ${outputPath}`);
}

void main();