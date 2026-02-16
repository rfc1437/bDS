type ElectronOn = ((channel: string, callback: (...args: unknown[]) => void) => (() => void) | void) | undefined;

interface SubscribeTagEventsOptions {
  includeUpdated?: boolean;
}

const BASE_TAG_EVENTS = ['tag:created', 'tag:deleted', 'tag:renamed', 'tags:merged'] as const;

export function subscribeToTagEvents(
  on: ElectronOn,
  callback: () => void,
  options: SubscribeTagEventsOptions = {}
): () => void {
  if (!on) {
    return () => {};
  }

  const channels = options.includeUpdated
    ? [...BASE_TAG_EVENTS, 'tag:updated']
    : BASE_TAG_EVENTS;

  const unsubscribers = channels.map((channel) => on(channel, callback) || (() => {}));

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
