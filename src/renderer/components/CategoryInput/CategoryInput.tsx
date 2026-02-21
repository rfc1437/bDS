import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../TagInput/TagInput.css';
import './CategoryInput.css';

interface CategoryInputProps {
  categories: string[];
  onSelectCategory: (categoryName: string) => void;
  placeholder?: string;
  createCategoryArchiveLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inlinePlain?: boolean;
}

export const CategoryInput: React.FC<CategoryInputProps> = ({
  categories,
  onSelectCategory,
  placeholder = '',
  createCategoryArchiveLabel,
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
    return categories
      .filter((categoryName) => categoryName.toLowerCase().includes(query))
      .slice(0, 8);
  }, [categories, inputValue]);

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

  const createArchive = (label: string): void => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }

    onSelectCategory(trimmed);
    setInputValue('');
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const exactMatchExists = inputValue.trim()
    ? suggestions.some((item) => item.toLowerCase() === inputValue.trim().toLowerCase())
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
        createArchive(suggestions[selectedIndex]);
      } else if (selectedIndex === suggestions.length && showCreateOption) {
        createArchive(inputValue);
      } else {
        const exactMatch = categories.find((categoryName) => categoryName.toLowerCase() === inputValue.trim().toLowerCase());
        if (exactMatch) {
          createArchive(exactMatch);
        } else if (inputValue.trim()) {
          createArchive(inputValue);
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
      <div className={`tag-input-wrapper ${inlinePlain ? 'category-input-wrapper-inline' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          className={`tag-input-field ${inlinePlain ? 'category-input-field-inline' : ''}`}
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
          {suggestions.map((categoryName, index) => (
            <button
              key={categoryName}
              type="button"
              className={`tag-suggestion ${selectedIndex === index ? 'selected' : ''}`}
              onClick={() => createArchive(categoryName)}
            >
              <span className="tag-suggestion-name">{categoryName}</span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              className={`tag-suggestion create-new ${selectedIndex === suggestions.length ? 'selected' : ''}`}
              onClick={() => createArchive(inputValue)}
            >
              <span className="tag-suggestion-icon">+</span>
              <span>{createCategoryArchiveLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
