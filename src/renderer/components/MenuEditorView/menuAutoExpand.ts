interface AutoExpandController {
  schedule: (id: string, callback: () => void) => void;
  cancel: (id: string) => void;
  cancelAll: () => void;
}

export function createAutoExpandController(delayMs: number): AutoExpandController {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancel = (id: string): void => {
    const timer = timers.get(id);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    timers.delete(id);
  };

  const cancelAll = (): void => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  const schedule = (id: string, callback: () => void): void => {
    cancel(id);

    const timer = setTimeout(() => {
      timers.delete(id);
      callback();
    }, delayMs);

    timers.set(id, timer);
  };

  return {
    schedule,
    cancel,
    cancelAll,
  };
}
