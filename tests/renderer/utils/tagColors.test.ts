import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTagColorMap, loadTagColorMap } from '../../../src/renderer/utils/tagColors';

describe('tagColors utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildTagColorMap includes only tags with colors', () => {
    const map = buildTagColorMap([
      { id: '1', name: 'alpha', color: '#111111' },
      { id: '2', name: 'beta' },
      { id: '3', name: 'gamma', color: '#333333' },
      { id: '4', name: 'delta', color: null },
    ]);

    expect(map.get('alpha')).toBe('#111111');
    expect(map.get('gamma')).toBe('#333333');
    expect(map.has('beta')).toBe(false);
    expect(map.has('delta')).toBe(false);
  });

  it('loadTagColorMap resolves colors from electron tags api', async () => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      tags: {
        getAll: vi.fn().mockResolvedValue([
          { id: '1', name: 'blue', color: '#0000ff' },
          { id: '2', name: 'red', color: '#ff0000' },
        ]),
      },
    };

    const map = await loadTagColorMap();

    expect(map.get('blue')).toBe('#0000ff');
    expect(map.get('red')).toBe('#ff0000');
  });

  it('loadTagColorMap returns empty map when api is unavailable', async () => {
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      tags: undefined,
    };

    const map = await loadTagColorMap();
    expect(map.size).toBe(0);
  });
});
