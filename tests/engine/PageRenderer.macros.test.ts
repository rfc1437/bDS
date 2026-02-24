import { describe, expect, it } from 'vitest';
import type { MediaData } from '../../src/main/engine/MediaEngine';
import {
  renderMacro,
  resolveMacroTemplateRoots,
} from '../../src/main/engine/PageRenderer';

function createMedia(overrides?: Partial<MediaData>): MediaData {
  return {
    id: 'media-1',
    filename: 'photo.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    createdAt: new Date('2026-02-20T10:00:00.000Z'),
    updatedAt: new Date('2026-02-20T10:00:00.000Z'),
    tags: [],
    ...overrides,
  };
}

describe('PageRenderer macro template roots', () => {
  it('includes macros subfolder for packaged app builds', () => {
    const roots = resolveMacroTemplateRoots({
      moduleDir: '/Applications/Blogging Desktop Server.app/Contents/Resources/app.asar/dist/main/engine',
      cwd: '/tmp/runtime-cwd',
      resourcesPath: '/Applications/Blogging Desktop Server.app/Contents/Resources',
    });

    expect(roots).toContain('/Applications/Blogging Desktop Server.app/Contents/Resources/templates/macros');
  });
});

describe('PageRenderer macros', () => {
  it('renders youtube macro html', () => {
    const html = renderMacro('youtube', { id: 'abc123' }, '', [], null, [], 'en');
    expect(html).toContain('class="macro-youtube"');
    expect(html).toContain('https://www.youtube.com/embed/abc123?rel=0');
  });

  it('renders gallery macro html from linked media', () => {
    const media = createMedia({ id: 'm-1' });

    const html = renderMacro(
      'gallery',
      { columns: '4' },
      'post-1',
      [media],
      new Set<string>(['m-1']),
      [],
      'en',
    );

    expect(html).toContain('class="macro-gallery gallery-cols-4"');
    expect(html).toContain('class="gallery-item"');
  });
});