/**
 * ConfirmDeleteModal Component Tests
 *
 * Tests the REAL ConfirmDeleteModal component with mocked callbacks.
 * Following TDD best practices: verify component behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDeleteModal, type ConfirmDeleteDetails } from '../../../src/renderer/components/ConfirmDeleteModal';

describe('ConfirmDeleteModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when details is null', () => {
      const { container } = render(
        <ConfirmDeleteModal details={null} onClose={mockOnClose} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render modal when details is provided', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText('Confirm Deletion')).toBeInTheDocument();
      expect(screen.getByText(/Test Post/)).toBeInTheDocument();
    });

    it('should display post deletion message for post type', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'My Blog Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText(/delete the post/)).toBeInTheDocument();
      expect(screen.getByText('My Blog Post')).toBeInTheDocument();
    });

    it('should display media deletion message for media type', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'media',
        itemTitle: 'image.jpg',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText(/delete the media file/)).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });
  });

  describe('References Warning', () => {
    it('should not show warning when no references exist', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.queryByText(/Warning/)).not.toBeInTheDocument();
    });

    it('should show warning when references exist', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [
          { id: '1', title: 'Linked Post', type: 'link' },
        ],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText(/Warning/)).toBeInTheDocument();
      expect(screen.getByText('Linked Post')).toBeInTheDocument();
    });

    it('should list all reference types correctly', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [
          { id: '1', title: 'Some Post', type: 'post' },
          { id: '2', title: 'Some Image', type: 'media' },
          { id: '3', title: 'Some Link', type: 'link' },
        ],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText('Some Post')).toBeInTheDocument();
      expect(screen.getByText('Some Image')).toBeInTheDocument();
      expect(screen.getByText('Some Link')).toBeInTheDocument();
    });

    it('should show correct warning note', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'media',
        itemTitle: 'photo.jpg',
        references: [
          { id: '1', title: 'Blog Post', type: 'post' },
        ],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText(/Deleting this media will remove all these references/)).toBeInTheDocument();
    });
  });

  describe('User Actions', () => {
    it('should call onClose when Cancel button is clicked', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when close button is clicked', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTitle('Close'));

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when backdrop is clicked', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      const backdrop = document.querySelector('.confirm-delete-modal-backdrop');
      fireEvent.click(backdrop!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when modal content is clicked', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      const modal = document.querySelector('.confirm-delete-modal');
      fireEvent.click(modal!);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should call onConfirm and onClose when Delete button is clicked', async () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Delete Post'));

      // Wait for the async handler to complete
      await vi.waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should show correct delete button text for post', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText('Delete Post')).toBeInTheDocument();
    });

    it('should show correct delete button text for media', () => {
      const details: ConfirmDeleteDetails = {
        itemType: 'media',
        itemTitle: 'image.jpg',
        references: [],
        onConfirm: mockOnConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      expect(screen.getByText('Delete Media')).toBeInTheDocument();
    });

    it('should handle async onConfirm correctly', async () => {
      const asyncConfirm = vi.fn().mockResolvedValue(undefined);
      const details: ConfirmDeleteDetails = {
        itemType: 'post',
        itemTitle: 'Test Post',
        references: [],
        onConfirm: asyncConfirm,
      };

      render(<ConfirmDeleteModal details={details} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Delete Post'));

      // Wait for the async handler to complete
      await vi.waitFor(() => {
        expect(asyncConfirm).toHaveBeenCalledTimes(1);
      });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });
});
