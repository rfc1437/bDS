import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScriptsView } from '../../../src/renderer/components/ScriptsView/ScriptsView';
import { useAppStore } from '../../../src/renderer/store';

const executeMock = vi.fn();

vi.mock('../../../src/renderer/python/runtimeManagerInstance', () => ({
  getPythonRuntimeManager: () => ({
    execute: executeMock,
  }),
}));

describe('ScriptsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    executeMock.mockResolvedValue({ result: '2', stdout: 'hello\n' });

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      scripts: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        get: vi.fn().mockResolvedValue({
          id: 'script-1',
          projectId: 'default',
          slug: 'hello-script',
          title: 'Hello Script',
          kind: 'utility',
          entrypoint: 'render',
          enabled: true,
          version: 1,
          filePath: '/tmp/hello-script.py',
          content: 'print("hello")',
          createdAt: '2026-02-22T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
        }),
        getAll: vi.fn(),
      },
    };

    useAppStore.setState({
      panelVisible: false,
      panelActiveTab: 'tasks',
      panelOutputEntries: [],
    });
  });

  it('loads scripts and allows editing content', async () => {
    render(<ScriptsView scriptId="script-1" />);

    const textarea = screen.getByLabelText('Script Content') as HTMLTextAreaElement;
    await vi.waitFor(() => {
      expect(textarea.value).toContain('print("hello")');
    });

    fireEvent.change(textarea, { target: { value: 'print("updated")' } });
    expect(textarea.value).toContain('updated');
  });

  it('runs selected script and writes output into panel output log', async () => {
    render(<ScriptsView scriptId="script-1" />);

    await screen.findByLabelText('Script Content');
    fireEvent.click(screen.getByRole('button', { name: 'Run Script' }));

    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith('print("hello")');
    });

    const state = useAppStore.getState();
    expect(state.panelVisible).toBe(true);
    expect(state.panelActiveTab).toBe('output');
    expect(state.panelOutputEntries.length).toBeGreaterThan(0);
    expect(state.panelOutputEntries[state.panelOutputEntries.length - 1].message).toContain('hello');
  });
});
