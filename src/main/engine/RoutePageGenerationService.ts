import type { PostData } from './PostEngine';

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function renderRequiredRoute(
  renderRoute: (pathname: string) => Promise<string | null>,
  pathname: string,
): Promise<string> {
  const html = await renderRoute(pathname);
  if (html !== null) {
    return html;
  }

  throw new Error(`Shared route renderer returned null for required path: ${pathname}`);
}

interface BaseParams {
  projectId: string;
  renderRoute: (pathname: string) => Promise<string | null>;
  writePage: (projectId: string, urlPath: string, content: string) => Promise<boolean>;
  onPageGenerated: (message: string) => void;
}

export async function generateRootPages(params: BaseParams & {
  posts: PostData[];
  maxPostsPerPage: number;
}): Promise<number> {
  const totalPages = Math.max(1, Math.ceil(params.posts.length / params.maxPostsPerPage));
  let count = 0;

  for (let page = 1; page <= totalPages; page++) {
    const offset = (page - 1) * params.maxPostsPerPage;
    const pagePosts = params.posts.slice(offset, offset + params.maxPostsPerPage);
    if (pagePosts.length === 0) break;

    const routePath = page === 1 ? '/' : `/page/${page}`;
    const html = await renderRequiredRoute(params.renderRoute, routePath);
    const urlPath = page === 1 ? '' : `page/${page}`;
    await params.writePage(params.projectId, urlPath, html);
    count++;
    params.onPageGenerated(urlPath ? `Generated /${urlPath}` : 'Generated /');
  }

  return count;
}

export async function generatePageRoutes(params: BaseParams & {
  posts: PostData[];
}): Promise<number> {
  let count = 0;
  const pagePosts = params.posts.filter((post) => (post.categories || []).includes('page'));

  for (const post of pagePosts) {
    const routePath = `/${post.slug}`;
    const html = await renderRequiredRoute(params.renderRoute, routePath);
    await params.writePage(params.projectId, post.slug, html);
    count++;
    params.onPageGenerated(`Generated /${post.slug}`);
  }

  return count;
}

export async function generateSinglePostPages(params: BaseParams & {
  posts: PostData[];
}): Promise<number> {
  let count = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < params.posts.length; i += BATCH_SIZE) {
    const batch = params.posts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (post) => {
      const createdAt = resolvePostCreatedAt(post);
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');

      const urlPath = `${year}/${month}/${day}/${post.slug}`;
      const html = await renderRequiredRoute(params.renderRoute, `/${urlPath}`);
      await params.writePage(params.projectId, urlPath, html);
      params.onPageGenerated(`Generated /${urlPath}`);
    }));
    count += results.length;
  }

  return count;
}

async function generatePaginatedListPages(params: BaseParams & {
  posts: PostData[];
  maxPostsPerPage: number;
  urlPrefix: string;
}): Promise<number> {
  if (params.posts.length === 0) return 0;

  const totalPages = Math.max(1, Math.ceil(params.posts.length / params.maxPostsPerPage));
  let count = 0;

  for (let page = 1; page <= totalPages; page++) {
    const offset = (page - 1) * params.maxPostsPerPage;
    const pagePosts = params.posts.slice(offset, offset + params.maxPostsPerPage);
    if (pagePosts.length === 0) break;

    const routePath = page === 1 ? `/${params.urlPrefix}` : `/${params.urlPrefix}/page/${page}`;
    const html = await renderRequiredRoute(params.renderRoute, routePath);
    const urlPath = page === 1 ? params.urlPrefix : `${params.urlPrefix}/page/${page}`;
    await params.writePage(params.projectId, urlPath, html);
    count++;
    params.onPageGenerated(`Generated /${urlPath}`);
  }

  return count;
}

export async function generateCategoryPages(params: BaseParams & {
  posts: PostData[];
  allCategories: Set<string>;
  maxPostsPerPage: number;
  postsByCategory?: Map<string, PostData[]>;
}): Promise<number> {
  let count = 0;

  for (const category of Array.from(params.allCategories).sort()) {
    const categoryPosts = params.postsByCategory?.get(category) ?? params.posts.filter((post) => (post.categories || []).includes(category));
    if (categoryPosts.length === 0) continue;

    const totalPages = Math.max(1, Math.ceil(categoryPosts.length / params.maxPostsPerPage));
    const encodedCategory = encodeURIComponent(category);

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * params.maxPostsPerPage;
      const pagePosts = categoryPosts.slice(offset, offset + params.maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const routePath = page === 1
        ? `/category/${encodedCategory}`
        : `/category/${encodedCategory}/page/${page}`;
      const html = await renderRequiredRoute(params.renderRoute, routePath);
      const urlPath = page === 1
        ? `category/${encodedCategory}`
        : `category/${encodedCategory}/page/${page}`;
      await params.writePage(params.projectId, urlPath, html);
      count++;
      params.onPageGenerated(`Generated /${urlPath}`);
    }
  }

  return count;
}

