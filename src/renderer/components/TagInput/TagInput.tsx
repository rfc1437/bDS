import React, { useState, useEffect, useRef, useCallback } from 'react';
import { showToast } from '../Toast';
import { getContrastColor } from '../../utils/color';
import { subscribeToTagEvents } from '../../utils/tagEventSubscriptions';
import { useI18n } from '../../i18n';
import './TagInput.css';

interface TagData {
  id: string;
  name: string;
  color?: string;
}

interface TagInputProps {
  /** Current tags assigned to the item */
  value: string[];
  /** Callback when tags change */
  onChange: (tags: string[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Input mode (tags or categories) */
  mode?: 'tag' | 'category';
  /** Post ID for AI-based tag suggestions (semantic similarity) */
  postId?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  placeholder = 'Add tags...',
  disabled = false,
  mode = 'tag',
  postId,
}) => {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TagData[]>([]);
  const [allTags, setAllTags] = useState<TagData[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isCreating, setIsCreating] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load all available tags
  const loadTags = useCallback(async () => {
    try {
      if (mode === 'category') {
        const categories = await window.electronAPI?.meta.getCategories();
        if (categories) {
          setAllTags(categories.map((name) => ({ id: name, name })));
        }
      } else {
        const tags = await window.electronAPI?.tags.getAll();
        if (tags) {
          setAllTags(tags as TagData[]);
        }
      }
    } catch (error) {
      console.error(`Failed to load ${mode}s:`, error);
    }
  }, [mode]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Listen for tag changes
  useEffect(() => {
    if (mode !== 'tag') {
      return;
    }
    return subscribeToTagEvents(window.electronAPI?.on, loadTags);
  }, [loadTags, mode]);

  // Filter suggestions based on input
  useEffect(() => {
    if (!inputValue.trim()) {
      setSuggestions([]);
      return;
    }

    const query = inputValue.toLowerCase().trim();
    const filtered = allTags
      .filter(tag => 
        tag.name.toLowerCase().includes(query) &&
        !value.includes(tag.name)
      )
      .slice(0, 8); // Limit to 8 suggestions

    setSuggestions(filtered);
    setSelectedIndex(-1);
  }, [inputValue, allTags, value]);

  // Load AI tag suggestions when focused on an empty input (mode=tag only)
  useEffect(() => {
    if (mode !== 'tag' || !postId || inputValue.trim()) {
      setAiSuggestedTags([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const suggestions = await window.electronAPI.embeddings.suggestTags(postId, value);
        if (!cancelled) {
          setAiSuggestedTags(suggestions.map(s => s.name));
        }
      } catch {
        if (!cancelled) setAiSuggestedTags([]);
      }
    })();
    return () => { cancelled = true; };
  }, [postId, mode, value, inputValue]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add a tag
  const addTag = useCallback((tagName: string) => {
    const normalized = tagName.trim().toLowerCase();
    if (!normalized) return;
    
    if (value.includes(normalized)) {
      showToast.info(t('tagInput.alreadyAdded'));
      return;
    }

    onChange([...value, normalized]);
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [value, onChange]);

  // Remove a tag
  const removeTag = useCallback((tagName: string) => {
    onChange(value.filter(t => t !== tagName));
  }, [value, onChange]);

  // Create a new tag and add it
  const createAndAddTag = useCallback(async (tagName: string) => {
    const normalized = tagName.trim().toLowerCase();
    if (!normalized) return;

    // Check if it already exists
    const exists = allTags.some(t => t.name === normalized);
    if (exists) {
      addTag(normalized);
      return;
    }

    setIsCreating(true);
    try {
      if (mode === 'category') {
        await window.electronAPI?.meta.addCategory(normalized);
      } else {
        await window.electronAPI?.tags.create({ name: normalized });
      }
      addTag(normalized);
      showToast.success(
        t(mode === 'category' ? 'tagInput.createdCategory' : 'tagInput.createdTag', { name: normalized })
      );
    } catch (error) {
      const err = error as Error;
      showToast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  }, [allTags, addTag, mode]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const maxIndex = suggestions.length + (inputValue.trim() && !suggestions.some(s => s.name === inputValue.trim().toLowerCase()) ? 0 : -1);
      setSelectedIndex(prev => Math.min(prev + 1, maxIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        addTag(suggestions[selectedIndex].name);
      } else if (selectedIndex === suggestions.length && inputValue.trim()) {
        // Create new tag option selected
        createAndAddTag(inputValue.trim());
      } else if (inputValue.trim()) {
        // No selection, but there's input - check if exact match exists
        const exactMatch = allTags.find(t => t.name === inputValue.trim().toLowerCase());
        if (exactMatch) {
          addTag(exactMatch.name);
        } else {
          createAndAddTag(inputValue.trim());
        }
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setInputValue('');
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag when backspace on empty input
      removeTag(value[value.length - 1]);
    } else if (e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        const exactMatch = allTags.find(t => t.name === inputValue.trim().toLowerCase());
        if (exactMatch) {
          addTag(exactMatch.name);
        } else {
          createAndAddTag(inputValue.trim());
        }
      }
    }
  };

  // Get tag data for display
  const getTagData = (tagName: string): TagData | undefined => {
    return allTags.find(t => t.name === tagName);
  };

  // Check if input matches an existing tag exactly
  const exactMatchExists = inputValue.trim() && 
    allTags.some(t => t.name === inputValue.trim().toLowerCase());
  
  // Should show "Create new tag" option
  const showCreateOption = inputValue.trim() && 
    !exactMatchExists && 
    !value.includes(inputValue.trim().toLowerCase());

  return (
    <div className="tag-input-container" ref={containerRef}>
      <div className="tag-input-wrapper">
        {/* Current tags */}
        {value.map(tagName => {
          const tagData = getTagData(tagName);
          const hasColor = !!tagData?.color;
          const style: React.CSSProperties = hasColor
            ? {
                backgroundColor: tagData!.color,
                color: getContrastColor(tagData!.color!),
                borderColor: tagData!.color,
              }
            : {};

          return (
            <span 
              key={tagName} 
              className={`tag-chip ${hasColor ? 'has-color' : ''}`}
              style={style}
            >
              {tagName}
              {!disabled && (
                <button
                  type="button"
                  className="tag-chip-remove"
                  onClick={() => removeTag(tagName)}
                  tabIndex={-1}
                  aria-label={t('tagInput.remove', { tag: tagName })}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          className="tag-input-field"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onInput={(e) => {
            setInputValue((e.target as HTMLInputElement).value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled || isCreating}
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && (suggestions.length > 0 || showCreateOption || aiSuggestedTags.length > 0) && (
        <div className="tag-suggestions">
          {/* AI-suggested tags shown when input is empty */}
          {!inputValue.trim() && aiSuggestedTags.length > 0 && (
            <>
              <div className="tag-suggestion-section-label">{t('tagInput.aiSuggestedLabel')}</div>
              {aiSuggestedTags.map((tagName) => (
                <button
                  key={`ai-${tagName}`}
                  type="button"
                  className="tag-suggestion ai-suggested"
                  onClick={() => addTag(tagName)}
                >
                  <span className="tag-suggestion-name">{tagName}</span>
                </button>
              ))}
              {suggestions.length > 0 && <div className="tag-suggestion-section-label">{t('tagInput.allTagsLabel')}</div>}
            </>
          )}
          {suggestions.map((tag, index) => {
            const hasColor = !!tag.color;
            const style: React.CSSProperties = hasColor
              ? {
                  '--tag-color': tag.color,
                  '--tag-text-color': getContrastColor(tag.color!),
                } as React.CSSProperties
              : {};

            return (
              <button
                key={tag.id}
                type="button"
                className={`tag-suggestion ${selectedIndex === index ? 'selected' : ''}`}
                style={style}
                onClick={() => addTag(tag.name)}
              >
                {hasColor && (
                  <span 
                    className="tag-suggestion-color" 
                    style={{ backgroundColor: tag.color }}
                  />
                )}
                <span className="tag-suggestion-name">{tag.name}</span>
              </button>
            );
          })}
          
          {showCreateOption && (
            <button
              type="button"
              className={`tag-suggestion create-new ${selectedIndex === suggestions.length ? 'selected' : ''}`}
              onClick={() => createAndAddTag(inputValue.trim())}
            >
              <span className="tag-suggestion-icon">+</span>
              <span>
                {t(mode === 'category' ? 'tagInput.createCategory' : 'tagInput.createTag', {
                  name: inputValue.trim(),
                })}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
