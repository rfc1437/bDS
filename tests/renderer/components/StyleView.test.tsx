import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StyleView } from '../../../src/renderer/components/StyleView/StyleView';
import { useAppStore } from '../../../src/renderer/store';

describe('StyleView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAppStore.setState({
      activeProject: {
        id: 'project-1',
        name: 'Test Project',
        slug: 'test-project',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      picoTheme: 'slate',
    } as any);

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      meta: {
        ...(window as any).electronAPI?.meta,
        getProjectMetadata: vi.fn().mockResolvedValue({ picoTheme: 'slate' }),
        updateProjectMetadata: vi.fn().mockResolvedValue({ picoTheme: 'blue' }),
      },
    };
  });

  it('lets users select a theme and apply it', async () => {
    render(<StyleView />);

    const blueButton = await screen.findByRole('button', { name: /blue/i });
    fireEvent.click(blueButton);

    const applyButton = screen.getByRole('button', { name: /apply theme/i });
    fireEvent.click(applyButton);

    expect((window as any).electronAPI.meta.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ picoTheme: 'blue' })
    );
  });

  it('renders the style preview iframe for top posts with selected theme', async () => {
    render(<StyleView />);

    const iframe = await screen.findByTitle('Theme preview');
    expect(iframe.getAttribute('src')).toContain('/__style-preview');
    expect(iframe.getAttribute('src')).toContain('theme=slate');
    expect(iframe.getAttribute('src')).toContain('mode=auto');
  });

  it('lets users force dark/light mode for preview iframe', async () => {
    render(<StyleView />);

    const modeSelect = await screen.findByLabelText(/preview mode/i);
    fireEvent.change(modeSelect, { target: { value: 'dark' } });

    const iframe = await screen.findByTitle('Theme preview');
    expect(iframe.getAttribute('src')).toContain('mode=dark');
  });

  it('renders each theme swatch with accent, light, and dark tones', async () => {
    const { container } = render(<StyleView />);

    await screen.findByRole('button', { name: /blue/i });

    const blueSwatch = container.querySelector('.style-theme-swatch-blue');
    expect(blueSwatch).not.toBeNull();

    const tones = blueSwatch?.querySelectorAll('.style-theme-tone') ?? [];
    expect(tones.length).toBe(3);
    expect(blueSwatch?.textContent).toContain('Blue');
  });
});
