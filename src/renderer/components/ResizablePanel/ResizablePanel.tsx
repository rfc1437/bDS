import React, { useState, useRef, useCallback, useEffect } from 'react';
import './ResizablePanel.css';

interface ResizablePanelProps {
  children: React.ReactNode;
  direction: 'horizontal' | 'vertical';
  initialSize: number;
  minSize?: number;
  maxSize?: number;
  storageKey?: string;
  className?: string;
  resizerPosition?: 'start' | 'end';
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  direction,
  initialSize,
  minSize = 150,
  maxSize = 600,
  storageKey,
  className = '',
  resizerPosition = 'end',
}) => {
  // Load saved size from localStorage
  const getSavedSize = () => {
    if (storageKey) {
      const saved = localStorage.getItem(`bds-panel-${storageKey}`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minSize && parsed <= maxSize) {
          return parsed;
        }
      }
    }
    return initialSize;
  };

  const [size, setSize] = useState(getSavedSize);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  // Save size to localStorage
  useEffect(() => {
    if (storageKey && !isResizing) {
      localStorage.setItem(`bds-panel-${storageKey}`, size.toString());
    }
  }, [size, storageKey, isResizing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = size;
  }, [direction, size]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    let delta = currentPos - startPosRef.current;

    // Reverse delta if resizer is at start
    if (resizerPosition === 'start') {
      delta = -delta;
    }

    const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + delta));
    setSize(newSize);
  }, [isResizing, direction, minSize, maxSize, resizerPosition]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp, direction]);

  const style: React.CSSProperties = direction === 'horizontal'
    ? { width: size }
    : { height: size };

  return (
    <div
      ref={panelRef}
      className={`resizable-panel ${direction} ${className} ${isResizing ? 'resizing' : ''}`}
      style={style}
    >
      {resizerPosition === 'start' && (
        <div
          className={`resizer ${direction}`}
          onMouseDown={handleMouseDown}
        />
      )}
      <div className="resizable-panel-content">
        {children}
      </div>
      {resizerPosition === 'end' && (
        <div
          className={`resizer ${direction}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
};

export default ResizablePanel;
