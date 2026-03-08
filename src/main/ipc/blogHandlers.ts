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
    if (blogLanguages.length <= 1 && blogLanguages[0] === mainLang) {
      return { translatedPosts: 0, translatedMedia: 0, failed: 0 };
    }

    const allPosts = await bundle.postEngine.getPostsFiltered({ status: 'published' });
    const publishedPosts = allPosts.filter((p) => !p.doNotTranslate);

    // Collect missing post translations
    const postTasks: Array<{ postId: string; postTitle: string; targetLang: string }> = [];
    for (const post of publishedPosts) {
      const postLang = post.language || mainLang;
      const translations = await bundle.postEngine.getPostTranslations(post.id);
      const existingLangs = new Set(translations.map((t) => t.language));
      for (const lang of blogLanguages) {
        if (lang !== postLang && !existingLangs.has(lang)) {
          postTasks.push({ postId: post.id, postTitle: post.title, targetLang: lang });
        }
      }
    }

    // Collect missing media translations
    const mediaTaskSet = new Map<string, Set<string>>();
    for (const post of publishedPosts) {
      const postLang = post.language || mainLang;
      const links = await bundle.postMediaEngine.getLinkedMediaForPost(post.id);
      for (const link of links) {
        const mediaTranslations = await bundle.mediaEngine.getMediaTranslations(link.mediaId);
        const existingLangs = new Set(mediaTranslations.map((t) => t.language));
        for (const lang of blogLanguages) {
          if (lang !== postLang && !existingLangs.has(lang)) {
            if (!mediaTaskSet.has(link.mediaId)) mediaTaskSet.set(link.mediaId, new Set());
            mediaTaskSet.get(link.mediaId)!.add(lang);
          }
        }
      }
    }

    let translatedPosts = 0;
    let translatedMedia = 0;
    let failed = 0;

    if (postTasks.length > 0) {
      const groupId = uuidv4();
      for (const task of postTasks) {
        bundle.taskManager.runTask({
          id: uuidv4(),
          name: `Translate "${task.postTitle}" → ${task.targetLang}`,
          groupId,
          groupName: 'Fill Missing Translations (Posts)',
          execute: async (onProgress) => {
            onProgress(10, `Translating to ${task.targetLang}...`);
            const result = await autoTranslatePost(task.postId, task.targetLang);
            if (result.success) {
              translatedPosts++;
            } else {
              failed++;
              throw new Error(result.error || 'Translation failed');
            }
            onProgress(100, 'Done');
          },
        }).catch(() => { /* errors tracked via task panel */ });
      }
    }

    if (mediaTaskSet.size > 0) {
      const groupId = uuidv4();
      for (const [mediaId, languages] of mediaTaskSet) {
        for (const lang of languages) {
          bundle.taskManager.runTask({
            id: uuidv4(),
            name: `Translate media ${mediaId.slice(0, 8)}… → ${lang}`,
            groupId,
            groupName: 'Fill Missing Translations (Media)',
            execute: async (onProgress) => {
              onProgress(10, `Translating media metadata to ${lang}...`);
              const result = await autoTranslateMediaMetadata(mediaId, lang);
              if (result.success) {
                translatedMedia++;
              } else {
                failed++;
                throw new Error(result.error || 'Translation failed');
              }
              onProgress(100, 'Done');
            },
          }).catch(() => { /* errors tracked via task panel */ });
        }
      }
    }

    return {
      enqueuedPosts: postTasks.length,
      enqueuedMedia: Array.from(mediaTaskSet.values()).reduce((sum, s) => sum + s.size, 0),
    };
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
