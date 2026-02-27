export const BDS_EVENT_SCRIPTS_CHANGED = 'bds:scripts-changed' as const;
export const BDS_EVENT_TEMPLATES_CHANGED = 'bds:templates-changed' as const;

export type BdsWindowEventName =
  | typeof BDS_EVENT_SCRIPTS_CHANGED
  | typeof BDS_EVENT_TEMPLATES_CHANGED
  | 'bds:site-validation-updated';

export function addWindowEventListener<TDetail = unknown>(
  eventName: BdsWindowEventName,
  handler: (event: CustomEvent<TDetail>) => void,
): () => void {
  if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') {
    return () => {};
  }

  const listener = (event: Event) => {
    handler(event as CustomEvent<TDetail>);
  };

  window.addEventListener(eventName, listener as EventListener);
  return () => {
    window.removeEventListener(eventName, listener as EventListener);
  };
}

export function dispatchWindowEvent<TDetail = unknown>(
  eventName: BdsWindowEventName,
  detail?: TDetail,
): boolean {
  if (typeof window.dispatchEvent !== 'function') {
    return false;
  }

  return window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }));
}
