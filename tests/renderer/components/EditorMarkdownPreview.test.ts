import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../../src/renderer/components/Editor/Editor';

describe('Editor markdown preview rendering', () => {
  it('renders continuous blockquote lines as a single blockquote paragraph (CommonMark softbreak behavior)', () => {
    const markdown = [
      '> Georg Bauer',
      '> Am Krug 40',
      '> 48151 Münster',
      '> eMail: gb at rfc1437.de',
    ].join('\n');

    const html = markdownToHtml(markdown, 'post-1');

    expect((html.match(/<blockquote>/g) ?? []).length).toBe(1);
    expect((html.match(/<p>/g) ?? []).length).toBe(1);
    expect(html).not.toContain('<br');
    expect(html).toContain('Georg Bauer');
    expect(html).toContain('eMail: gb at rfc1437.de');
  });
});
