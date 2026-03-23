import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export type MenuItemKind = 'page' | 'submenu' | 'category-archive' | 'home';

const HOME_MENU_ID = 'menu-home';

const DEFAULT_HOME_ITEM: MenuItemData = {
  id: HOME_MENU_ID,
  title: 'Home',
  kind: 'home',
  pageId: undefined,
  pageSlug: 'home',
  categoryName: undefined,
  children: [],
};

export interface MenuItemData {
  id: string;
  title: string;
  kind: MenuItemKind;
  pageId?: string;
  pageSlug?: string;
  categoryName?: string;
  children: MenuItemData[];
}

export interface MenuDocument {
  items: MenuItemData[];
}

type OpmlOutlineNode = {
  '@_id'?: string;
  '@_text'?: string;
  '@_title'?: string;
  '@_type'?: string;
  '@_pageId'?: string;
  '@_pageSlug'?: string;
  '@_categoryName'?: string;
  outline?: OpmlOutlineNode | OpmlOutlineNode[];
};

function generateMenuItemId(): string {
  try {
    return randomUUID();
  } catch {
    return `menu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeOutlineNodes(value: unknown): OpmlOutlineNode[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value as OpmlOutlineNode[];
  }

  return [value as OpmlOutlineNode];
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeMenuItem(input: unknown): MenuItemData {
  const candidate = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const kind: MenuItemKind = candidate.kind === 'submenu'
    ? 'submenu'
    : candidate.kind === 'category-archive'
      ? 'category-archive'
      : candidate.kind === 'home'
        ? 'home'
        : 'page';
  const childrenSource = Array.isArray(candidate.children) ? candidate.children : [];
  const title = normalizeNonEmptyString(candidate.title) || 'Untitled';

  return {
    id: normalizeNonEmptyString(candidate.id) || generateMenuItemId(),
    title,
    kind,
    pageId: kind === 'page' ? normalizeNonEmptyString(candidate.pageId) : undefined,
    pageSlug: kind === 'page' || kind === 'home' ? normalizeNonEmptyString(candidate.pageSlug) : undefined,
    categoryName: kind === 'category-archive' ? normalizeNonEmptyString(candidate.categoryName) : undefined,
    children: childrenSource.map((child) => sanitizeMenuItem(child)),
  };
}

function normalizeHomeItem(item: MenuItemData): MenuItemData {
  return {
    ...item,
    id: HOME_MENU_ID,
    title: 'Home',
    kind: 'home',
    pageId: undefined,
    pageSlug: 'home',
    categoryName: undefined,
    children: [],
  };
}

function extractHomeItem(items: MenuItemData[]): { homeItem: MenuItemData | null; remainingItems: MenuItemData[] } {
  let extractedHome: MenuItemData | null = null;

  const isHomeCandidate = (node: MenuItemData): boolean => {
    if (node.id === HOME_MENU_ID) {
      return true;
    }

    return node.kind === 'page' && (node.pageSlug?.toLowerCase() === 'home' || node.title.trim().toLowerCase() === 'home');
  };

  const walk = (nodes: MenuItemData[]): MenuItemData[] => {
    const next: MenuItemData[] = [];

    for (const node of nodes) {
      if (isHomeCandidate(node)) {
        if (!extractedHome) {
          extractedHome = normalizeHomeItem(node);
        }
        continue;
      }

      next.push({
        ...node,
        children: walk(node.children),
      });
    }

    return next;
  };

  const remainingItems = walk(items);
  return {
    homeItem: extractedHome,
    remainingItems,
  };
}

function enforceHomeEntry(input: MenuDocument): MenuDocument {
  const { homeItem, remainingItems } = extractHomeItem(input.items);
  const ensuredHome = homeItem ? normalizeHomeItem(homeItem) : { ...DEFAULT_HOME_ITEM };
  return {
    items: [ensuredHome, ...remainingItems],
  };
}

function sanitizeMenuDocument(input: unknown): MenuDocument {
  const candidate = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const items = Array.isArray(candidate.items) ? candidate.items : [];
  return {
    items: items.map((item) => sanitizeMenuItem(item)),
  };
}

function parseOutlineNode(node: OpmlOutlineNode): MenuItemData {
  const rawType = normalizeNonEmptyString(node['@_type']);
  const kind: MenuItemKind = rawType === 'submenu'
    ? 'submenu'
    : rawType === 'category-archive'
      ? 'category-archive'
      : rawType === 'home'
        ? 'home'
        : 'page';
  const textTitle = normalizeNonEmptyString(node['@_text']);
  const explicitTitle = normalizeNonEmptyString(node['@_title']);
  const title = kind === 'category-archive'
    ? explicitTitle || textTitle || 'Untitled'
    : textTitle || explicitTitle || 'Untitled';

  return {
    id: normalizeNonEmptyString(node['@_id']) || generateMenuItemId(),
    title,
    kind,
    pageId: kind === 'page' ? normalizeNonEmptyString(node['@_pageId']) : undefined,
    pageSlug: kind === 'page' || kind === 'home' ? normalizeNonEmptyString(node['@_pageSlug']) : undefined,
    categoryName: kind === 'category-archive' ? normalizeNonEmptyString(node['@_categoryName']) : undefined,
    children: normalizeOutlineNodes(node.outline).map((child) => parseOutlineNode(child)),
  };
}

function toOpmlOutlineNode(item: MenuItemData): OpmlOutlineNode {
  const outlineNode: OpmlOutlineNode = {
    '@_id': item.id,
    '@_text': item.title,
    '@_type': item.kind,
  };

  if (item.kind === 'page' && item.pageId) {
    outlineNode['@_pageId'] = item.pageId;
  }

  if ((item.kind === 'page' || item.kind === 'home') && item.pageSlug) {
    outlineNode['@_pageSlug'] = item.pageSlug;
  }

  if (item.kind === 'category-archive' && item.categoryName) {
    outlineNode['@_categoryName'] = item.categoryName;
  }

  if (item.children.length > 0) {
    outlineNode.outline = item.children.map((child) => toOpmlOutlineNode(child));
  }

  return outlineNode;
}

export class MenuEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private dataDir: string | null = null;

  private getDefaultBaseDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId);
  }

  private getBaseDir(): string {
    return this.dataDir || this.getDefaultBaseDir();
  }

  getMetaDir(): string {
    return path.join(this.getBaseDir(), 'meta');
  }

  private getMenuFilePath(): string {
    return path.join(this.getMetaDir(), 'menu.opml');
  }

  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
  }

  async getMenu(): Promise<MenuDocument> {
    const menuPath = this.getMenuFilePath();

    let xmlContent: string;
    try {
      xmlContent = await fs.readFile(menuPath, 'utf-8');
    } catch (error) {
      const asErrno = error as NodeJS.ErrnoException;
      if (asErrno?.code === 'ENOENT') {
        return enforceHomeEntry({ items: [] });
      }
      throw error;
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
    });

    const parsed = parser.parse(xmlContent) as {
      opml?: {
        body?: {
          outline?: OpmlOutlineNode | OpmlOutlineNode[];
        };
      };
    };

    const outlineNodes = normalizeOutlineNodes(parsed?.opml?.body?.outline);
    const items = outlineNodes.map((node) => parseOutlineNode(node));
    return enforceHomeEntry(sanitizeMenuDocument({ items }));
  }

  async saveMenu(input: MenuDocument): Promise<MenuDocument> {
    const sanitized = enforceHomeEntry(sanitizeMenuDocument(input));

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
    });

    const opmlPayload = {
      '?xml': {
        '@_version': '1.0',
        '@_encoding': 'UTF-8',
      },
      opml: {
        '@_version': '2.0',
        head: {
          title: 'Blog Menu',
        },
        body: {
          outline: sanitized.items.map((item) => toOpmlOutlineNode(item)),
        },
      },
    };

    const xml = builder.build(opmlPayload);
    await fs.mkdir(this.getMetaDir(), { recursive: true });
    await fs.writeFile(this.getMenuFilePath(), xml, 'utf-8');

    this.emit('menuUpdated', sanitized);
    return sanitized;
  }
}

