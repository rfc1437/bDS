import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AISuggestionsModal, type AISuggestions } from '../../../src/renderer/components/AISuggestionsModal/AISuggestionsModal';

const currentValues = {
  title: 'Existing title',
  alt: 'Existing alt',
  caption: '',
};

const baseSuggestions: AISuggestions = {
  title: 'Suggested title',
  alt: 'Suggested alt',
  caption: 'Suggested caption',
};

describe('AISuggestionsModal', () => {
  it('shows suggested fields and applies only selected values', () => {
    const onConfirm = vi.fn();

    render(
      <AISuggestionsModal
        isOpen
        isLoading={false}
        suggestions={baseSuggestions}
        currentValues={currentValues}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Suggested title')).toBeTruthy();
    expect(screen.getByText('Suggested alt')).toBeTruthy();
    expect(screen.getByText('Suggested caption')).toBeTruthy();

    const applyButton = screen.getByRole('button', { name: 'Apply Selected' });

    const [titleCheckbox, altCheckbox, captionCheckbox] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(titleCheckbox.checked).toBe(false);
    expect(altCheckbox.checked).toBe(false);
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
    render(
      <AISuggestionsModal
        isOpen
        isLoading={false}
        suggestions={{}}
        currentValues={{ title: '', alt: '', caption: '' }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Apply Selected' })).toBeNull();
    expect(screen.getByText('No suggestions were generated for this image.')).toBeTruthy();
  });
});
