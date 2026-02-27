import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplatesView } from '../../../src/renderer/components/TemplatesView/TemplatesView';
import { useAppStore } from '../../../src/renderer/store';

const monacoPropsSpy = vi.fn();

vi.mock('@monaco-editor/react', () => ({
  default: (props: {
    value?: string;
    defaultValue?: string;
    onChange?: (value?: string) => void;
    language?: string;
  }) => {
    monacoPropsSpy(props);
    return (
      <textarea
        aria-label="Template Content"
        defaultValue={props.defaultValue ?? props.value ?? ''}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  },
}));

const mockTemplate = {
  id: 'template-1',
  projectId: 'default',
  slug: 'custom_post',
  title: 'Custom Post',
  kind: 'post' as const,
  enabled: true,
  version: 1,
  filePath: '/tmp/custom_post.liquid',
  content: '<main>{{ post.title }}</main>',
  createdAt: '2026-02-22T00:00:00.000Z',
  updatedAt: '2026-02-22T00:00:00.000Z',
};

describe('TemplatesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      templates: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({ deleted: true }),
        get: vi.fn().mockResolvedValue({ ...mockTemplate }),
        getAll: vi.fn().mockResolvedValue([]),
        getEnabledByKind: vi.fn().mockResolvedValue([]),
        validate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
        rebuildFromFiles: vi.fn(),
      },
    };
  });

  it('loads template and displays metadata fields', async () => {
    render(<TemplatesView templateId="template-1" />);

    const titleInput = await screen.findByLabelText('Title') as HTMLInputElement;
    const slugInput = screen.getByLabelText('Slug') as HTMLInputElement;
    const kindSelect = screen.getByLabelText('Kind') as HTMLSelectElement;
    const enabledInput = screen.getByLabelText('Enabled') as HTMLInputElement;

    await vi.waitFor(() => {
      expect(titleInput.value).toBe('Custom Post');
      expect(slugInput.value).toBe('custom_post');
    });
    expect(kindSelect.value).toBe('post');
    expect(enabledInput.checked).toBe(true);

    expect(screen.getByText(/Created:/)).toBeInTheDocument();
    expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  });

  it('loads template content into Monaco editor with html language', async () => {
    render(<TemplatesView templateId="template-1" />);

    await vi.waitFor(() => {
      const textarea = screen.getByLabelText('Template Content') as HTMLTextAreaElement;
      expect(textarea.value).toContain('{{ post.title }}');
    });

    expect(monacoPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'html',
      }),
    );
  });

  it('saves template metadata via update IPC call', async () => {
    const updateMock = vi.fn().mockResolvedValue({
      ...mockTemplate,
      kind: 'list',
      enabled: false,
      version: 2,
      updatedAt: '2026-02-22T00:01:00.000Z',
    });
    (window as any).electronAPI.templates.update = updateMock;

    render(<TemplatesView templateId="template-1" />);

    const kindSelect = screen.getByLabelText('Kind');
    const enabledInput = screen.getByLabelText('Enabled');

    await vi.waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Custom Post');
    });

    fireEvent.change(kindSelect, { target: { value: 'list' } });
    fireEvent.click(enabledInput);

    await vi.waitFor(() => {
      expect((kindSelect as HTMLSelectElement).value).toBe('list');
      expect((enabledInput as HTMLInputElement).checked).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await vi.waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({
          title: 'Custom Post',
          slug: 'custom_post',
          kind: 'list',
          enabled: false,
          content: '<main>{{ post.title }}</main>',
        }),
      );
    });
  });

  it('validates before saving and blocks save on invalid syntax', async () => {
    const validateMock = vi.fn().mockResolvedValue({
      valid: false,
      errors: ['unexpected end of tag'],
    });
    const updateMock = vi.fn();
    (window as any).electronAPI.templates.validate = validateMock;
    (window as any).electronAPI.templates.update = updateMock;

    render(<TemplatesView templateId="template-1" />);

    await vi.waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Custom Post');
    });

    // Trigger hasChanges via kind change (select events work reliably)
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'list' } });

    await vi.waitFor(() => {
      expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('list');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await vi.waitFor(() => {
      expect(validateMock).toHaveBeenCalled();
    });

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('validates template content via validate button', async () => {
    const validateMock = vi.fn().mockResolvedValue({ valid: true, errors: [] });
    (window as any).electronAPI.templates.validate = validateMock;

    render(<TemplatesView templateId="template-1" />);

    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));

    await vi.waitFor(() => {
      expect(validateMock).toHaveBeenCalledWith('<main>{{ post.title }}</main>');
    });
  });

  it('deletes template and closes tab', async () => {
    const deleteMock = vi.fn().mockResolvedValue({ deleted: true });
    (window as any).electronAPI.templates.delete = deleteMock;

    useAppStore.setState({
      tabs: [{ type: 'templates', id: 'template-1', isTransient: false }],
      activeTabId: 'template-1',
    });

    render(<TemplatesView templateId="template-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Template' }));

    await vi.waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('template-1');
      expect(useAppStore.getState().tabs).toEqual([]);
    });
  });

  it('disables save button when no changes exist', async () => {
    render(<TemplatesView templateId="template-1" />);

    await screen.findByLabelText('Title');

    await vi.waitFor(() => {
      const saveButton = screen.getByRole('button', { name: 'Save Template' });
      expect(saveButton).toBeDisabled();
    });
  });
});
