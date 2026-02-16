import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsertModal } from '../../../src/renderer/components/InsertModal/InsertModal';

describe('InsertModal format hints', () => {
  it('shows canonical post link format hint in internal link mode', () => {
    render(
      <InsertModal
        mode="link"
        onInsertLink={vi.fn()}
        onInsertImage={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Canonical: /YYYY/MM/DD/slug')).toBeInTheDocument();
  });

  it('shows canonical media format hint in internal image mode', () => {
    render(
      <InsertModal
        mode="image"
        onInsertLink={vi.fn()}
        onInsertImage={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Canonical: /media/YYYY/MM/file.ext')).toBeInTheDocument();
  });
});
