import React, { useEffect, useRef } from 'react';
import Markdown from 'marked-react';
import hljs from '@highlightjs/cdn-assets/es/highlight.min.js';
import type { ReactNode } from 'react';
import defaultDocumentationContent from '../../../../DOCUMENTATION.md?raw';
import { useAppStore } from '../../store';
import { useI18n } from '../../i18n';
import { ensureRendererPicoThemeStylesheet, getRendererPicoTheme } from '../../utils/picoTheme';
import './DocumentationView.css';

const HEADING_LEVELS = new Set([1, 2, 3, 4, 5, 6]);

function extractText(content: ReactNode): string {
  if (typeof content === 'string' || typeof content === 'number') {
    return String(content);
  }

  if (Array.isArray(content)) {
    return content.map(extractText).join('');
  }

  if (React.isValidElement(content)) {
    return extractText((content.props as { children?: ReactNode }).children);
  }

  return '';
}

function slugifyHeading(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  return canScroll && element.scrollHeight > element.clientHeight;
}

function resolveScrollContainer(target: HTMLElement, preferred: HTMLElement | null): HTMLElement | null {
  if (preferred && preferred.contains(target)) {
    return preferred;
  }

  let current: HTMLElement | null = target.parentElement;
  while (current) {
    if (isScrollable(current)) {
      return current;
    }
    current = current.parentElement;
  }

  if (preferred) {
    return preferred;
  }

  const scrollingElement = document.scrollingElement;
  return scrollingElement instanceof HTMLElement ? scrollingElement : null;
}

function resolveTargetHeadingInArticle(articleElement: HTMLElement, targetId: string): HTMLElement | null {
  for (const candidate of articleElement.querySelectorAll<HTMLElement>('[id]')) {
    if (candidate.id === targetId) {
      return candidate;
    }
  }

  const headingCandidates = articleElement.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  for (const heading of headingCandidates) {
    const headingSlug = slugifyHeading(heading.textContent ?? '');
    if (headingSlug === targetId) {
      heading.id = targetId;
      return heading;
    }
  }

  return null;
}

interface DocumentationViewProps {
  content?: string;
  titleKey?: string;
  subtitleKey?: string;
}

