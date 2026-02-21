import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import { useI18n } from '../../i18n';
import { showToast } from '../Toast';
import type { MenuDocument, MenuItemData, PostData } from '../../../main/shared/electronApi';
import { PageInput } from '../PageInput';
import { CategoryInput } from '../CategoryInput';
import { createAutoExpandController } from './menuAutoExpand';
import { resolveInsertTarget } from './menuInsertTarget';
import { isPickerCloseKey } from './menuPagePicker';
import { applyTreeMove } from './menuTreeMove';
import './MenuEditorView.css';

const HOME_MENU_ID = 'menu-home';

interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  onShowTooltip: (label: string) => void;
  onHideTooltip: () => void;
  children: React.ReactNode;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  label,
  disabled,
  onClick,
  onShowTooltip,
  onHideTooltip,
  children,
}) => (
  <div className="menu-editor-tool-wrap">
    <button
      type="button"
      className="menu-editor-tool"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => onShowTooltip(label)}
      onMouseLeave={onHideTooltip}
      onFocus={() => onShowTooltip(label)}
      onBlur={onHideTooltip}
      disabled={disabled}
    >
      {children}
    </button>
  </div>
);

function createMenuItemId(): string {
  return `menu-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findPathById(items: MenuItemData[], id: string, path: number[] = []): number[] | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const nextPath = [...path, index];
    if (item.id === id) {
      return nextPath;
    }

    const nested = findPathById(item.children, id, nextPath);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function removeItemByPath(items: MenuItemData[], path: number[]): { next: MenuItemData[]; removed: MenuItemData | null } {
  if (path.length === 0) {
    return { next: items, removed: null };
  }

  if (path.length === 1) {
    const [index] = path;
    if (index < 0 || index >= items.length) {
      return { next: items, removed: null };
    }
    const removed = items[index];
    return {
      next: items.filter((_, currentIndex) => currentIndex !== index),
      removed,
    };
  }

  const [head, ...tail] = path;
  const current = items[head];
  if (!current) {
    return { next: items, removed: null };
  }

  const nested = removeItemByPath(current.children, tail);
  if (!nested.removed) {
    return { next: items, removed: null };
  }

  const next = items.map((item, index) => (index === head ? { ...item, children: nested.next } : item));
  return { next, removed: nested.removed };
}

function updateItemsAtLevel(
  items: MenuItemData[],
  path: number[],
  updater: (level: MenuItemData[]) => MenuItemData[],
): MenuItemData[] {
  if (path.length === 0) {
    return updater(items);
  }

  const [head, ...tail] = path;
  return items.map((item, index) => {
    if (index !== head) {
      return item;
    }

    return {
      ...item,
      children: updateItemsAtLevel(item.children, tail, updater),
    };
  });
}

function insertItemAtPath(items: MenuItemData[], parentPath: number[], index: number, node: MenuItemData): MenuItemData[] {
  if (parentPath.length === 0) {
    const boundedIndex = Math.max(0, Math.min(index, items.length));
    return [...items.slice(0, boundedIndex), node, ...items.slice(boundedIndex)];
  }

  const [head, ...tail] = parentPath;
  return items.map((item, currentIndex) => {
    if (currentIndex !== head) {
      return item;
    }

    return {
      ...item,
      children: insertItemAtPath(item.children, tail, index, node),
    };
  });
}

function mapItems(items: MenuItemData[], mapper: (item: MenuItemData) => MenuItemData): MenuItemData[] {
  return items.map((item) => {
    const mapped = mapper(item);
    if (mapped.children.length === 0) {
      return mapped;
    }

    return {
      ...mapped,
      children: mapItems(mapped.children, mapper),
    };
  });
}

function createDraftEntry(kind: MenuItemData['kind'] = 'submenu'): MenuItemData {
  return {
    id: createMenuItemId(),
    title: '',
    kind,
    pageId: undefined,
    pageSlug: undefined,
    categoryName: undefined,
    children: [],
  };
}

function renderMenuKindIcon(kind: MenuItemData['kind']): React.ReactNode {
  if (kind === 'home') {
    return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2 2 7v7h4V9h4v5h4V7L8 2z" /></svg>;
  }

  if (kind === 'page') {
    return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h7l3 3v9H3V2zm7 1.5V6h2.5L10 3.5z" /></svg>;
  }

  if (kind === 'category-archive') {
    return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12v3H2V3zm1 4h10v6H3V7zm2 1v1h6V8H5z" /></svg>;
  }

  return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h12v2H2v-2z" /></svg>;
}

export const MenuEditorView: React.FC = () => {
  const { t: tr } = useI18n();
  const [items, setItems] = useState<MenuItemData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [pagePosts, setPagePosts] = useState<PostData[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryType, setEditingEntryType] = useState<'page' | 'category' | null>(null);
  const [treeHeight, setTreeHeight] = useState<number>(460);
  const [toolbarTooltip, setToolbarTooltip] = useState<string>('');
  const [recentParentInsertId, setRecentParentInsertId] = useState<string | null>(null);
  const treeWrapRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const recentInsertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandController = useMemo(() => createAutoExpandController(450), []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const menu = await window.electronAPI.menu.get();
        setItems(menu.items);
        setSelectedId(menu.items[0]?.id ?? null);
      } catch (error) {
        console.error('Failed to load menu:', error);
        showToast.error(tr('menuEditor.loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [tr]);

  useEffect(() => {
    return () => {
      autoExpandController.cancelAll();
      if (recentInsertTimerRef.current) {
        clearTimeout(recentInsertTimerRef.current);
      }
    };
  }, [autoExpandController]);

  useEffect(() => {
    if (!editingEntryId) {
      return;
    }

    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (isPickerCloseKey(event.key)) {
        event.preventDefault();
        setItems((previous) => {
          const path = findPathById(previous, editingEntryId);
          if (!path) {
            return previous;
          }
          return removeItemByPath(previous, path).next;
        });
        setEditingEntryId(null);
        setEditingEntryType(null);
      }
    };

    document.addEventListener('keydown', onWindowKeyDown);
    return () => {
      document.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [editingEntryId]);

  useEffect(() => {
    if (!editingEntryId || (editingEntryType === 'page' && isLoadingPages) || (editingEntryType === 'category' && isLoadingCategories)) {
      return;
    }

    const focusInput = (): void => {
      const input = document.querySelector('.menu-editor-row-title.is-editing .tag-input-field') as HTMLInputElement | null;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    };

    const immediate = setTimeout(focusInput, 0);
    const delayed = setTimeout(focusInput, 32);

    return () => {
      clearTimeout(immediate);
      clearTimeout(delayed);
    };
  }, [editingEntryId, editingEntryType, isLoadingPages, isLoadingCategories]);

  useEffect(() => {
    const updateTreeHeight = (): void => {
      const wrap = treeWrapRef.current;
      const toolbar = toolbarRef.current;
      if (!wrap) {
        return;
      }

      const wrapHeight = wrap.clientHeight;
      const toolbarHeight = toolbar?.offsetHeight ?? 0;
      const next = Math.max(120, wrapHeight - toolbarHeight - 8);
      setTreeHeight(next);
    };

    updateTreeHeight();

    if (typeof ResizeObserver === 'undefined') {
      if (typeof window.addEventListener !== 'function') {
        return;
      }

      window.addEventListener('resize', updateTreeHeight);
      return () => {
        window.removeEventListener('resize', updateTreeHeight);
      };
    }

    const observer = new ResizeObserver(() => {
      updateTreeHeight();
    });

    if (treeWrapRef.current) {
      observer.observe(treeWrapRef.current);
    }
    if (toolbarRef.current) {
      observer.observe(toolbarRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [editingEntryId]);

  const selectedPath = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return findPathById(items, selectedId);
  }, [items, selectedId]);

  const ensurePagePostsLoaded = async (): Promise<void> => {
    if (pagePosts.length > 0) {
      return;
    }

    setIsLoadingPages(true);
    try {
      const posts = await window.electronAPI.posts.filter({ categories: ['page'] });
      setPagePosts(posts);
    } catch (error) {
      console.error('Failed to load page posts:', error);
      showToast.error(tr('menuEditor.pagePicker.loadError'));
      setPagePosts([]);
    } finally {
      setIsLoadingPages(false);
    }
  };

  const ensureCategoriesLoaded = async (): Promise<void> => {
    if (categories.length > 0) {
      return;
    }

    setIsLoadingCategories(true);
    try {
      const nextCategories = await window.electronAPI.meta.getCategories();
      setCategories(nextCategories);
    } catch (error) {
      console.error('Failed to load categories:', error);
      showToast.error(tr('menuEditor.categoryPicker.loadError'));
      setCategories([]);
    } finally {
      setIsLoadingCategories(false);
    }
  };

  const setDraftAsSubmenu = (label: string): void => {
    if (!editingEntryId) {
      return;
    }

    const trimmed = label.trim();
    const nextTitle = trimmed || tr('menuEditor.newSubmenu');

    setItems((previous) => mapItems(previous, (item) => {
      if (item.id !== editingEntryId) {
        return item;
      }

      return {
        ...item,
        title: nextTitle,
        kind: 'submenu',
        pageId: undefined,
        pageSlug: undefined,
      };
    }));

    setEditingEntryId(null);
    setEditingEntryType(null);
  };

  const setDraftAsPage = (post: PostData): void => {
    if (!editingEntryId) {
      return;
    }

    setItems((previous) => mapItems(previous, (item) => {
      if (item.id !== editingEntryId) {
        return item;
      }

      return {
        ...item,
        title: post.title,
        kind: 'page',
        pageId: post.id,
        pageSlug: post.slug,
      };
    }));

    setEditingEntryId(null);
    setEditingEntryType(null);
  };

  const setDraftAsCategoryArchive = (categoryName: string): void => {
    if (!editingEntryId) {
      return;
    }

    const trimmed = categoryName.trim();
    if (!trimmed) {
      return;
    }

    setItems((previous) => mapItems(previous, (item) => {
      if (item.id !== editingEntryId) {
        return item;
      }

      return {
        ...item,
        title: trimmed,
        kind: 'category-archive',
        pageId: undefined,
        pageSlug: undefined,
        categoryName: trimmed,
      };
    }));

    setEditingEntryId(null);
    setEditingEntryType(null);
  };

  const startCreateEntry = async (): Promise<void> => {
    await ensurePagePostsLoaded();

    const newEntry = createDraftEntry();
    const target = resolveInsertTarget(items, selectedId);

    if (target.parentPath.length > 0) {
      const parentPath = target.parentPath;
      let parentNode: MenuItemData | null = null;
      let currentLevel = items;
      for (const segment of parentPath) {
        parentNode = currentLevel[segment] || null;
        if (!parentNode) {
          break;
        }
        currentLevel = parentNode.children;
      }

      if (parentNode) {
        setRecentParentInsertId(parentNode.id);
        if (recentInsertTimerRef.current) {
          clearTimeout(recentInsertTimerRef.current);
        }
        recentInsertTimerRef.current = setTimeout(() => {
          setRecentParentInsertId(null);
          recentInsertTimerRef.current = null;
        }, 900);
      }
    }

    setItems((previous) => {
      return insertItemAtPath(previous, target.parentPath, target.index, newEntry);
    });

    setSelectedId(newEntry.id);
    setEditingEntryId(newEntry.id);
    setEditingEntryType('page');
  };

  const startCreateCategoryArchive = async (): Promise<void> => {
    await ensureCategoriesLoaded();

    const newEntry = createDraftEntry('category-archive');
    const target = resolveInsertTarget(items, selectedId);

    setItems((previous) => {
      return insertItemAtPath(previous, target.parentPath, target.index, newEntry);
    });

    setSelectedId(newEntry.id);
    setEditingEntryId(newEntry.id);
    setEditingEntryType('category');
  };

  const save = async (): Promise<void> => {
    setIsSaving(true);
    try {
      const payload: MenuDocument = { items };
      const saved = await window.electronAPI.menu.save(payload);
      setItems(saved.items);
      showToast.success(tr('menuEditor.saved'));
    } catch (error) {
      console.error('Failed to save menu:', error);
      showToast.error(tr('menuEditor.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const moveSelected = (direction: 'up' | 'down'): void => {
    if (!selectedPath || selectedPath.length === 0) {
      return;
    }

    const parentPath = selectedPath.slice(0, -1);
    const index = selectedPath[selectedPath.length - 1];
    const delta = direction === 'up' ? -1 : 1;

    setItems((previous) => updateItemsAtLevel(previous, parentPath, (level) => {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= level.length) {
        return level;
      }

      const next = [...level];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    }));
  };

  const indentSelected = (): void => {
    if (!selectedPath || selectedPath.length === 0) {
      return;
    }

    const index = selectedPath[selectedPath.length - 1];
    if (index <= 0) {
      return;
    }

    const parentPath = selectedPath.slice(0, -1);
    setItems((previous) => {
      const removed = removeItemByPath(previous, selectedPath);
      if (!removed.removed) {
        return previous;
      }

      const previousSiblingPath = [...parentPath, index - 1];
      return updateItemsAtLevel(removed.next, previousSiblingPath, (level) => [...level, removed.removed as MenuItemData]);
    });
  };

  const unindentSelected = (): void => {
    if (!selectedPath || selectedPath.length < 2) {
      return;
    }

    const parentPath = selectedPath.slice(0, -1);
    const parentIndex = parentPath[parentPath.length - 1];
    const grandParentPath = parentPath.slice(0, -1);

    setItems((previous) => {
      const removed = removeItemByPath(previous, selectedPath);
      if (!removed.removed) {
        return previous;
      }

      return insertItemAtPath(removed.next, grandParentPath, parentIndex + 1, removed.removed);
    });
  };

  const deleteSelected = (): void => {
    if (!selectedPath || selectedPath.length === 0 || !selectedId) {
      return;
    }

    if (selectedId === HOME_MENU_ID) {
      return;
    }

    setItems((previous) => {
      const removed = removeItemByPath(previous, selectedPath);
      return removed.next;
    });

    if (editingEntryId === selectedId) {
      setEditingEntryId(null);
      setEditingEntryType(null);
    }
    setSelectedId(null);
  };

  const isHomeSelected = selectedId === HOME_MENU_ID;

  return (
    <div className="menu-editor-view">
      <div className="menu-editor-header">
        <div>
          <h2>{tr('menuEditor.title')}</h2>
          <p>{tr('menuEditor.description')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="menu-editor-loading">{tr('menuEditor.loading')}</div>
      ) : (
        <div className="menu-editor-main">
          <div className="menu-editor-tree-wrap" ref={treeWrapRef}>
            <div className="menu-editor-toolbar" role="toolbar" aria-label={tr('menuEditor.title')} ref={toolbarRef}>
              <ToolButton
                label={tr('menuEditor.addEntry')}
                onClick={() => void startCreateEntry()}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7 2h2v5h5v2H9v5H7V9H2V7h5V2z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.save')}
                onClick={() => void save()}
                disabled={isSaving}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h9l3 3v9H2V2zm2 1v3h6V3H4zm0 9h8V7H4v5z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.addCategoryArchive')}
                onClick={() => void startCreateCategoryArchive()}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <span aria-hidden="true">{tr('menuEditor.addCategoryArchiveShort')}</span>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.moveUp')}
                onClick={() => moveSelected('up')}
                disabled={!selectedPath || selectedPath[selectedPath.length - 1] === 0}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l4 4H9v6H7V7H4l4-4z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.moveDown')}
                onClick={() => moveSelected('down')}
                disabled={!selectedPath}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3h2v6h3l-4 4-4-4h3V3z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.indent')}
                onClick={indentSelected}
                disabled={!selectedPath || selectedPath[selectedPath.length - 1] === 0}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h8v2H2V4zm0 3h4v2H2V7zm0 3h8v2H2v-2zm6-1 3 2-3 2V9z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.unindent')}
                onClick={unindentSelected}
                disabled={!selectedPath || selectedPath.length < 2}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h8v2H2V4zm0 3h4v2H2V7zm0 3h8v2H2v-2zm3-1-3 2 3 2V9z" /></svg>
              </ToolButton>
              <ToolButton
                label={tr('menuEditor.delete')}
                onClick={deleteSelected}
                disabled={!selectedPath || isHomeSelected}
                onShowTooltip={setToolbarTooltip}
                onHideTooltip={() => setToolbarTooltip('')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4l1 1h3v2H2V3h3l1-1zm-1 4h2v6H5V6zm4 0h2v6H9V6z" /></svg>
              </ToolButton>
              <div className="menu-editor-toolbar-tooltip" role="tooltip" aria-live="polite">
                {toolbarTooltip || '\u00A0'}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="menu-editor-empty">{tr('menuEditor.empty')}</div>
            ) : (
              <Tree<MenuItemData>
                data={items}
                width="100%"
                height={treeHeight}
                rowHeight={32}
                indent={20}
                openByDefault
                disableEdit
                disableMultiSelection
                onMove={({ dragIds, parentId, index }) => {
                  setItems((previous) => applyTreeMove(previous, {
                    dragIds,
                    parentId,
                    index,
                  }));
                }}
                onSelect={(nodes) => {
                  setSelectedId(nodes[0]?.data.id || null);
                }}
              >
                {({ node, style, tree, dragHandle }) => (
                  <div
                    ref={dragHandle}
                    data-drag-handle="true"
                    style={style}
                    className={`menu-editor-row ${selectedId === node.data.id ? 'is-selected' : ''} ${recentParentInsertId === node.data.id ? 'is-parent-target' : ''}`}
                    onClick={() => setSelectedId(node.data.id)}
                    onMouseEnter={() => {
                      if (!tree.dragNode || !node.isInternal || node.isOpen) {
                        autoExpandController.cancel(node.id);
                        return;
                      }

                      autoExpandController.schedule(node.id, () => {
                        node.open();
                      });
                    }}
                    onMouseLeave={() => {
                      autoExpandController.cancel(node.id);
                    }}
                  >
                    <>
                      <span className="menu-editor-row-kind">
                        <span
                          className="menu-editor-row-kind-icon"
                          data-kind={node.data.kind}
                          aria-label={
                            node.data.kind === 'home'
                              ? tr('menuEditor.type.home')
                              : node.data.kind === 'page'
                                ? tr('menuEditor.type.page')
                                : node.data.kind === 'category-archive'
                                  ? tr('menuEditor.type.categoryArchive')
                                  : tr('menuEditor.type.submenu')
                          }
                          title={
                            node.data.kind === 'home'
                              ? tr('menuEditor.type.home')
                              : node.data.kind === 'page'
                                ? tr('menuEditor.type.page')
                                : node.data.kind === 'category-archive'
                                  ? tr('menuEditor.type.categoryArchive')
                                  : tr('menuEditor.type.submenu')
                          }
                        >
                          {renderMenuKindIcon(node.data.kind)}
                        </span>
                      </span>
                      <span className={`menu-editor-row-title ${editingEntryId === node.data.id ? 'is-editing' : ''}`}>
                        {editingEntryId === node.data.id ? (
                          editingEntryType === 'category' ? (
                            <CategoryInput
                              categories={categories}
                              onSelectCategory={setDraftAsCategoryArchive}
                              createCategoryArchiveLabel={tr('menuEditor.addCategoryArchive')}
                              placeholder={tr('menuEditor.newCategoryPlaceholder')}
                              disabled={isLoadingCategories}
                              autoFocus
                              inlinePlain
                            />
                          ) : (
                            <PageInput
                              pages={pagePosts}
                              onSelectPage={setDraftAsPage}
                              onCreateSubmenu={setDraftAsSubmenu}
                              createSubmenuLabel={tr('menuEditor.addSubmenu')}
                              placeholder={tr('menuEditor.newEntryPlaceholder')}
                              disabled={isLoadingPages}
                              autoFocus
                              inlinePlain
                            />
                          )
                        ) : node.data.title}
                      </span>
                    </>
                  </div>
                )}
              </Tree>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
