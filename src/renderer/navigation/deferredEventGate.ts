export interface DeferredEventGate<T> {
  push: (event: T, consume: (event: T) => void) => void;
  markReady: (consume: (event: T) => void) => void;
  isReady: () => boolean;
}

export function createDeferredEventGate<T>(): DeferredEventGate<T> {
  let ready = false;
  let queue: T[] = [];

  return {
    push: (event, consume) => {
      if (ready) {
        consume(event);
        return;
      }

      queue.push(event);
    },
    markReady: (consume) => {
      if (ready) {
        return;
      }

      ready = true;
      const queuedEvents = queue;
      queue = [];

      for (const event of queuedEvents) {
        consume(event);
      }
    },
    isReady: () => ready,
  };
}
