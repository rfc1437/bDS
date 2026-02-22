import type { MenuDocument } from './MenuEngine';
import type { ProjectMetadata } from './MetaEngine';
import { getPicoStylesheetHref, sanitizePicoTheme } from '../shared/picoThemes';
import {
  buildTemplateMenuItems,
  clampMaxPostsPerPage,
  resolvePageTitle,
  type CategoryRenderSettings,
  type HtmlRewriteContext,
} from './PageRenderer';

export interface SharedActiveProjectContext {
  projectId: string;
  dataDir?: string;
  projectName?: string;
  projectDescription?: string;
}

export interface SharedRouteRenderOptions {
  projectContext: SharedActiveProjectContext;
  metadata?: ProjectMetadata | null;
  menu?: MenuDocument;
  maxPostsPerPage?: number;
  requestTheme?: string | null;
  htmlThemeAttribute?: string;
  singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string };
}

export interface SharedRouteRenderServices<CategoryMetadata> {
  postEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
  };
  mediaEngine: {
    setProjectContext?: (projectId: string, dataDir?: string, internalDir?: string) => void;
  };
  postMediaEngine: {
    setProjectContext: (projectId: string) => void;
  };
  settingsEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
    getProjectMetadata: () => Promise<ProjectMetadata | null>;
    isInitialized?: () => boolean;
    syncOnStartup?: () => Promise<void>;
  };
  menuEngine: {
    setProjectContext: (projectId: string, dataDir?: string) => void;
    getMenu: () => Promise<MenuDocument>;
  };
  resolveCategoryMetadata: (metadata: ProjectMetadata | null) => Record<string, CategoryMetadata>;
  resolveCategorySettings: (metadata: ProjectMetadata | null) => Record<string, CategoryRenderSettings>;
  resolveListExcludedCategories: (settings: Record<string, CategoryRenderSettings>) => string[];
  buildHtmlRewriteContext: () => Promise<HtmlRewriteContext>;
  resolveRoute: (
    pathname: string,
    maxPostsPerPage: number,
    rewriteContext: HtmlRewriteContext,
    pageContext: {
      pageTitle: string;
      language: string;
      menuItems: ReturnType<typeof buildTemplateMenuItems>;
      picoStylesheetHref: string;
      htmlThemeAttribute?: string;
    },
    categorySettings: Record<string, CategoryRenderSettings>,
    categoryMetadata: Record<string, CategoryMetadata>,
    listExcludedCategories: string[],
    singlePostOptions?: { useDraftContent?: boolean; draftPostId?: string },
  ) => Promise<string | null>;
}

export async function renderRouteWithSharedContext<CategoryMetadata>(
  pathname: string,
  options: SharedRouteRenderOptions,
  services: SharedRouteRenderServices<CategoryMetadata>,
): Promise<string | null> {
  services.postEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);
  services.mediaEngine.setProjectContext?.(options.projectContext.projectId, options.projectContext.dataDir, options.projectContext.dataDir);
  services.postMediaEngine.setProjectContext(options.projectContext.projectId);
  services.settingsEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);
  services.menuEngine.setProjectContext(options.projectContext.projectId, options.projectContext.dataDir);

  let metadata = options.metadata;
  if (metadata === undefined) {
    if (services.settingsEngine.isInitialized && services.settingsEngine.syncOnStartup && !services.settingsEngine.isInitialized()) {
      await services.settingsEngine.syncOnStartup();
    }
    metadata = await services.settingsEngine.getProjectMetadata();
  }

  const categoryMetadata = services.resolveCategoryMetadata(metadata ?? null);
  const menu = options.menu ?? await services.menuEngine.getMenu().catch(() => ({ items: [] }));
  const menuItems = buildTemplateMenuItems(menu, categoryMetadata as Record<string, { title?: string }>);
  const categorySettings = services.resolveCategorySettings(metadata ?? null);
  const listExcludedCategories = services.resolveListExcludedCategories(categorySettings);
  const language = metadata?.mainLanguage?.trim() || 'en';
  const pageTitle = resolvePageTitle(metadata ?? null, options.projectContext.projectName, options.projectContext.projectDescription);
  const maxPostsPerPage = clampMaxPostsPerPage(options.maxPostsPerPage ?? metadata?.maxPostsPerPage);
  const appliedTheme = sanitizePicoTheme(options.requestTheme)
    ?? sanitizePicoTheme((metadata as { picoTheme?: unknown } | null)?.picoTheme);
  const picoStylesheetHref = getPicoStylesheetHref(appliedTheme);
  const htmlRewriteContext = await services.buildHtmlRewriteContext();
  const normalizedPathname = decodeURIComponent(pathname.replace(/\/+$/, '') || '/');

  return services.resolveRoute(normalizedPathname, maxPostsPerPage, htmlRewriteContext, {
    pageTitle,
    language,
    menuItems,
    picoStylesheetHref,
    htmlThemeAttribute: options.htmlThemeAttribute,
  }, categorySettings, categoryMetadata, listExcludedCategories, options.singlePostOptions);
}
