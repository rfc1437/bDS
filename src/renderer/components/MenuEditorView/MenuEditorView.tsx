import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import { useI18n } from '../../i18n';
import { showToast } from '../Toast';
import type { MenuDocument, MenuItemData, MenuItemKind, PostData } from '../../../main/shared/electronApi';
import { createAutoExpandController } from './menuAutoExpand';
import {
  createMenuPageItemFromPost,
  filterPagePosts,
  getNextPickerIndex,
  isPickerCloseKey,
  isPickerFocusShortcut,
} from './menuPagePicker';
import { applyTreeMove } from './menuTreeMove';
import './MenuEditorView.css';

function createMenuItem(kind: MenuItemKind, title: string): MenuItemData {
  return {
    id: `menu-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    kind,
    pageId: undefined,
    pageSlug: undefined,
    children: [],
  };
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

export const MenuEditorView: React.FC = () => {
  const { t: tr } = useI18n();
  const [items, setItems] = useState<MenuItemData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [pagePickerParentId, setPagePickerParentId] = useState<string | null>(null);
  const [pagePickerLoading, setPagePickerLoading] = useState(false);
  const [pagePickerQuery, setPagePickerQuery] = useState('');
  const [pagePickerPosts, setPagePickerPosts] = useState<PostData[]>([]);
  const [pagePickerActiveIndex, setPagePickerActiveIndex] = useState(-1);
  const pagePickerInputRef = useRef<HTMLInputElement | null>(null);
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
    };
  }, [autoExpandController]);

  const selectedPath = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return findPathById(items, selectedId);
  }, [items, selectedId]);

  const selectedItem = useMemo(() => {
    if (!selectedPath || selectedPath.length === 0) {
      return null;
    }

    let currentItems = items;
    let current: MenuItemData | null = null;
    for (const segment of selectedPath) {
      current = currentItems[segment] || null;
      if (!current) {
        return null;
      }
      currentItems = current.children;
    }

    return current;
  }, [items, selectedPath]);

  const filteredPagePosts = useMemo(() => {
    return filterPagePosts(pagePickerPosts, pagePickerQuery);
  }, [pagePickerPosts, pagePickerQuery]);

  const replaceSelected = (updater: (item: MenuItemData) => MenuItemData): void => {
    if (!selectedId) {
      return;
    }

    setItems((previous) => mapItems(previous, (item) => (item.id === selectedId ? updater(item) : item)));
  };

  const insertItem = (previous: MenuItemData[], node: MenuItemData, parentId: string | null): MenuItemData[] => {
    if (!parentId) {
      return [...previous, node];
    }

    return mapItems(previous, (item) => {
      if (item.id !== parentId) {
        return item;
      }

      return {
        ...item,
        children: [...item.children, node],
      };
    });
  };

  const closePagePicker = (): void => {
    setShowPagePicker(false);
    setPagePickerParentId(null);
    setPagePickerQuery('');
    setPagePickerActiveIndex(-1);
  };

  const openPagePicker = async (parentId: string | null): Promise<void> => {
    setShowPagePicker(true);
    setPagePickerParentId(parentId);
    setPagePickerQuery('');
    setPagePickerActiveIndex(-1);
    setPagePickerLoading(true);
    try {
      const posts = await window.electronAPI.posts.filter({ categories: ['page'] });
      setPagePickerPosts(posts);
    } catch (error) {
      console.error('Failed to load page posts:', error);
      showToast.error(tr('menuEditor.pagePicker.loadError'));
      setPagePickerPosts([]);
    } finally {
      setPagePickerLoading(false);
    }
  };

  const selectPageForMenu = (post: PostData): void => {
    const node = createMenuPageItemFromPost(post);
    setItems((previous) => insertItem(previous, node, pagePickerParentId));
    setSelectedId(node.id);
    closePagePicker();
  };

  useEffect(() => {
    if (!showPagePicker) {
      return;
    }

    if (filteredPagePosts.length === 0) {
      setPagePickerActiveIndex(-1);
      return;
    }

    setPagePickerActiveIndex((previous) => {
      if (previous < 0) {
        return 0;
      }
      return Math.min(previous, filteredPagePosts.length - 1);
    });
  }, [filteredPagePosts, showPagePicker]);

  useEffect(() => {
    if (!showPagePicker) {
      return;
    }

    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (isPickerFocusShortcut({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey })) {
        event.preventDefault();
        pagePickerInputRef.current?.focus();
        pagePickerInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [showPagePicker]);

  const addRootItem = (kind: MenuItemKind): void => {
    if (kind === 'page') {
      void openPagePicker(null);
      return;
    }

    const title = kind === 'page' ? tr('menuEditor.newPage') : tr('menuEditor.newSubmenu');
    const node = createMenuItem(kind, title);
    setItems((previous) => [...previous, node]);
    setSelectedId(node.id);
  };

  const addChildItem = (kind: MenuItemKind): void => {
    if (!selectedId) {
      addRootItem(kind);
      return;
    }

    if (kind === 'page') {
      void openPagePicker(selectedId);
      return;
    }

    const title = kind === 'page' ? tr('menuEditor.newPage') : tr('menuEditor.newSubmenu');
    const node = createMenuItem(kind, title);

    setItems((previous) => mapItems(previous, (item) => {
      if (item.id !== selectedId) {
        return item;
      }

      return {
        ...item,
        children: [...item.children, node],
      };
    }));
    setSelectedId(node.id);
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

    setItems((previous) => {
      const removed = removeItemByPath(previous, selectedPath);
      return removed.next;
    });
    setSelectedId(null);
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
          <div className="menu-editor-tree-wrap">
            <div className="menu-editor-toolbar" role="toolbar" aria-label={tr('menuEditor.title')}>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.addPage')} aria-label={tr('menuEditor.addPage')} onClick={() => addRootItem('page')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h6l4 4v8H3V2zm6 1.5V6h2.5L9 3.5zM7 8V6h2v2h2v2H9v2H7v-2H5V8h2z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.addSubmenu')} aria-label={tr('menuEditor.addSubmenu')} onClick={() => addRootItem('submenu')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h8v2H2V3zm0 4h8v2H2V7zm0 4h8v2H2v-2zm9-8h3v3h-1V4h-2V3zm2 4h1v6h-6v-1h5V7z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.addChildPage')} aria-label={tr('menuEditor.addChildPage')} onClick={() => addChildItem('page')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h5v2H4v6h3v2H2V3zm6 5V6h2v2h2v2h-2v2H8v-2H6V8h2z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.addChildSubmenu')} aria-label={tr('menuEditor.addChildSubmenu')} onClick={() => addChildItem('submenu')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h5v2H4v6h3v2H2V3zm5 2h7v2H7V5zm3 3h4v2h-4V8zm0 3h4v2h-4v-2z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.moveUp')} aria-label={tr('menuEditor.moveUp')} onClick={() => moveSelected('up')} disabled={!selectedPath}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l4 4H9v6H7V7H4l4-4z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.moveDown')} aria-label={tr('menuEditor.moveDown')} onClick={() => moveSelected('down')} disabled={!selectedPath}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3h2v6h3l-4 4-4-4h3V3z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.indent')} aria-label={tr('menuEditor.indent')} onClick={indentSelected} disabled={!selectedPath || selectedPath[selectedPath.length - 1] === 0}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h8v2H2V4zm0 3h4v2H2V7zm0 3h8v2H2v-2zm6-1 3 2-3 2V9z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.unindent')} aria-label={tr('menuEditor.unindent')} onClick={unindentSelected} disabled={!selectedPath || selectedPath.length < 2}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h8v2H2V4zm0 3h4v2H2V7zm0 3h8v2H2v-2zm3-1-3 2 3 2V9z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.delete')} aria-label={tr('menuEditor.delete')} onClick={deleteSelected} disabled={!selectedPath}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4l1 1h3v2H2V3h3l1-1zm-1 4h2v6H5V6zm4 0h2v6H9V6z" /></svg>
              </button>
              <button type="button" className="menu-editor-tool" title={tr('menuEditor.save')} aria-label={tr('menuEditor.save')} onClick={() => void save()} disabled={isSaving}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h9l3 3v9H2V2zm2 1v3h6V3H4zm0 9h8V7H4v5z" /></svg>
              </button>
            </div>

            {items.length === 0 ? (
              <div className="menu-editor-empty">{tr('menuEditor.empty')}</div>
            ) : (
              <Tree<MenuItemData>
                data={items}
                width={720}
                height={420}
                rowHeight={30}
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
                {({ node, style, tree }) => (
                  <div
                    style={style}
                    className={`menu-editor-row ${selectedId === node.data.id ? 'is-selected' : ''}`}
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
                    <span className="menu-editor-row-kind">
                      {node.data.kind === 'page' ? tr('menuEditor.type.page') : tr('menuEditor.type.submenu')}
                    </span>
                    <span className="menu-editor-row-title">{node.data.title}</span>
                  </div>
                )}
              </Tree>
            )}
          </div>

          <div className="menu-editor-details">
            <h3>{tr('menuEditor.details')}</h3>
            {!selectedItem ? (
              <p>{tr('menuEditor.selectItem')}</p>
            ) : (
              <>
                <label>
                  <span>{tr('menuEditor.field.title')}</span>
                  <input
                    type="text"
                    value={selectedItem.title}
                    onChange={(event) => {
                      const value = event.target.value;
                      replaceSelected((item) => ({ ...item, title: value }));
                    }}
                  />
                </label>

                <label>
                  <span>{tr('menuEditor.field.type')}</span>
                  <select
                    value={selectedItem.kind}
                    onChange={(event) => {
                      const value = event.target.value as MenuItemKind;
                      replaceSelected((item) => ({ ...item, kind: value }));
                    }}
                  >
                    <option value="page">{tr('menuEditor.type.page')}</option>
                    <option value="submenu">{tr('menuEditor.type.submenu')}</option>
                  </select>
                </label>

                {selectedItem.kind === 'page' && (
                  <>
                    <label>
                      <span>{tr('menuEditor.field.pageSlug')}</span>
                      <input
                        type="text"
                        value={selectedItem.pageSlug || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          replaceSelected((item) => ({ ...item, pageSlug: value || undefined }));
                        }}
                      />
                    </label>

                    <label>
                      <span>{tr('menuEditor.field.pageId')}</span>
                      <input
                        type="text"
                        value={selectedItem.pageId || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          replaceSelected((item) => ({ ...item, pageId: value || undefined }));
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showPagePicker && (
        <div className="menu-editor-picker-backdrop" onClick={closePagePicker}>
          <div className="menu-editor-picker" onClick={(event) => event.stopPropagation()}>
            <div className="menu-editor-picker-header">
              <h3>{tr('menuEditor.pagePicker.title')}</h3>
              <button type="button" onClick={closePagePicker}>{tr('common.cancel')}</button>
            </div>

            <input
              ref={pagePickerInputRef}
              type="text"
              value={pagePickerQuery}
              onChange={(event) => setPagePickerQuery(event.target.value)}
              onKeyDown={(event) => {
                if (isPickerCloseKey(event.key)) {
                  event.preventDefault();
                  closePagePicker();
                  return;
                }

                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setPagePickerActiveIndex((previous) => getNextPickerIndex(previous, event.key, filteredPagePosts.length));
                  return;
                }

                if (event.key === 'Enter' && pagePickerActiveIndex >= 0 && pagePickerActiveIndex < filteredPagePosts.length) {
                  event.preventDefault();
                  selectPageForMenu(filteredPagePosts[pagePickerActiveIndex]);
                }
              }}
              placeholder={tr('menuEditor.pagePicker.searchPlaceholder')}
              autoFocus
            />

            {pagePickerLoading ? (
              <div className="menu-editor-picker-state">{tr('menuEditor.pagePicker.loading')}</div>
            ) : filteredPagePosts.length === 0 ? (
              <div className="menu-editor-picker-state">{tr('menuEditor.pagePicker.empty')}</div>
            ) : (
              <div className="menu-editor-picker-list">
                {filteredPagePosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className={`menu-editor-picker-item ${filteredPagePosts[pagePickerActiveIndex]?.id === post.id ? 'is-active' : ''}`}
                    onClick={() => selectPageForMenu(post)}
                    onMouseEnter={() => {
                      const nextIndex = filteredPagePosts.findIndex((candidate) => candidate.id === post.id);
                      setPagePickerActiveIndex(nextIndex);
                    }}
                  >
                    <span>{post.title}</span>
                    <small>/{post.slug}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
