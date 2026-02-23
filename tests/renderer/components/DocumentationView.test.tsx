import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocumentationView } from '../../../src/renderer/components/DocumentationView/DocumentationView';
import { I18nProvider } from '../../../src/renderer/i18n';
import { useAppStore } from '../../../src/renderer/store';

const openSpy = vi.fn();

Object.defineProperty(window, 'open', {
  value: openSpy,
  writable: true,
});

describe('DocumentationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '',
      },
      writable: true,
    });
    useAppStore.setState({
      picoTheme: 'slate',
    } as never);

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  it('renders fenced code blocks with language-specific classes for syntax highlighting', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    await screen.findByText('bDS User Guide');
    const pythonBlock = container.querySelector('pre > code.language-python');
    expect(pythonBlock).not.toBeNull();
  });

  it('renders heading anchors and keeps in-document toc links in-page', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    const targetHeading = await screen.findByRole('heading', { level: 2, name: 'Who this guide is for' });
    expect(targetHeading).toHaveAttribute('id', 'who-this-guide-is-for');

    const tocLink = container.querySelector('a[href="#who-this-guide-is-for"]');
    expect(tocLink).not.toBeNull();

    const scrollContainer = container.querySelector('.documentation-scroll');
    expect(scrollContainer).not.toBeNull();

    Object.defineProperty(scrollContainer as HTMLElement, 'scrollTop', {
      value: 10,
      writable: true,
    });

    Object.defineProperty(scrollContainer as HTMLElement, 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 0, width: 800, height: 600, right: 800, bottom: 700, x: 0, y: 100, toJSON: () => ({}) }),
      writable: true,
    });

    Object.defineProperty(targetHeading, 'getBoundingClientRect', {
      value: () => ({ top: 340, left: 0, width: 100, height: 20, right: 100, bottom: 360, x: 0, y: 340, toJSON: () => ({}) }),
      writable: true,
    });

    fireEvent.click(tocLink as HTMLAnchorElement);

    expect((scrollContainer as HTMLElement).scrollTop).toBe(238);
    expect(window.location.hash).toBe('#who-this-guide-is-for');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps scroll position unchanged for unresolved in-document links', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    await screen.findByRole('heading', { level: 2, name: 'Who this guide is for' });
    const tocLink = container.querySelector('a[href="#does-not-exist"]');
    if (!tocLink) {
      const article = container.querySelector('.documentation-article') as HTMLElement;
      const missingAnchor = document.createElement('a');
      missingAnchor.setAttribute('href', '#does-not-exist');
      missingAnchor.textContent = 'Missing';
      article.appendChild(missingAnchor);
    }

    const unresolvedLink = container.querySelector('a[href="#does-not-exist"]');
    expect(unresolvedLink).not.toBeNull();

    const scrollContainer = container.querySelector('.documentation-scroll') as HTMLElement;
    expect(scrollContainer).not.toBeNull();

    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 222,
      writable: true,
    });

    expect(() => fireEvent.click(unresolvedLink as HTMLAnchorElement)).not.toThrow();
    expect(scrollContainer.scrollTop).toBe(222);
  });

  it('handles toc clicks when clicking nested content inside the anchor', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    const targetHeading = await screen.findByRole('heading', { level: 2, name: 'Who this guide is for' });
    const tocLink = container.querySelector('a[href="#who-this-guide-is-for"]') as HTMLAnchorElement;
    expect(tocLink).not.toBeNull();

    const nested = document.createElement('span');
    nested.textContent = 'Who this guide is for';
    tocLink.appendChild(nested);

    const scrollContainer = container.querySelector('.documentation-scroll') as HTMLElement;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 5,
      writable: true,
    });

    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 0, width: 800, height: 600, right: 800, bottom: 700, x: 0, y: 100, toJSON: () => ({}) }),
      writable: true,
    });

    Object.defineProperty(targetHeading, 'getBoundingClientRect', {
      value: () => ({ top: 300, left: 0, width: 100, height: 20, right: 100, bottom: 320, x: 0, y: 300, toJSON: () => ({}) }),
      writable: true,
    });

    fireEvent.click(nested);
    expect(scrollContainer.scrollTop).toBe(193);
  });

  it('resolves hash target within the clicked documentation instance', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
        <DocumentationView />
      </I18nProvider>
    );

    await screen.findAllByRole('heading', { level: 2, name: 'Using macros' });

    const wrappers = container.querySelectorAll('.documentation-view');
    expect(wrappers.length).toBe(2);

    const firstScroll = wrappers[0].querySelector('.documentation-scroll') as HTMLElement;
    const secondScroll = wrappers[1].querySelector('.documentation-scroll') as HTMLElement;
    const secondLink = wrappers[1].querySelector('a[href="#using-macros"]') as HTMLAnchorElement;
    const secondArticle = wrappers[1].querySelector('.documentation-article') as HTMLElement;
    const secondHeading = Array.from(secondArticle.querySelectorAll<HTMLElement>('[id]')).find((node) => node.id === 'using-macros') as HTMLElement;

    Object.defineProperty(firstScroll, 'scrollTop', { value: 7, writable: true });
    Object.defineProperty(secondScroll, 'scrollTop', { value: 11, writable: true });

    Object.defineProperty(secondScroll, 'getBoundingClientRect', {
      value: () => ({ top: 120, left: 0, width: 700, height: 500, right: 700, bottom: 620, x: 0, y: 120, toJSON: () => ({}) }),
      writable: true,
    });

    Object.defineProperty(secondHeading, 'getBoundingClientRect', {
      value: () => ({ top: 420, left: 0, width: 300, height: 30, right: 300, bottom: 450, x: 0, y: 420, toJSON: () => ({}) }),
      writable: true,
    });

    fireEvent.click(secondLink);

    expect(firstScroll.scrollTop).toBe(7);
    expect(secondScroll.scrollTop).toBe(299);
  });

  it('falls back to heading text slug when heading id does not match hash', async () => {
    const { container } = render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    const targetHeading = await screen.findByRole('heading', { level: 2, name: 'Using scripting (early access)' });
    targetHeading.id = 'unexpected-id';

    const tocLink = container.querySelector('a[href="#using-scripting-early-access"]') as HTMLAnchorElement;
    expect(tocLink).not.toBeNull();

    const scrollContainer = container.querySelector('.documentation-scroll') as HTMLElement;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: 50,
      writable: true,
    });

    Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 0, width: 800, height: 600, right: 800, bottom: 700, x: 0, y: 100, toJSON: () => ({}) }),
      writable: true,
    });

    Object.defineProperty(targetHeading, 'getBoundingClientRect', {
      value: () => ({ top: 450, left: 0, width: 200, height: 24, right: 200, bottom: 474, x: 0, y: 450, toJSON: () => ({}) }),
      writable: true,
    });

    fireEvent.click(tocLink);

    expect(scrollContainer.scrollTop).toBe(388);
    expect(targetHeading.id).toBe('using-scripting-early-access');
  });

  it('shows a copy button for fenced code blocks and copies the block content', async () => {
    render(
      <I18nProvider>
        <DocumentationView />
      </I18nProvider>
    );

    const copyButtons = await screen.findAllByRole('button', { name: /copy code/i });
    expect(copyButtons.length).toBeGreaterThan(0);

    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});
