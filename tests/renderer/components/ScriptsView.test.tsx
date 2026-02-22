import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScriptsView } from '../../../src/renderer/components/ScriptsView/ScriptsView';
import { useAppStore } from '../../../src/renderer/store';

const executeMock = vi.fn();
const monacoPropsSpy = vi.fn();

vi.mock('@monaco-editor/react', () => ({
  default: (props: {
    value?: string;
    onChange?: (value?: string) => void;
    language?: string;
  }) => {
    monacoPropsSpy(props);
    return (
      <textarea
        aria-label="Script Content"
        value={props.value || ''}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  },
}));

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

    expect(monacoPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'python',
      }),
    );
  });

  it('shows metadata fields and footer timestamps', async () => {
    render(<ScriptsView scriptId="script-1" />);

    const titleInput = await screen.findByLabelText('Title') as HTMLInputElement;
    const slugInput = screen.getByLabelText('Slug') as HTMLInputElement;
    const kindSelect = screen.getByLabelText('Kind') as HTMLSelectElement;
    const entrypointInput = screen.getByLabelText('Entrypoint') as HTMLInputElement;
    const enabledInput = screen.getByLabelText('Enabled') as HTMLInputElement;

    await vi.waitFor(() => {
      expect(titleInput.value).toBe('Hello Script');
      expect(slugInput.value).toBe('hello_script');
    });
    expect(kindSelect.value).toBe('utility');
    expect(entrypointInput.value).toBe('render');
    expect(enabledInput.checked).toBe(true);

    expect(screen.getByText(/Created:/)).toBeInTheDocument();
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('saves renamed script metadata and content', async () => {
    const updateMock = vi.fn().mockResolvedValue({
      id: 'script-1',
      projectId: 'default',
      slug: 'my_helper_function',
      title: 'My Helper Function',
      kind: 'utility',
      entrypoint: 'render',
      enabled: true,
      version: 2,
      filePath: '/tmp/hello-script.py',
      content: 'print("renamed")',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:01:00.000Z',
    });

    (window as any).electronAPI.scripts.update = updateMock;

    render(<ScriptsView scriptId="script-1" />);

    const titleInput = await screen.findByLabelText('Title');
    const kindSelect = screen.getByLabelText('Kind');
    const entrypointInput = screen.getByLabelText('Entrypoint');
    const enabledInput = screen.getByLabelText('Enabled');
    const textarea = screen.getByLabelText('Script Content');

    await vi.waitFor(() => {
      expect((titleInput as HTMLInputElement).value).toBe('Hello Script');
    });

    fireEvent.change(kindSelect, { target: { value: 'transform' } });
    fireEvent.click(enabledInput);
    fireEvent.change(textarea, { target: { value: 'print("renamed")' } });

    await vi.waitFor(() => {
      expect((kindSelect as HTMLSelectElement).value).toBe('transform');
      expect((enabledInput as HTMLInputElement).checked).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Script' }));

    await vi.waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'script-1',
        expect.objectContaining({
          title: 'Hello Script',
          slug: 'hello_script',
          kind: 'transform',
          entrypoint: 'render',
          enabled: false,
          content: 'print("hello")',
        }),
      );
    });
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

  it('deletes script from editor action', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    (window as any).electronAPI.scripts.delete = deleteMock;

    useAppStore.setState({
      tabs: [{ type: 'scripts', id: 'script-1', isTransient: false }],
      activeTabId: 'script-1',
    });

    render(<ScriptsView scriptId="script-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Script' }));

    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('script-1');
      expect(useAppStore.getState().tabs).toEqual([]);
    });
  });
});
