import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../TagInput/TagInput.css';
import './CategoryInput.css';

export interface CategoryOption {
  name: string;
  title: string;
}

interface CategoryInputProps {
  categories: CategoryOption[];
  onSelectCategory: (category: CategoryOption) => void;
  placeholder?: string;
  createCategoryArchiveLabel: string;
  allowCreate?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inlinePlain?: boolean;
}

export const CategoryInput: React.FC<CategoryInputProps> = ({
  categories,
  onSelectCategory,
  placeholder = '',
  createCategoryArchiveLabel,
  allowCreate = true,
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
      .filter((category) => category.title.toLowerCase().includes(query) || category.name.toLowerCase().includes(query))
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

  const selectCategory = (category: CategoryOption): void => {
    onSelectCategory(category);
    setInputValue('');
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const createArchiveFromInput = (label: string): void => {
    const trimmedName = label.trim();
    if (!trimmedName) {
      return;
    }

    onSelectCategory({
      name: trimmedName,
      title: trimmedName,
    });
    setInputValue('');
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const exactMatchExists = inputValue.trim()
    ? suggestions.some((item) => item.title.toLowerCase() === inputValue.trim().toLowerCase() || item.name.toLowerCase() === inputValue.trim().toLowerCase())
    : false;

  const showCreateOption = allowCreate && Boolean(inputValue.trim()) && !exactMatchExists;

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
        selectCategory(suggestions[selectedIndex]);
      } else if (selectedIndex === suggestions.length && showCreateOption) {
        createArchiveFromInput(inputValue);
      } else {
        const exactMatch = categories.find((category) => {
          const query = inputValue.trim().toLowerCase();
          return category.name.toLowerCase() === query || category.title.toLowerCase() === query;
        });
        if (exactMatch) {
          selectCategory(exactMatch);
        } else if (allowCreate && inputValue.trim()) {
          createArchiveFromInput(inputValue);
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
          {suggestions.map((category, index) => (
            <button
              key={category.name}
              type="button"
              className={`tag-suggestion ${selectedIndex === index ? 'selected' : ''}`}
              onClick={() => selectCategory(category)}
            >
              <span className="tag-suggestion-name">{category.title}</span>
            </button>
          ))}

          {showCreateOption && (
            <button
              type="button"
              className={`tag-suggestion create-new ${selectedIndex === suggestions.length ? 'selected' : ''}`}
              onClick={() => createArchiveFromInput(inputValue)}
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
