import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export type MenuItemKind = 'page' | 'submenu';

export interface MenuItemData {
  id: string;
  title: string;
  kind: MenuItemKind;
  pageId?: string;
  pageSlug?: string;
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
  const kind = candidate.kind === 'submenu' ? 'submenu' : 'page';
  const childrenSource = Array.isArray(candidate.children) ? candidate.children : [];
  const title = normalizeNonEmptyString(candidate.title) || 'Untitled';

  return {
    id: normalizeNonEmptyString(candidate.id) || generateMenuItemId(),
    title,
    kind,
    pageId: kind === 'page' ? normalizeNonEmptyString(candidate.pageId) : undefined,
    pageSlug: kind === 'page' ? normalizeNonEmptyString(candidate.pageSlug) : undefined,
    children: childrenSource.map((child) => sanitizeMenuItem(child)),
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
  const kind: MenuItemKind = node['@_type'] === 'submenu' ? 'submenu' : 'page';
  const title = normalizeNonEmptyString(node['@_text']) || normalizeNonEmptyString(node['@_title']) || 'Untitled';

  return {
    id: normalizeNonEmptyString(node['@_id']) || generateMenuItemId(),
    title,
    kind,
    pageId: kind === 'page' ? normalizeNonEmptyString(node['@_pageId']) : undefined,
    pageSlug: kind === 'page' ? normalizeNonEmptyString(node['@_pageSlug']) : undefined,
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

  if (item.kind === 'page' && item.pageSlug) {
    outlineNode['@_pageSlug'] = item.pageSlug;
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
        return { items: [] };
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
    return sanitizeMenuDocument({ items });
  }

  async saveMenu(input: MenuDocument): Promise<MenuDocument> {
    const sanitized = sanitizeMenuDocument(input);

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

let menuEngine: MenuEngine | null = null;

export function getMenuEngine(): MenuEngine {
  if (!menuEngine) {
    menuEngine = new MenuEngine();
  }
  return menuEngine;
}
