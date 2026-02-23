import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { addWindowEventListener, type BdsWindowEventName } from '../../utils';

interface ProjectScopedSidebarDataOptions<TItem> {
  load: () => Promise<TItem[] | null | undefined>;
  activeProjectId?: string;
  refreshEventName?: BdsWindowEventName;
}

interface ProjectScopedSidebarDataResult<TItem> {
  items: TItem[];
  setItems: Dispatch<SetStateAction<TItem[]>>;
  isLoading: boolean;
  reload: () => Promise<void>;
}

export function useProjectScopedSidebarData<TItem>(options: ProjectScopedSidebarDataOptions<TItem>): ProjectScopedSidebarDataResult<TItem> {
  const { load, activeProjectId, refreshEventName } = options;
  const [items, setItems] = useState<TItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    const nextItems = await load();
    setItems(nextItems ?? []);
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setIsLoading(true);
      try {
        const nextItems = await load();
        if (cancelled) {
          return;
        }
        setItems(nextItems ?? []);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [load, activeProjectId]);

  useEffect(() => {
    if (!refreshEventName) {
      return;
    }

    const unsubscribe = addWindowEventListener(refreshEventName, () => {
      void reload();
    });

    return unsubscribe;
  }, [refreshEventName, reload]);

  return {
    items,
    setItems,
    isLoading,
    reload,
  };
}
