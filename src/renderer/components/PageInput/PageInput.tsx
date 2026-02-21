import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PostData } from '../../../main/shared/electronApi';
import '../TagInput/TagInput.css';
import './PageInput.css';

interface PageInputProps {
  pages: PostData[];
  onSelectPage: (page: PostData) => void;
  onCreateSubmenu: (label: string) => void;
  placeholder?: string;
  createSubmenuLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inlinePlain?: boolean;
}

export const PageInput: React.FC<PageInputProps> = ({
  pages,
  onSelectPage,
  onCreateSubmenu,
  placeholder = '',
  createSubmenuLabel,
  disabled = false,
  autoFocus = false,
  inlinePlain = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!inputValue.trim()) {
      return [];
    }

    const query = inputValue.toLowerCase().trim();
    return pages
      .filter((page) => page.title.toLowerCase().includes(query) || page.slug.toLowerCase().includes(query))
      .slice(0, 8);
  }, [inputValue, pages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => clearTimeout(timer);
  }, [autoFocus, disabled]);

  const selectPage = (page: PostData): void => {
    onSelectPage(page);
    setInputValue('');
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const createSubmenu = (label: string): void => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }

    onCreateSubmenu(trimmed);
    setInputValue('');
    setShowSuggestions(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const exactMatchExists = inputValue.trim()
    ? suggestions.some((item) => item.title.toLowerCase() === inputValue.trim().toLowerCase())
    : false;

  const showCreateOption = inputValue.trim() && !exactMatchExists;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const maxIndex = suggestions.length + (showCreateOption ? 0 : -1);
      setSelectedIndex((previous) => Math.min(previous + 1, maxIndex));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((previous) => Math.max(previous - 1, -1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        selectPage(suggestions[selectedIndex]);
      } else if (selectedIndex === suggestions.length && showCreateOption) {
        createSubmenu(inputValue);
      } else {
        const exactMatch = pages.find((page) => page.title.toLowerCase() === inputValue.trim().toLowerCase());
        if (exactMatch) {
          selectPage(exactMatch);
        } else if (inputValue.trim()) {
          createSubmenu(inputValue);
        }
      }
      return;
    }

    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setInputValue('');
    }
  };

  return (
    <div className="tag-input-container" ref={containerRef}>
      <div className={`tag-input-wrapper ${inlinePlain ? 'page-input-wrapper-inline' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          className={`tag-input-field ${inlinePlain ? 'page-input-field-inline' : ''}`}
          value={inputValue}
          autoFocus={autoFocus}
          onChange={(event) => {
            setInputValue(event.target.value);
            setShowSuggestions(true);
          }}
          onInput={(event) => {
            setInputValue((event.target as HTMLInputElement).value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {showSuggestions && (suggestions.length > 0 || showCreateOption) && (
        <div className="tag-suggestions">
          {suggestions.map((page, index) => (
            <button
              key={page.id}
              type="button"
              className={`tag-suggestion ${selectedIndex === index ? 'selected' : ''}`}
              onClick={() => selectPage(page)}
            >
              <span className="tag-suggestion-name">{page.title}</span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              className={`tag-suggestion create-new ${selectedIndex === suggestions.length ? 'selected' : ''}`}
              onClick={() => createSubmenu(inputValue)}
            >
              <span className="tag-suggestion-icon">+</span>
              <span>{createSubmenuLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
