import { describe, expect, it, vi } from 'vitest';
import { createGenerationRouteRenderer } from '../../src/main/engine/GenerationRouteRendererFactory';

describe('GenerationRouteRendererFactory', () => {
  it('normalizes route keys and memoizes html rendering calls', async () => {
    const renderWithContext = vi.fn().mockResolvedValue('<html>ok</html>');

    const renderRoute = createGenerationRouteRenderer({
      renderWithContext,
      context: {
        projectContext: {
          projectId: 'p',
          dataDir: '/tmp',
          projectName: 'P',
          projectDescription: 'D',
        },
        metadata: {
          name: 'P',
          description: 'D',
        },
        menu: { items: [] },
        maxPostsPerPage: 50,
      },
    });

    const a = await renderRoute('/foo/');
    const b = await renderRoute('/foo');

    expect(a).toBe('<html>ok</html>');
    expect(b).toBe('<html>ok</html>');
    expect(renderWithContext).toHaveBeenCalledTimes(1);
    expect(renderWithContext).toHaveBeenCalledWith('/foo', expect.any(Object));
  });
});
