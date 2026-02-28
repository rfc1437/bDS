import { dialog } from 'electron';
import {
  resolvePublicBaseUrl,
  type BlogGenerationResult,
  type BlogGenerationSection,
  type BlogGenerationOptions,
  type SiteValidationReport,
} from '../engine/BlogGenerationEngine';
import { resolvePageTitle } from '../engine/PageRenderer';
import type { EngineBundle } from '../engine/EngineBundle';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerBlogHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  const resolveBlogGenerationBaseOptions = async (): Promise<BlogGenerationOptions> => {
    const projectEngine = bundle.projectEngine;
    const postEngine = bundle.postEngine;
    const metaEngine = bundle.metaEngine;
    const mediaEngine = bundle.mediaEngine;
    const postMediaEngine = bundle.postMediaEngine;
    const menuEngine = bundle.menuEngine;

    const project = await projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    postEngine.setProjectContext(project.id, dataDir);
    metaEngine.setProjectContext(project.id, dataDir);
    mediaEngine.setProjectContext(project.id, dataDir, dataDir);
    postMediaEngine.setProjectContext(project.id);
    menuEngine.setProjectContext(project.id, dataDir);

    if (!metaEngine.isInitialized()) {
      await metaEngine.syncOnStartup();
    }

    const metadata = await metaEngine.getProjectMetadata();
    const menu = await menuEngine.getMenu();
    const baseUrl = resolvePublicBaseUrl(metadata?.publicUrl);
    if (!baseUrl) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Public URL Required',
        message: 'Site rendering requires a public URL.',
        detail: 'Set Project → Public URL in Settings before rendering the site.',
      });
      throw new Error('Project public URL is not configured');
    }

    const language = metadata?.mainLanguage?.trim() || 'en';
    const pageTitle = resolvePageTitle(metadata, project.name, project.description ?? undefined);

    return {
      projectId: project.id,
      projectName: metadata?.name?.trim() || project.name,
      projectDescription: metadata?.description,
      dataDir,
      baseUrl,
      maxPostsPerPage: metadata?.maxPostsPerPage,
      language,
      pageTitle,
      picoTheme: metadata?.picoTheme,
      categoryMetadata: (metadata as any)?.categoryMetadata,
      categorySettings: (metadata as any)?.categorySettings,
      menu,
    };
  };

  safeHandle('blog:generateSitemap', async () => {
    const blogGenerationEngine = bundle.blogGenerationEngine;
    const baseOptions = await resolveBlogGenerationBaseOptions();

    const taskTimestamp = Date.now();
    const taskGroupId = `site-render-${taskTimestamp}`;
    const taskGroupName = 'Render Site';

    const runSectionTask = async (
      section: BlogGenerationSection,
      taskName: string,
      taskIdPrefix: string,
    ): Promise<BlogGenerationResult> => {
      return bundle.taskManager.runTask({
        id: `${taskIdPrefix}-${taskTimestamp}`,
        name: taskName,
        groupId: taskGroupId,
        groupName: taskGroupName,
        execute: async (onProgress) => {
          return blogGenerationEngine.generate({
            ...baseOptions,
            sections: [section],
          }, (progress, message) => onProgress(progress, message || ''));
        },
      });
    };

    const mergeResults = (results: BlogGenerationResult[]): BlogGenerationResult => {
      const first = results[0];
      return {
        path: first.path,
        urlCount: Math.max(...results.map((result) => result.urlCount)),
        postCount: Math.max(...results.map((result) => result.postCount)),
        feedPostCount: Math.max(...results.map((result) => result.feedPostCount)),
        tagCount: Math.max(...results.map((result) => result.tagCount)),
        categoryCount: Math.max(...results.map((result) => result.categoryCount)),
        archiveCount: Math.max(...results.map((result) => result.archiveCount)),
        pagesGenerated: results.reduce((sum, result) => sum + result.pagesGenerated, 0),
        feeds: {
          rssPath: first.feeds.rssPath,
          atomPath: first.feeds.atomPath,
        },
        changed: {
          sitemap: results.some((result) => result.changed.sitemap),
          rss: results.some((result) => result.changed.rss),
          atom: results.some((result) => result.changed.atom),
        },
      };
    };

    const [coreResult, singleResult, categoryResult, tagResult, dateResult] = await Promise.all([
      runSectionTask('core', 'Render Site Core', 'site-render-core'),
      runSectionTask('single', 'Render Single Posts', 'site-render-single'),
      runSectionTask('category', 'Render Category Archives', 'site-render-category'),
      runSectionTask('tag', 'Render Tag Archives', 'site-render-tag'),
      runSectionTask('date', 'Render Date Archives', 'site-render-date'),
    ]);

    return mergeResults([coreResult, singleResult, categoryResult, tagResult, dateResult]);
  });

  safeHandle('blog:validateSite', async () => {
    const blogGenerationEngine = bundle.blogGenerationEngine;
    const baseOptions = await resolveBlogGenerationBaseOptions();

    const taskTimestamp = Date.now();
    return bundle.taskManager.runTask({
      id: `site-validate-${taskTimestamp}`,
      name: 'Validate Site',
      execute: async (onProgress) => {
        return blogGenerationEngine.validateSite(baseOptions, (progress, message) => {
          onProgress(progress, message || 'Validating site...');
        });
      },
    });
  });

  safeHandle('blog:regenerateCalendar', async () => {
    const blogGenerationEngine = bundle.blogGenerationEngine;
    const baseOptions = await resolveBlogGenerationBaseOptions();

    const taskTimestamp = Date.now();
    return bundle.taskManager.runTask({
      id: `site-calendar-regenerate-${taskTimestamp}`,
      name: 'Regenerate Calendar',
      execute: async (onProgress) => {
        return blogGenerationEngine.regenerateCalendar(baseOptions, (progress, message) => {
          onProgress(progress, message || 'Regenerating calendar...');
        });
      },
    });
  });

  safeHandle('blog:applyValidation', async (_event, report: SiteValidationReport) => {
    const blogGenerationEngine = bundle.blogGenerationEngine;
    const baseOptions = await resolveBlogGenerationBaseOptions();

    const taskTimestamp = Date.now();
    return bundle.taskManager.runTask({
      id: `site-validate-apply-${taskTimestamp}`,
      name: 'Apply Site Validation',
      execute: async (onProgress) => {
        return blogGenerationEngine.applyValidation(baseOptions, report, (progress, message) => {
          onProgress(progress, message || 'Applying site validation...');
        });
      },
    });
  });
}
