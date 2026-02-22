import { z } from 'zod';
import { normalizeNonEmptyTaxonomyTerm } from '../engine/taxonomyUtils';

const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F]/g;

const blogmarkPayloadSchema = z.object({
  title: z.string().max(MAX_TITLE_LENGTH),
  url: z.string().max(MAX_URL_LENGTH),
});

export interface BlogmarkPayload {
  title: string;
  url: string;
}

function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTERS_REGEX, '');
}

function sanitizeTitle(rawTitle: unknown): string {
  if (typeof rawTitle !== 'string') {
    return '';
  }

  const trimmed = stripControlCharacters(rawTitle).trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

function sanitizeHttpUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = stripControlCharacters(rawUrl).trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';

  const normalized = parsed.toString();
  if (normalized.length > MAX_URL_LENGTH) {
    return null;
  }

  return normalized;
}

function escapeMarkdownLinkText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

function getDeepLinkField(url: URL, fieldName: string): string | null {
  const value = url.searchParams.get(fieldName);
  return typeof value === 'string' ? value : null;
}

export function normalizeBlogmarkCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return normalizeNonEmptyTaxonomyTerm(value) ?? undefined;
}

export function extractBlogmarkPayloadFromDeepLink(rawDeepLink: string): BlogmarkPayload | null {
  let parsedDeepLink: URL;
  try {
    parsedDeepLink = new URL(rawDeepLink);
  } catch {
    return null;
  }

  if (parsedDeepLink.protocol !== 'bds:' || parsedDeepLink.hostname !== 'new-post') {
    return null;
  }

  const sanitizedUrl = sanitizeHttpUrl(getDeepLinkField(parsedDeepLink, 'url'));
  if (!sanitizedUrl) {
    return null;
  }

  const sanitizedTitle = sanitizeTitle(getDeepLinkField(parsedDeepLink, 'title')) || new URL(sanitizedUrl).hostname;

  const parsedPayload = blogmarkPayloadSchema.safeParse({
    title: sanitizedTitle,
    url: sanitizedUrl,
  });

  return parsedPayload.success ? parsedPayload.data : null;
}

export function buildBlogmarkMarkdownLink(title: string, url: string): string {
  const safeTitle = escapeMarkdownLinkText(title.trim());
  return `[${safeTitle}](<${url}>)`;
}

export function generateBlogmarkBookmarkletSource(): string {
  return "javascript:(()=>{const t=encodeURIComponent(document.title||'');const u=encodeURIComponent(location.href||'');location.href='bds://new-post?title='+t+'&url='+u;})();";
}
