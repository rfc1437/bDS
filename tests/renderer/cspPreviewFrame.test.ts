// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('renderer CSP for preview iframe', () => {
  it('allows framing local preview server origin', () => {
    const htmlPath = path.resolve(process.cwd(), 'src/renderer/index.html');
    const html = readFileSync(htmlPath, 'utf8');

    expect(html).toMatch(/Content-Security-Policy/i);
    expect(html).toMatch(/frame-src\s+'self'\s+http:\/\/127\.0\.0\.1:4123/);
    expect(html).not.toMatch(/unsafe-eval/);
  });
});
