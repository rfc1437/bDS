import { describe, expect, it, vi } from 'vitest';
import { activateSidebarSection } from '../../../src/renderer/navigation/sectionActivation';

describe('sectionActivation', () => {
  it('opens editor first and delays section activation when editor is not active', () => {
    const ensureEditor = vi.fn();
    const activateSection = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());

    activateSidebarSection({
      isEditorTabActive: false,
      ensureEditorTabActive: ensureEditor,
      activateSection,
      schedule,
      delayWhenOpeningEditorMs: 100,
    });

    expect(ensureEditor).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 100);
    expect(activateSection).toHaveBeenCalledTimes(1);
  });

  it('activates section immediately when editor tab is already active', () => {
    const ensureEditor = vi.fn();
    const activateSection = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());

    activateSidebarSection({
      isEditorTabActive: true,
      ensureEditorTabActive: ensureEditor,
      activateSection,
      schedule,
    });

    expect(ensureEditor).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(activateSection).toHaveBeenCalledTimes(1);
  });
});
