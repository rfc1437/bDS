import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../../src/renderer/components/StatusBar/StatusBar';
import { useAppStore } from '../../../src/renderer/store';

vi.mock('../../../src/renderer/components/ProjectSelector', () => ({
  ProjectSelector: () => <div data-testid="project-selector">Project</div>,
}));

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      media: [],
      tasks: [],
      selectedPostId: null,
      totalPosts: 0,
      picoTheme: 'slate',
    } as any);
  });

  it('shows the currently applied theme', () => {
    render(<StatusBar />);

    expect(screen.getByText('Theme: slate')).toBeInTheDocument();
  });
});
