/**
 * Tests for auto-save functionality with idle detection
 * Validates that drafts are automatically saved after a configurable idle period
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutoSaveManager } from '../../../src/renderer/utils/autoSave';

// Mock the electronAPI  
const mockSaveDraft = vi.fn().mockResolvedValue({ id: 'post-1', title: 'Test' });
const mockGetPost = vi.fn().mockResolvedValue({ id: 'post-1', title: 'Test', content: 'Content' });

describe('AutoSaveManager', () => {
  let autoSaveManager: AutoSaveManager;
  let onSaveCallback: ReturnType<typeof vi.fn>;
  let onSaveCompleteCallback: ReturnType<typeof vi.fn>;
  let onSaveErrorCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    
    onSaveCallback = vi.fn().mockResolvedValue(undefined);
    onSaveCompleteCallback = vi.fn();
    onSaveErrorCallback = vi.fn();
    
    autoSaveManager = new AutoSaveManager({
      idleTimeMs: 3000, // 3 seconds idle before save
      onSave: onSaveCallback,
      onSaveComplete: onSaveCompleteCallback,
      onSaveError: onSaveErrorCallback,
    });
  });

  afterEach(() => {
    autoSaveManager.dispose();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Idle Detection', () => {
    it('should not save until idle time has passed', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Updated content' });

      // Advance time by less than idle time
      vi.advanceTimersByTime(2000);

      expect(onSaveCallback).not.toHaveBeenCalled();
    });

    it('should save after idle time has passed', async () => {
      autoSaveManager.notifyChange('post-1', { content: 'Updated content' });

      // Advance time past idle threshold
      vi.advanceTimersByTime(3500);

      expect(onSaveCallback).toHaveBeenCalledTimes(1);
      expect(onSaveCallback).toHaveBeenCalledWith('post-1', { content: 'Updated content' });
    });

    it('should reset idle timer on each change', () => {
      autoSaveManager.notifyChange('post-1', { content: 'First change' });
      
      // Advance time by 2 seconds
      vi.advanceTimersByTime(2000);
      
      // Make another change - should reset timer
      autoSaveManager.notifyChange('post-1', { content: 'Second change' });
      
      // Advance time by 2 more seconds (4 seconds since first change)
      vi.advanceTimersByTime(2000);
      
      // Should not have saved yet because timer was reset
      expect(onSaveCallback).not.toHaveBeenCalled();
      
      // Advance past the new idle threshold
      vi.advanceTimersByTime(1500);
      
      // Now it should save
      expect(onSaveCallback).toHaveBeenCalledTimes(1);
      expect(onSaveCallback).toHaveBeenCalledWith('post-1', { content: 'Second change' });
    });

    it('should accumulate changes before saving', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Change 1' });
      vi.advanceTimersByTime(1000);
      
      autoSaveManager.notifyChange('post-1', { title: 'New Title' });
      vi.advanceTimersByTime(1000);
      
      autoSaveManager.notifyChange('post-1', { content: 'Change 3' });
      vi.advanceTimersByTime(3500);

      expect(onSaveCallback).toHaveBeenCalledTimes(1);
      // Should have merged the changes
      expect(onSaveCallback).toHaveBeenCalledWith('post-1', { 
        title: 'New Title',
        content: 'Change 3' 
      });
    });
  });

  describe('Multiple Items', () => {
    it('should track changes for multiple items independently', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Post 1 content' });
      vi.advanceTimersByTime(1000);
      
      autoSaveManager.notifyChange('post-2', { content: 'Post 2 content' });
      vi.advanceTimersByTime(2500);
      
      // Post 1 should save first (3.5 seconds since its last change)
      expect(onSaveCallback).toHaveBeenCalledTimes(1);
      expect(onSaveCallback).toHaveBeenCalledWith('post-1', { content: 'Post 1 content' });
      
      // Advance to save post 2
      vi.advanceTimersByTime(1000);
      
      expect(onSaveCallback).toHaveBeenCalledTimes(2);
      expect(onSaveCallback).toHaveBeenLastCalledWith('post-2', { content: 'Post 2 content' });
    });
  });

  describe('Force Save', () => {
    it('should immediately save all pending changes on forceSave', async () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content 1' });
      autoSaveManager.notifyChange('post-2', { content: 'Content 2' });

      await autoSaveManager.forceSave();

      expect(onSaveCallback).toHaveBeenCalledTimes(2);
    });

    it('should clear pending changes after forceSave', async () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      await autoSaveManager.forceSave();
      
      // Advance time - no additional saves should occur
      vi.advanceTimersByTime(5000);
      
      expect(onSaveCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cancel', () => {
    it('should cancel pending save for specific item', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      autoSaveManager.cancel('post-1');
      
      vi.advanceTimersByTime(5000);
      
      expect(onSaveCallback).not.toHaveBeenCalled();
    });

    it('should not affect other pending saves when canceling one', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content 1' });
      autoSaveManager.notifyChange('post-2', { content: 'Content 2' });
      
      autoSaveManager.cancel('post-1');
      
      vi.advanceTimersByTime(5000);
      
      expect(onSaveCallback).toHaveBeenCalledTimes(1);
      expect(onSaveCallback).toHaveBeenCalledWith('post-2', { content: 'Content 2' });
    });
  });

  describe('Callbacks', () => {
    it('should call onSaveComplete after successful save', async () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      vi.advanceTimersByTime(3500);
      
      // Wait for async save to complete
      await vi.runAllTimersAsync();
      
      expect(onSaveCompleteCallback).toHaveBeenCalledWith('post-1');
    });

    it('should call onSaveError when save fails', async () => {
      const error = new Error('Save failed');
      onSaveCallback.mockRejectedValueOnce(error);
      
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      vi.advanceTimersByTime(3500);
      
      // Wait for async save to complete
      await vi.runAllTimersAsync();
      
      expect(onSaveErrorCallback).toHaveBeenCalledWith('post-1', error);
    });
  });

  describe('Has Pending Changes', () => {
    it('should report pending changes correctly', () => {
      expect(autoSaveManager.hasPendingChanges()).toBe(false);
      
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      expect(autoSaveManager.hasPendingChanges()).toBe(true);
      expect(autoSaveManager.hasPendingChanges('post-1')).toBe(true);
      expect(autoSaveManager.hasPendingChanges('post-2')).toBe(false);
    });

    it('should clear pending status after save', async () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      vi.advanceTimersByTime(3500);
      await vi.runAllTimersAsync();
      
      expect(autoSaveManager.hasPendingChanges('post-1')).toBe(false);
    });
  });

  describe('Dispose', () => {
    it('should cancel all pending saves on dispose', () => {
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      autoSaveManager.dispose();
      
      vi.advanceTimersByTime(5000);
      
      expect(onSaveCallback).not.toHaveBeenCalled();
    });
  });

  describe('Configuration', () => {
    it('should use custom idle time', () => {
      autoSaveManager.dispose();
      
      autoSaveManager = new AutoSaveManager({
        idleTimeMs: 5000, // 5 seconds
        onSave: onSaveCallback,
        onSaveComplete: onSaveCompleteCallback,
        onSaveError: onSaveErrorCallback,
      });
      
      autoSaveManager.notifyChange('post-1', { content: 'Content' });
      
      // Should not save at 4 seconds
      vi.advanceTimersByTime(4000);
      expect(onSaveCallback).not.toHaveBeenCalled();
      
      // Should save at 5.5 seconds
      vi.advanceTimersByTime(1500);
      expect(onSaveCallback).toHaveBeenCalledTimes(1);
    });
  });
});
