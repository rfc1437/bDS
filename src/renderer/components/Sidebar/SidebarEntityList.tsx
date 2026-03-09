import React from 'react';

interface SidebarEntityListProps<TItem> {
  header: string;
  createTitle: string;
  onCreate: () => void;
  isLoading: boolean;
  loadingLabel: string;
  emptyMessage: string;
  emptyActionLabel: string;
  onEmptyAction: () => void;
  items: TItem[];
  renderItem: (item: TItem) => React.ReactNode;
  getItemKey?: (item: TItem) => string;
  topContent?: React.ReactNode;
}

export function SidebarEntityList<TItem>({
  header,
  createTitle,
  onCreate,
  isLoading,
  loadingLabel,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  items,
  renderItem,
  getItemKey,
  topContent,
}: SidebarEntityListProps<TItem>): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="chat-list">
        <div className="chat-list-header">
          <span>{header}</span>
        </div>
        <div className="chat-loading">{loadingLabel}</div>
      </div>
    );
  }

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <span>{header}</span>
        <button className="chat-new-button" onClick={onCreate} title={createTitle} aria-label={createTitle}>
          +
        </button>
      </div>
      {topContent}
      <div className="chat-list-items">
        {items.length === 0 ? (
          <div className="chat-empty">
            <p>{emptyMessage}</p>
            <button className="chat-start-button" onClick={onEmptyAction}>
              {emptyActionLabel}
            </button>
          </div>
        ) : (
          items.map((item) => (
            <React.Fragment key={getItemKey ? getItemKey(item) : String((item as { id?: string }).id)}>
              {renderItem(item)}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
