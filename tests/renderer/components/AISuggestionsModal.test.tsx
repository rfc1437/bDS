import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AISuggestionsModal, type SuggestionField } from '../../../src/renderer/components/AISuggestionsModal/AISuggestionsModal';

const mediaFields: SuggestionField[] = [
  { key: 'title', label: 'Title', currentValue: 'Existing title', suggestedValue: 'Suggested title' },
  { key: 'alt', label: 'Alt Text', currentValue: 'Existing alt', suggestedValue: 'Suggested alt' },
  { key: 'caption', label: 'Caption', currentValue: '', suggestedValue: 'Suggested caption' },
];

describe('AISuggestionsModal', () => {
  it('shows suggested fields and applies only selected values', () => {
    const onConfirm = vi.fn();

    render(
      <AISuggestionsModal
        isOpen
        isLoading={false}
        fields={mediaFields}
        modalTitle="AI Image Analysis"
        loadingText="Analyzing image..."
        emptyText="No suggestions."
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Suggested title')).toBeTruthy();
    expect(screen.getByText('Suggested alt')).toBeTruthy();
    expect(screen.getByText('Suggested caption')).toBeTruthy();

    const applyButton = screen.getByRole('button', { name: 'Apply Selected' });

    const [titleCheckbox, altCheckbox, captionCheckbox] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // Fields with existing values should be unchecked
    expect(titleCheckbox.checked).toBe(false);
    expect(altCheckbox.checked).toBe(false);
    // Field with empty current value should be checked
    expect(captionCheckbox.checked).toBe(true);
    expect(applyButton).not.toBeDisabled();

    fireEvent.click(captionCheckbox);
    expect(applyButton).toBeDisabled();

    fireEvent.click(captionCheckbox);
    expect(applyButton).not.toBeDisabled();

    fireEvent.click(applyButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      caption: 'Suggested caption',
    });
  });

  it('hides apply button when no suggestions are available', () => {
    const emptyFields: SuggestionField[] = [
      { key: 'title', label: 'Title', currentValue: '', suggestedValue: undefined },
    ];

    render(
      <AISuggestionsModal
        isOpen
        isLoading={false}
        fields={emptyFields}
        modalTitle="AI Analysis"
        loadingText="Analyzing..."
        emptyText="No suggestions were generated."
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Apply Selected' })).toBeNull();
    expect(screen.getByText('No suggestions were generated.')).toBeTruthy();
  });

  it('shows custom modal title and loading text', () => {
    render(
      <AISuggestionsModal
        isOpen
        isLoading={true}
        fields={[]}
        modalTitle="AI Post Analysis"
        loadingText="Analyzing post…"
        emptyText="No suggestions."
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('AI Post Analysis')).toBeTruthy();
    expect(screen.getByText('Analyzing post…')).toBeTruthy();
  });

  it('works with post analysis fields (title, excerpt, slug)', () => {
    const postFields: SuggestionField[] = [
      { key: 'title', label: 'Title', currentValue: 'My Post', suggestedValue: 'Better Title' },
      { key: 'excerpt', label: 'Summary / Excerpt', currentValue: '', suggestedValue: 'A concise summary.' },
      { key: 'slug', label: 'Slug', currentValue: 'my-post', suggestedValue: 'better-title' },
    ];

    const onConfirm = vi.fn();

    render(
      <AISuggestionsModal
        isOpen
        isLoading={false}
        fields={postFields}
        modalTitle="AI Post Analysis"
        loadingText="Analyzing post…"
        emptyText="No suggestions."
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // title has value → unchecked; excerpt empty → checked; slug has value → unchecked
    expect(checkboxes[0].checked).toBe(false); // title
    expect(checkboxes[1].checked).toBe(true);  // excerpt
    expect(checkboxes[2].checked).toBe(false); // slug

    // Apply only the excerpt (pre-selected)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected' }));

    expect(onConfirm).toHaveBeenCalledWith({
      excerpt: 'A concise summary.',
    });
  });
});
