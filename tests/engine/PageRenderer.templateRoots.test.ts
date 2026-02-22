import { describe, expect, it } from 'vitest';
import { resolvePageRendererTemplateRoots } from '../../src/main/engine/PageRenderer';

describe('resolvePageRendererTemplateRoots', () => {
  it('includes templates under process resources path for packaged app builds', () => {
    const roots = resolvePageRendererTemplateRoots({
      moduleDir: '/Applications/Blogging Desktop Server.app/Contents/Resources/app.asar/dist/main/engine',
      cwd: '/tmp/runtime-cwd',
      resourcesPath: '/Applications/Blogging Desktop Server.app/Contents/Resources',
    });

    expect(roots).toContain('/Applications/Blogging Desktop Server.app/Contents/Resources/templates');
  });
});