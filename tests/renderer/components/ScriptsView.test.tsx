import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScriptsView } from '../../../src/renderer/components/ScriptsView/ScriptsView';
import { useAppStore } from '../../../src/renderer/store';

const executeMock = vi.fn();
const inspectEntrypointsMock = vi.fn();
const syntaxCheckMock = vi.fn();
const monacoPropsSpy = vi.fn();
const setModelMarkersMock = vi.fn();

vi.mock('@monaco-editor/react', () => ({
  default: (props: {
    value?: string;
    defaultValue?: string;
    onChange?: (value?: string) => void;
    language?: string;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    monacoPropsSpy(props);
    props.onMount?.(
      {
        getModel: () => ({ uri: 'inmemory://script.py' }),
      },
      {
        editor: {
          setModelMarkers: setModelMarkersMock,
        },
        MarkerSeverity: {
          Error: 8,
        },
      },
    );
    return (
      <textarea
        aria-label="Script Content"
        defaultValue={props.defaultValue ?? props.value ?? ''}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  },
}));

vi.mock('../../../src/renderer/python/runtimeManagerInstance', () => ({
  getPythonRuntimeManager: () => ({
    execute: executeMock,
    inspectEntrypoints: inspectEntrypointsMock,
    syntaxCheck: syntaxCheckMock,
  }),
}));

describe('ScriptsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    executeMock.mockResolvedValue({ result: '2', stdout: 'hello\n' });
    inspectEntrypointsMock.mockResolvedValue(['render', 'helper']);
    syntaxCheckMock.mockResolvedValue({ errors: [] });

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
        startTask: vi.fn().mockResolvedValue(undefined),
        completeTask: vi.fn().mockResolvedValue(undefined),
        failTask: vi.fn().mockResolvedValue(undefined),
      },
    };

    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
      panelVisible: false,
      panelActiveTab: 'tasks',
      panelOutputEntries: [],
    });
  });

  it('loads scripts and allows editing content', async () => {
    render(<ScriptsView scriptId="script-1" />);

    // After script loads, Monaco remounts with new key — re-query the textarea
    await vi.waitFor(() => {
      const textarea = screen.getByLabelText('Script Content') as HTMLTextAreaElement;
      expect(textarea.value).toContain('print("hello")');
    });

    const textarea = screen.getByLabelText('Script Content') as HTMLTextAreaElement;
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

  it('loads available entrypoints from script functions', async () => {
    render(<ScriptsView scriptId="script-1" />);

    const entrypointSelect = await screen.findByLabelText('Entrypoint') as HTMLSelectElement;

    await vi.waitFor(() => {
      expect(inspectEntrypointsMock).toHaveBeenCalledWith('print("hello")', {
        cacheKey: expect.stringMatching(/^script-1:1:/),
      });
    });

    expect(Array.from(entrypointSelect.options).map((option) => option.value)).toEqual(['main', 'render', 'helper']);
    expect(entrypointSelect.value).toBe('render');
  });

  it('always exposes main entrypoint and falls back to it when no functions are discovered', async () => {
    inspectEntrypointsMock.mockResolvedValueOnce([]);

    const updateMock = vi.fn().mockResolvedValue({
      id: 'script-1',
      projectId: 'default',
      slug: 'hello_script',
      title: 'Hello Script',
      kind: 'utility',
      entrypoint: 'main',
      enabled: true,
      version: 2,
      filePath: '/tmp/hello-script.py',
      content: 'print("hello")',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:01:00.000Z',
    });
    (window as any).electronAPI.scripts.update = updateMock;

    render(<ScriptsView scriptId="script-1" />);

    const entrypointSelect = await screen.findByLabelText('Entrypoint') as HTMLSelectElement;
    await vi.waitFor(() => {
      expect(Array.from(entrypointSelect.options).map((option) => option.value)).toEqual(['main']);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Script' }));

    await vi.waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'script-1',
        expect.objectContaining({
          entrypoint: 'main',
        }),
      );
    });
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
      expect(executeMock).toHaveBeenCalledWith('print("hello")', expect.objectContaining({
        cacheKey: expect.stringMatching(/^script-1:1:/),
        entrypoint: 'render',
        timeoutMs: 0,
      }));
    });

    const state = useAppStore.getState();
    expect(state.panelVisible).toBe(false);
    expect(state.panelActiveTab).toBe('tasks');
    expect(state.panelOutputEntries.length).toBeGreaterThan(0);
    expect(state.panelOutputEntries.some(e => e.message.includes('2'))).toBe(true);
  });

  it('checks syntax manually and writes editor markers for syntax errors', async () => {
    syntaxCheckMock.mockResolvedValueOnce({
      errors: [
        {
          line: 3,
          column: 5,
          endLine: 3,
          endColumn: 10,
          message: 'invalid syntax',
        },
      ],
    });

    render(<ScriptsView scriptId="script-1" />);

    await screen.findByLabelText('Script Content');
    fireEvent.click(screen.getByRole('button', { name: 'Check Syntax' }));

    await vi.waitFor(() => {
      expect(syntaxCheckMock).toHaveBeenCalledWith('print("hello")', {
        cacheKey: expect.stringMatching(/^script-1:1:/),
      });
      expect(setModelMarkersMock).toHaveBeenCalledWith(
        expect.anything(),
        'scripts-python-syntax',
        [
          expect.objectContaining({
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 10,
            message: 'invalid syntax',
          }),
        ],
      );
    });
  });

  it('runs syntax check automatically on save before updating script', async () => {
    const updateMock = vi.fn().mockResolvedValue({
      id: 'script-1',
      projectId: 'default',
      slug: 'hello_script',
      title: 'Hello Script',
      kind: 'utility',
      entrypoint: 'render',
      enabled: true,
      version: 2,
      filePath: '/tmp/hello-script.py',
      content: 'print("hello")',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:01:00.000Z',
    });
    (window as any).electronAPI.scripts.update = updateMock;

    render(<ScriptsView scriptId="script-1" />);

    const titleInput = await screen.findByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Hello Script Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Script' }));

    await vi.waitFor(() => {
      expect(syntaxCheckMock).toHaveBeenCalledWith('print("hello")', {
        cacheKey: expect.stringMatching(/^script-1:1:/),
      });
      expect(updateMock).toHaveBeenCalled();
    });
  });

  it('runs selected non-main entrypoint function', async () => {
    render(<ScriptsView scriptId="script-1" />);

    const entrypointSelect = await screen.findByLabelText('Entrypoint');
    fireEvent.change(entrypointSelect, { target: { value: 'helper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Script' }));

    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith('print("hello")', expect.objectContaining({
        entrypoint: 'helper',
      }));
    });
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

  it('runs utility script without timeout and creates a task', async () => {
    const startTaskMock = vi.fn().mockResolvedValue(undefined);
    const completeTaskMock = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI.scripts.startTask = startTaskMock;
    (window as any).electronAPI.scripts.completeTask = completeTaskMock;
    (window as any).electronAPI.scripts.failTask = vi.fn();

    render(<ScriptsView scriptId="script-1" />);

    await screen.findByLabelText('Script Content');
    fireEvent.click(screen.getByRole('button', { name: 'Run Script' }));

    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith('print("hello")', expect.objectContaining({
        timeoutMs: 0,
      }));
      expect(startTaskMock).toHaveBeenCalledWith(expect.stringContaining('script-'), 'Hello Script');
      expect(completeTaskMock).toHaveBeenCalledWith(expect.stringContaining('script-'));
    });
  });

  it('reports failure to task manager when utility script errors', async () => {
    executeMock.mockRejectedValueOnce(new Error('Script crashed'));
    const startTaskMock = vi.fn().mockResolvedValue(undefined);
    const failTaskMock = vi.fn().mockResolvedValue(undefined);
    (window as any).electronAPI.scripts.startTask = startTaskMock;
    (window as any).electronAPI.scripts.completeTask = vi.fn();
    (window as any).electronAPI.scripts.failTask = failTaskMock;

    render(<ScriptsView scriptId="script-1" />);

    await screen.findByLabelText('Script Content');
    fireEvent.click(screen.getByRole('button', { name: 'Run Script' }));

    await vi.waitFor(() => {
      expect(failTaskMock).toHaveBeenCalledWith(expect.stringContaining('script-'), 'Script crashed');
    });
  });

  it('runs macro/transform scripts without timeout but no task', async () => {
    (window as any).electronAPI.scripts.get = vi.fn().mockResolvedValue({
      id: 'script-1',
      projectId: 'default',
      slug: 'hello-script',
      title: 'Hello Script',
      kind: 'macro',
      entrypoint: 'render',
      enabled: true,
      version: 1,
      filePath: '/tmp/hello-script.py',
      content: 'print("hello")',
      createdAt: '2026-02-22T00:00:00.000Z',
      updatedAt: '2026-02-22T00:00:00.000Z',
    });

    const startTaskMock = vi.fn();
    (window as any).electronAPI.scripts.startTask = startTaskMock;
    (window as any).electronAPI.scripts.completeTask = vi.fn();
    (window as any).electronAPI.scripts.failTask = vi.fn();

    render(<ScriptsView scriptId="script-1" />);

    await screen.findByLabelText('Script Content');
    fireEvent.click(screen.getByRole('button', { name: 'Run Script' }));

    await vi.waitFor(() => {
      expect(executeMock).toHaveBeenCalledWith('print("hello")', expect.objectContaining({
        timeoutMs: 0,
      }));
      expect(startTaskMock).not.toHaveBeenCalled();
    });
  });

  it('defers loading until activeProject is set to avoid startup race condition', async () => {
    useAppStore.setState({ activeProject: null });

    const getMock = (window as any).electronAPI.scripts.get;
    const { rerender } = render(<ScriptsView scriptId="script-1" />);

    // Give the effect a chance to run
    await vi.waitFor(() => {
      expect(getMock).not.toHaveBeenCalled();
    });

    // Now simulate project context becoming available
    useAppStore.setState({
      activeProject: { id: 'project-1', name: 'Test', path: '/tmp/test' } as any,
    });

    // Re-render to pick up store change
    rerender(<ScriptsView scriptId="script-1" />);

    await vi.waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('script-1');
      const textarea = screen.getByLabelText('Script Content') as HTMLTextAreaElement;
      expect(textarea.value).toContain('print("hello")');
    });
  });
});