export async function generateTagPages(params: BaseParams & {
  posts: PostData[];
  allTags: Set<string>;
  maxPostsPerPage: number;
  postsByTag?: Map<string, PostData[]>;
}): Promise<number> {
  let count = 0;

  for (const tag of Array.from(params.allTags).sort()) {
    const tagPosts = params.postsByTag?.get(tag) ?? params.posts.filter((post) => (post.tags || []).includes(tag));
    if (tagPosts.length === 0) continue;

    const totalPages = Math.max(1, Math.ceil(tagPosts.length / params.maxPostsPerPage));
    const encodedTag = encodeURIComponent(tag);

    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * params.maxPostsPerPage;
      const pagePosts = tagPosts.slice(offset, offset + params.maxPostsPerPage);
      if (pagePosts.length === 0) break;

      const routePath = page === 1
        ? `/tag/${encodedTag}`
        : `/tag/${encodedTag}/page/${page}`;
      const html = await renderRequiredRoute(params.renderRoute, routePath);
      const urlPath = page === 1
        ? `tag/${encodedTag}`
        : `tag/${encodedTag}/page/${page}`;
      await params.writePage(params.projectId, urlPath, html);
      count++;
      params.onPageGenerated(`Generated /${urlPath}`);
    }
  }

  return count;
}

export async function generateDateArchivePages(params: BaseParams & {
  posts: PostData[];
  yearsMap: Map<number, Date>;
  yearMonthsMap: Map<string, Date>;
  yearMonthDaysMap: Map<string, Date>;
  maxPostsPerPage: number;
  postsByYear?: Map<number, PostData[]>;
  postsByYearMonth?: Map<string, PostData[]>;
  postsByYearMonthDay?: Map<string, PostData[]>;
}): Promise<number> {
  let count = 0;

  for (const [year] of Array.from(params.yearsMap.entries()).sort((a, b) => b[0] - a[0])) {
    const yearPosts = params.postsByYear?.get(year) ?? params.posts.filter((post) => resolvePostCreatedAt(post).getFullYear() === year);
    count += await generatePaginatedListPages({
      projectId: params.projectId,
      posts: yearPosts,
      maxPostsPerPage: params.maxPostsPerPage,
      renderRoute: params.renderRoute,
      writePage: params.writePage,
      onPageGenerated: params.onPageGenerated,
      urlPrefix: `${year}`,
    });
  }

  for (const [ym] of Array.from(params.yearMonthsMap.entries()).sort().reverse()) {
    const [yearStr, monthStr] = ym.split('/');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const monthPosts = params.postsByYearMonth?.get(ym) ?? params.posts.filter((post) => {
      const d = resolvePostCreatedAt(post);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });

    count += await generatePaginatedListPages({
      projectId: params.projectId,
      posts: monthPosts,
      maxPostsPerPage: params.maxPostsPerPage,
      renderRoute: params.renderRoute,
      writePage: params.writePage,
      onPageGenerated: params.onPageGenerated,
      urlPrefix: ym,
    });
  }

  for (const [ymd] of Array.from(params.yearMonthDaysMap.entries()).sort().reverse()) {
    const [yearStr, monthStr, dayStr] = ymd.split('/');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const dayPosts = params.postsByYearMonthDay?.get(ymd) ?? params.posts.filter((post) => {
      const d = resolvePostCreatedAt(post);
      return d.getFullYear() === year && (d.getMonth() + 1) === month && d.getDate() === day;
    });

    count += await generatePaginatedListPages({
      projectId: params.projectId,
      posts: dayPosts,
      maxPostsPerPage: params.maxPostsPerPage,
      renderRoute: params.renderRoute,
      writePage: params.writePage,
      onPageGenerated: params.onPageGenerated,
      urlPrefix: ymd,
    });
  }

  return count;
}