export const DocumentationView: React.FC<DocumentationViewProps> = ({
  content = defaultDocumentationContent,
  titleKey = 'docs.title',
  subtitleKey = 'docs.subtitle',
}) => {
  const { t: tr } = useI18n();
  const { picoTheme } = useAppStore();
  const resolvedTheme = getRendererPicoTheme(picoTheme);
  const CODE_COPY_DEFAULT_ICON = '\u29c9';
  const CODE_COPY_SUCCESS_ICON = '\u2713';
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const headingSlugCounts = new Map<string, number>();
  let rendererKeyIndex = 0;

  const jumpToDocumentationHash = (href: string): boolean => {
    if (!href.startsWith('#') || href.length < 2) {
      return false;
    }

    const targetId = decodeURIComponent(href.slice(1));
    const articleElement = articleRef.current;
    const preferredScrollContainer = scrollContainerRef.current;

    if (!articleElement) {
      return false;
    }

    const targetHeading = resolveTargetHeadingInArticle(articleElement, targetId);

    if (!targetHeading) {
      return false;
    }

    const scrollContainer = resolveScrollContainer(targetHeading, preferredScrollContainer);
    if (!scrollContainer) {
      return false;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const headingRect = targetHeading.getBoundingClientRect();
    const targetTop = Math.max(0, scrollContainer.scrollTop + (headingRect.top - containerRect.top) - 12);

    scrollContainer.scrollTop = 0;
    scrollContainer.scrollTop = targetTop;
    window.location.hash = href;

    return true;
  };

  const getRendererKey = (prefix: string): string => {
    rendererKeyIndex += 1;
    return `${prefix}-${rendererKeyIndex}`;
  };

  const markdownRenderer = {
    heading(children: ReactNode, level: number) {
      const levelNumber = HEADING_LEVELS.has(level as 1 | 2 | 3 | 4 | 5 | 6) ? level : 2;
      const headingText = extractText(children);
      const baseId = slugifyHeading(headingText);
      const existingCount = headingSlugCounts.get(baseId) ?? 0;
      const nextCount = existingCount + 1;
      headingSlugCounts.set(baseId, nextCount);
      const headingId = existingCount === 0 ? baseId : `${baseId}-${nextCount}`;

      return React.createElement(`h${levelNumber}` as keyof JSX.IntrinsicElements, { id: headingId, key: getRendererKey('heading') }, children);
    },
    link(href: string, text: ReactNode) {
      if (!href.startsWith('#')) {
        return <a href={href} key={getRendererKey('link')}>{text}</a>;
      }

      return (
        <a
          href={href}
          key={getRendererKey('hash-link')}
          onClick={(event) => {
            if (jumpToDocumentationHash(href)) {
              event.preventDefault();
            }
          }}
        >
          {text}
        </a>
      );
    },
    code(code: ReactNode, lang: string | undefined) {
      const normalizedLanguage = typeof lang === 'string' ? lang.trim().toLowerCase() : '';
      const sourceCode = extractText(code);
      const codeBlockKey = getRendererKey('code-block');

      let highlightedHtml = '';
      let languageClass = '';

      if (normalizedLanguage.length > 0 && hljs.getLanguage(normalizedLanguage)) {
        highlightedHtml = hljs.highlight(sourceCode, { language: normalizedLanguage }).value;
        languageClass = `language-${normalizedLanguage}`;
      } else {
        const autoDetected = hljs.highlightAuto(sourceCode);
        highlightedHtml = autoDetected.value;
        languageClass = autoDetected.language ? `language-${autoDetected.language}` : 'language-plaintext';
      }

      return (
        <div className="documentation-code-block" key={codeBlockKey}>
          <button
            type="button"
            className="code-copy-button documentation-code-copy-button"
            aria-label={tr('docs.copyCode')}
            title={tr('docs.copyCode')}
            onClick={(event) => {
              const button = event.currentTarget;
              const wrapper = button.closest('.documentation-code-block');
              const icon = button.querySelector('.code-copy-icon');

              const copyToClipboard = async () => {
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                  await navigator.clipboard.writeText(sourceCode);
                  return;
                }

                const textArea = document.createElement('textarea');
                textArea.value = sourceCode;
                textArea.setAttribute('readonly', '');
                textArea.style.position = 'absolute';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
              };

              copyToClipboard()
                .then(() => {
                  wrapper?.classList.remove('code-copy-failed');
                  wrapper?.classList.remove('code-copy-success');
                  wrapper?.classList.add('code-copy-success');

                  if (icon) {
                    icon.textContent = CODE_COPY_SUCCESS_ICON;
                    setTimeout(() => {
                      icon.textContent = CODE_COPY_DEFAULT_ICON;
                      wrapper?.classList.remove('code-copy-success');
                    }, 1200);
                  }
                })
                .catch((error) => {
                  wrapper?.classList.remove('code-copy-success');
                  wrapper?.classList.add('code-copy-failed');
                  setTimeout(() => {
                    wrapper?.classList.remove('code-copy-failed');
                  }, 1200);
                  console.error('Failed to copy documentation code block:', error);
                });
            }}
          >
            <span className="code-copy-icon">{CODE_COPY_DEFAULT_ICON}</span>
          </button>
          <pre>
            <code
              className={`hljs ${languageClass}`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        </div>
      );
    },
  };

  useEffect(() => {
    ensureRendererPicoThemeStylesheet(resolvedTheme).catch((error) => {
      console.error('Failed to load documentation theme stylesheet:', error);
    });
  }, [resolvedTheme]);

  return (
    <div className="documentation-view">
      <div className="documentation-header">
        <h1>{tr(titleKey)}</h1>
        <p>{tr(subtitleKey)}</p>
      </div>
      <main
        className="documentation-scroll"
        ref={scrollContainerRef}
      >
        <div className="documentation-content markdown-body pico" data-theme="auto" data-pico-theme={resolvedTheme}>
          <article className="documentation-article" ref={articleRef}>
            <Markdown renderer={markdownRenderer}>{content}</Markdown>
          </article>
        </div>
      </main>
    </div>
  );
};
