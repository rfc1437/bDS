export interface ActivateSidebarSectionOptions {
  isEditorTabActive: boolean;
  ensureEditorTabActive: () => void;
  activateSection: () => void;
  delayWhenOpeningEditorMs?: number;
  schedule?: (callback: () => void, delayMs: number) => void;
}

export function activateSidebarSection(options: ActivateSidebarSectionOptions): void {
  const {
    isEditorTabActive,
    ensureEditorTabActive,
    activateSection,
    delayWhenOpeningEditorMs = 100,
    schedule,
  } = options;

  const runLater = schedule ?? ((callback: () => void, delayMs: number) => {
    window.setTimeout(callback, delayMs);
  });

  if (!isEditorTabActive) {
    ensureEditorTabActive();
    runLater(activateSection, delayWhenOpeningEditorMs);
    return;
  }

  runLater(activateSection, 0);
}
