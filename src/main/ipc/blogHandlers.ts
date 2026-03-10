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
import type { TranslationValidationReport } from '../shared/electronApi';
import { autoTranslatePost, autoTranslateMediaMetadata } from './chatHandlers';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/connection';

type SafeHandle = (channel: string, handler: (...args: any[]) => Promise<any>) => void;

export function registerBlogHandlers(safeHandle: SafeHandle, bundle: EngineBundle): void {
  const resolveActiveProjectContext = async (): Promise<{
    project: NonNullable<Awaited<ReturnType<EngineBundle['projectEngine']['getActiveProject']>>>;
    dataDir: string;
    metadata: Awaited<ReturnType<EngineBundle['metaEngine']['getProjectMetadata']>>;
  }> => {
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

    return {
      project,
      dataDir,
      metadata,
    };
  };

  const resolveBlogGenerationBaseOptions = async (): Promise<BlogGenerationOptions> => {
    const menuEngine = bundle.menuEngine;
    const { project, dataDir, metadata } = await resolveActiveProjectContext();
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
      blogLanguages: Array.isArray(metadata?.blogLanguages) ? metadata.blogLanguages : [],
      pageTitle,
      picoTheme: metadata?.picoTheme,
      categoryMetadata: (metadata as any)?.categoryMetadata,
      categorySettings: (metadata as any)?.categorySettings,
      menu,
      dbPath: getDatabase().getDbPath(),
    };
  };

  safeHandle('blog:generateSitemap', async () => {
    const blogGenerationEngine = bundle.blogGenerationEngine;
    const baseOptions = await resolveBlogGenerationBaseOptions();

    // Pre-load post data ONCE before parallel tasks
    const preloadedData = await blogGenerationEngine.preloadGenerationData(baseOptions);

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
            preloadedData,
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

  safeHandle('blog:validateTranslations', async () => {
    await resolveActiveProjectContext();

    const taskTimestamp = Date.now();
    return bundle.taskManager.runTask({
      id: `translation-validate-${taskTimestamp}`,
      name: 'Validate Translations',
      execute: async (onProgress) => {
        onProgress(0, 'Validating translations...');
        const result = await bundle.postEngine.validateTranslations();
        onProgress(100, 'Translation validation complete');
        return result;
      },
    });
  });

  safeHandle('blog:fixInvalidTranslations', async (_event, report: TranslationValidationReport) => {
    await resolveActiveProjectContext();

    const taskTimestamp = Date.now();
    return bundle.taskManager.runTask({
      id: `translation-fix-${taskTimestamp}`,
      name: 'Fix Invalid Translations',
      execute: async (onProgress) => {
        onProgress(0, 'Fixing invalid translations...');
        const result = await bundle.postEngine.fixInvalidTranslations(report);
        onProgress(100, 'Invalid translations fixed');
        return result;
      },
    });
  });

  safeHandle('blog:fillMissingTranslations', async () => {
    const { metadata } = await resolveActiveProjectContext();
    const blogLanguages = metadata?.blogLanguages || [];
    const mainLang = metadata?.mainLanguage || 'en';
    if (blogLanguages.length === 0 || (blogLanguages.length === 1 && blogLanguages[0] === mainLang)) {
      return { taskStarted: false };
    }

    // Start the task immediately — scanning happens inside with progress
    bundle.taskManager.runTask({
      id: uuidv4(),
      name: 'Fill missing translations',
      execute: async (onProgress) => {
        onProgress(0, 'Scanning posts…');

        // Use missingTranslationLanguage filter per language instead of N+1 queries
        const postItems: Array<{ postId: string; postTitle: string; targetLang: string }> = [];
        for (let i = 0; i < blogLanguages.length; i++) {
          const lang = blogLanguages[i];
          const postsNeedingLang = await bundle.postEngine.getPostsFiltered({
            status: 'published',
            missingTranslationLanguage: lang,
          });
          for (const post of postsNeedingLang) {
            if (!post.doNotTranslate) {
              postItems.push({ postId: post.id, postTitle: post.title, targetLang: lang });
            }
          }
          onProgress(
            Math.round(((i + 1) / blogLanguages.length) * 10),
            `Scanning posts… (${i + 1}/${blogLanguages.length} languages)`,
          );
        }

        onProgress(10, 'Scanning media…');

        // Collect missing media translations
        const allPublished = await bundle.postEngine.getPostsFiltered({ status: 'published' });
        const publishedPosts = allPublished.filter((p) => !p.doNotTranslate);
        const mediaItems: Array<{ mediaId: string; targetLang: string }> = [];
        const seenMediaLang = new Set<string>();
        for (let i = 0; i < publishedPosts.length; i++) {
          const post = publishedPosts[i];
          const links = await bundle.postMediaEngine.getLinkedMediaForPost(post.id);
          for (const link of links) {
            const mediaItem = await bundle.mediaEngine.getMedia(link.mediaId);
            const mediaLang = mediaItem?.language || mainLang;
            const mediaTranslations = await bundle.mediaEngine.getMediaTranslations(link.mediaId);
            const existingLangs = new Set(mediaTranslations.map((t) => t.language));
            for (const lang of blogLanguages) {
              const key = `${link.mediaId}:${lang}`;
              if (lang !== mediaLang && !existingLangs.has(lang) && !seenMediaLang.has(key)) {
                seenMediaLang.add(key);
                mediaItems.push({ mediaId: link.mediaId, targetLang: lang });
              }
            }
          }
          onProgress(10 + Math.round(((i + 1) / publishedPosts.length) * 5), `Scanning media… (${i + 1}/${publishedPosts.length})`);
        }

        const totalItems = postItems.length + mediaItems.length;
        if (totalItems === 0) {
          onProgress(100, 'All translations are up to date');
          return;
        }

        onProgress(15, `Found ${postItems.length} posts and ${mediaItems.length} media to translate`);

        let completed = 0;
        let failed = 0;
        let warned = 0;

        for (const item of postItems) {
          onProgress(15 + Math.round((completed / totalItems) * 85), `Translating "${item.postTitle}" → ${item.targetLang}…`);
          const result = await autoTranslatePost(item.postId, item.targetLang, { autoPublish: true });
          if (!result.success) {
            failed++;
            console.error(`[FillMissing] post "${item.postTitle}" → ${item.targetLang} failed:`, result.error);
          } else if (result.warning) {
            warned++;
            console.warn(`[FillMissing] post "${item.postTitle}" → ${item.targetLang}: ${result.warning}`);
          }
          completed++;
        }

        for (const item of mediaItems) {
          onProgress(15 + Math.round((completed / totalItems) * 85), `Translating media ${item.mediaId.slice(0, 8)}… → ${item.targetLang}…`);
          const result = await autoTranslateMediaMetadata(item.mediaId, item.targetLang);
          if (!result.success) {
            failed++;
            console.error(`[FillMissing] media ${item.mediaId.slice(0, 8)}… → ${item.targetLang} failed:`, result.error);
          }
          completed++;
        }

        const parts: string[] = ['Done'];
        if (failed > 0) parts.push(`${failed} failed`);
        if (warned > 0) parts.push(`${warned} warnings`);
        onProgress(100, parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]);
      },
    }).catch(() => { /* errors tracked via task panel */ });

    return { taskStarted: true };
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
