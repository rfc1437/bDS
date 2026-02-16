/**
 * WxrParser Unit Tests
 *
 * Tests the REAL WxrParser class with mocked filesystem.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WxrParser } from '../../src/main/engine/WxrParser';
import type { WxrData } from '../../src/main/engine/WxrParser';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Minimal valid WXR XML for testing
const MINIMAL_WXR = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Test Blog</title>
    <link>https://example.com</link>
    <description>A test blog</description>
    <language>en-US</language>
  </channel>
</rss>`;

// WXR with categories and tags at channel level
const WXR_WITH_TAXONOMIES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <wp:category>
      <wp:term_id>1</wp:term_id>
      <wp:category_nicename>technology</wp:category_nicename>
      <wp:category_parent></wp:category_parent>
      <wp:cat_name><![CDATA[Technology]]></wp:cat_name>
    </wp:category>
    <wp:category>
      <wp:term_id>2</wp:term_id>
      <wp:category_nicename>web-dev</wp:category_nicename>
      <wp:category_parent>technology</wp:category_parent>
      <wp:cat_name><![CDATA[Web Development]]></wp:cat_name>
    </wp:category>
    <wp:tag>
      <wp:term_id>10</wp:term_id>
      <wp:tag_slug>javascript</wp:tag_slug>
      <wp:tag_name><![CDATA[JavaScript]]></wp:tag_name>
    </wp:tag>
    <wp:tag>
      <wp:term_id>11</wp:term_id>
      <wp:tag_slug>typescript</wp:tag_slug>
      <wp:tag_name><![CDATA[TypeScript]]></wp:tag_name>
    </wp:tag>
  </channel>
</rss>`;

// WXR with a single published post
const WXR_WITH_POST = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <item>
      <title>Hello World</title>
      <link>https://example.com/hello-world/</link>
      <pubDate>Mon, 15 Jan 2024 10:30:00 +0000</pubDate>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <category domain="category" nicename="uncategorized"><![CDATA[Uncategorized]]></category>
      <category domain="post_tag" nicename="intro"><![CDATA[Intro]]></category>
      <category domain="post_tag" nicename="welcome"><![CDATA[Welcome]]></category>
      <content:encoded><![CDATA[<p>Welcome to my blog. This is my <strong>first</strong> post.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[Welcome to my blog.]]></excerpt:encoded>
      <wp:post_id>42</wp:post_id>
      <wp:post_date>2024-01-15 10:30:00</wp:post_date>
      <wp:post_date_gmt>2024-01-15 10:30:00</wp:post_date_gmt>
      <wp:post_modified>2024-01-20 15:45:30</wp:post_modified>
      <wp:post_modified_gmt>2024-01-20 15:45:30</wp:post_modified_gmt>
      <wp:post_name>hello-world</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
    </item>
  </channel>
</rss>`;

// WXR with a page
const WXR_WITH_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <item>
      <title>About Me</title>
      <content:encoded><![CDATA[<h2>About</h2><p>This is the about page.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>10</wp:post_id>
      <wp:post_name>about</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>page</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
  </channel>
</rss>`;

// WXR with a media attachment
const WXR_WITH_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <item>
      <title>sunset-photo</title>
      <content:encoded><![CDATA[A beautiful sunset]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>100</wp:post_id>
      <wp:post_name>sunset-photo</wp:post_name>
      <wp:status>inherit</wp:status>
      <wp:post_type>attachment</wp:post_type>
      <wp:post_parent>42</wp:post_parent>
      <wp:attachment_url>https://example.com/wp-content/uploads/2024/01/sunset.jpg</wp:attachment_url>
      <wp:postmeta>
        <wp:meta_key>_wp_attached_file</wp:meta_key>
        <wp:meta_value>2024/01/sunset.jpg</wp:meta_value>
      </wp:postmeta>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
  </channel>
</rss>`;

const WXR_WITH_MEDIA_PUBDATE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <item>
      <title>header-image</title>
      <pubDate>Fri, 05 Jan 2024 12:34:56 +0000</pubDate>
      <content:encoded><![CDATA[]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>101</wp:post_id>
      <wp:post_name>header-image</wp:post_name>
      <wp:status>inherit</wp:status>
      <wp:post_type>attachment</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <wp:attachment_url>https://example.com/wp-content/uploads/2024/01/header.jpg</wp:attachment_url>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
  </channel>
</rss>`;

const WXR_WITH_INVALID_PUBDATE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Dates Blog</title>
    <link>https://example.com</link>
    <description>Test</description>
    <language>en</language>
    <item>
      <title>Bad Date Post</title>
      <pubDate>not-a-date</pubDate>
      <content:encoded><![CDATA[<p>bad date</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>201</wp:post_id>
      <wp:post_name>bad-date-post</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
    <item>
      <title>Bad Date Media</title>
      <pubDate>also-not-a-date</pubDate>
      <content:encoded><![CDATA[]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>202</wp:post_id>
      <wp:post_name>bad-date-media</wp:post_name>
      <wp:status>inherit</wp:status>
      <wp:post_type>attachment</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <wp:attachment_url>https://example.com/wp-content/uploads/2024/01/bad-date.jpg</wp:attachment_url>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
  </channel>
</rss>`;

// WXR with mixed content: posts, pages, and media
const WXR_MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Full Blog</title>
    <link>https://fullblog.com</link>
    <description>A full blog export</description>
    <language>de-DE</language>
    <wp:category>
      <wp:category_nicename>news</wp:category_nicename>
      <wp:category_parent></wp:category_parent>
      <wp:cat_name><![CDATA[News]]></wp:cat_name>
    </wp:category>
    <wp:tag>
      <wp:tag_slug>featured</wp:tag_slug>
      <wp:tag_name><![CDATA[Featured]]></wp:tag_name>
    </wp:tag>
    <item>
      <title>First Post</title>
      <pubDate>Tue, 02 Jan 2024 08:00:00 +0000</pubDate>
      <dc:creator><![CDATA[editor]]></dc:creator>
      <category domain="category" nicename="news"><![CDATA[News]]></category>
      <category domain="post_tag" nicename="featured"><![CDATA[Featured]]></category>
      <content:encoded><![CDATA[<p>First post content.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[First post]]></excerpt:encoded>
      <wp:post_id>1</wp:post_id>
      <wp:post_name>first-post</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
    </item>
    <item>
      <title>Second Post</title>
      <pubDate>Wed, 03 Jan 2024 09:00:00 +0000</pubDate>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <content:encoded><![CDATA[<p>Second post content.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>2</wp:post_id>
      <wp:post_name>second-post</wp:post_name>
      <wp:status>draft</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
    </item>
    <item>
      <title>Contact</title>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <content:encoded><![CDATA[<p>Contact us here.</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>3</wp:post_id>
      <wp:post_name>contact</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>page</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
    </item>
    <item>
      <title>logo</title>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <content:encoded><![CDATA[]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>4</wp:post_id>
      <wp:post_name>logo</wp:post_name>
      <wp:status>inherit</wp:status>
      <wp:post_type>attachment</wp:post_type>
      <wp:post_parent>3</wp:post_parent>
      <wp:attachment_url>https://fullblog.com/wp-content/uploads/2024/02/logo.png</wp:attachment_url>
    </item>
  </channel>
</rss>`;

// WXR with draft and trashed posts
const WXR_WITH_STATUSES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Blog</title>
    <link>https://example.com</link>
    <description></description>
    <language>en</language>
    <item>
      <title>Published Post</title>
      <content:encoded><![CDATA[<p>Published</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>1</wp:post_id>
      <wp:post_name>published-post</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
    <item>
      <title>Draft Post</title>
      <content:encoded><![CDATA[<p>Draft</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>2</wp:post_id>
      <wp:post_name>draft-post</wp:post_name>
      <wp:status>draft</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
    <item>
      <title>Trashed Post</title>
      <content:encoded><![CDATA[<p>Trash</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>3</wp:post_id>
      <wp:post_name>__trashed</wp:post_name>
      <wp:status>trash</wp:status>
      <wp:post_type>post</wp:post_type>
      <wp:post_parent>0</wp:post_parent>
      <dc:creator><![CDATA[admin]]></dc:creator>
    </item>
  </channel>
</rss>`;

describe('WxrParser', () => {
  let parser: WxrParser;

  beforeEach(() => {
    parser = new WxrParser();
  });

  describe('parseXml', () => {
    it('should parse minimal WXR and extract site info', () => {
      const result = parser.parseXml(MINIMAL_WXR);

      expect(result.site.title).toBe('My Test Blog');
      expect(result.site.link).toBe('https://example.com');
      expect(result.site.description).toBe('A test blog');
      expect(result.site.language).toBe('en-US');
    });

    it('should return empty arrays when no items exist', () => {
      const result = parser.parseXml(MINIMAL_WXR);

      expect(result.posts).toEqual([]);
      expect(result.pages).toEqual([]);
      expect(result.media).toEqual([]);
      expect(result.categories).toEqual([]);
      expect(result.tags).toEqual([]);
    });

    it('should extract channel-level categories with parent relationships', () => {
      const result = parser.parseXml(WXR_WITH_TAXONOMIES);

      expect(result.categories).toHaveLength(2);
      expect(result.categories[0]).toEqual({
        name: 'Technology',
        slug: 'technology',
        parent: '',
      });
      expect(result.categories[1]).toEqual({
        name: 'Web Development',
        slug: 'web-dev',
        parent: 'technology',
      });
    });

    it('should extract channel-level tags', () => {
      const result = parser.parseXml(WXR_WITH_TAXONOMIES);

      expect(result.tags).toHaveLength(2);
      expect(result.tags[0]).toEqual({
        name: 'JavaScript',
        slug: 'javascript',
      });
      expect(result.tags[1]).toEqual({
        name: 'TypeScript',
        slug: 'typescript',
      });
    });

    it('should parse a published post with all fields', () => {
      const result = parser.parseXml(WXR_WITH_POST);

      expect(result.posts).toHaveLength(1);
      const post = result.posts[0];
      expect(post.wpId).toBe(42);
      expect(post.title).toBe('Hello World');
      expect(post.slug).toBe('hello-world');
      expect(post.content).toBe('<p>Welcome to my blog. This is my <strong>first</strong> post.</p>');
      expect(post.excerpt).toBe('Welcome to my blog.');
      expect(post.creator).toBe('admin');
      expect(post.status).toBe('publish');
      expect(post.postType).toBe('post');
      expect(post.categories).toEqual(['Uncategorized']);
      expect(post.tags).toEqual(['Intro', 'Welcome']);
      expect(post.pubDate).toBeInstanceOf(Date);
    });

    it('should extract postDate and postModified from WXR', () => {
      const result = parser.parseXml(WXR_WITH_POST);
      const post = result.posts[0];

      // postDate is the WordPress local creation date
      expect(post.postDate).toBeInstanceOf(Date);
      expect(post.postDate?.toISOString()).toBe('2024-01-15T10:30:00.000Z');

      // postModified is the WordPress local modification date  
      expect(post.postModified).toBeInstanceOf(Date);
      expect(post.postModified?.toISOString()).toBe('2024-01-20T15:45:30.000Z');
    });

    it('should handle missing postDate and postModified gracefully', () => {
      const result = parser.parseXml(WXR_WITH_PAGE);
      const page = result.pages[0];

      // Page test data doesn't have post_date/post_modified
      expect(page.postDate).toBeNull();
      expect(page.postModified).toBeNull();
    });

    it('should parse a page and put it in pages array', () => {
      const result = parser.parseXml(WXR_WITH_PAGE);

      expect(result.posts).toHaveLength(0);
      expect(result.pages).toHaveLength(1);

      const page = result.pages[0];
      expect(page.wpId).toBe(10);
      expect(page.title).toBe('About Me');
      expect(page.slug).toBe('about');
      expect(page.content).toContain('<h2>About</h2>');
      expect(page.postType).toBe('page');
    });

    it('should parse a media attachment with URL and filename', () => {
      const result = parser.parseXml(WXR_WITH_MEDIA);

      expect(result.posts).toHaveLength(0);
      expect(result.media).toHaveLength(1);

      const media = result.media[0];
      expect(media.wpId).toBe(100);
      expect(media.title).toBe('sunset-photo');
      expect(media.url).toBe('https://example.com/wp-content/uploads/2024/01/sunset.jpg');
      expect(media.filename).toBe('sunset.jpg');
      expect(media.relativePath).toBe('2024/01/sunset.jpg');
      expect(media.parentId).toBe(42);
      expect(media.description).toBe('A beautiful sunset');
    });

    it('should separate posts, pages, and media from mixed content', () => {
      const result = parser.parseXml(WXR_MIXED);

      expect(result.posts).toHaveLength(2);
      expect(result.pages).toHaveLength(1);
      expect(result.media).toHaveLength(1);
      expect(result.categories).toHaveLength(1);
      expect(result.tags).toHaveLength(1);

      expect(result.posts[0].title).toBe('First Post');
      expect(result.posts[1].title).toBe('Second Post');
      expect(result.pages[0].title).toBe('Contact');
      expect(result.media[0].title).toBe('logo');
    });

    it('should extract post categories and tags from item-level category elements', () => {
      const result = parser.parseXml(WXR_MIXED);

      const firstPost = result.posts[0];
      expect(firstPost.categories).toEqual(['News']);
      expect(firstPost.tags).toEqual(['Featured']);

      // Second post has no categories or tags
      const secondPost = result.posts[1];
      expect(secondPost.categories).toEqual([]);
      expect(secondPost.tags).toEqual([]);
    });

    it('should handle different post statuses', () => {
      const result = parser.parseXml(WXR_WITH_STATUSES);

      expect(result.posts).toHaveLength(3);
      expect(result.posts[0].status).toBe('publish');
      expect(result.posts[1].status).toBe('draft');
      expect(result.posts[2].status).toBe('trash');
    });

    it('should extract relative path from media URL based on wp-content/uploads', () => {
      const result = parser.parseXml(WXR_WITH_MEDIA);
      const media = result.media[0];

      // The path after wp-content/uploads/
      expect(media.relativePath).toBe('2024/01/sunset.jpg');
    });

    it('should extract relative path from mixed content media', () => {
      const result = parser.parseXml(WXR_MIXED);
      const media = result.media[0];

      expect(media.relativePath).toBe('2024/02/logo.png');
      expect(media.filename).toBe('logo.png');
    });

    it('should handle empty content gracefully', () => {
      const result = parser.parseXml(WXR_WITH_MEDIA);
      // Media items in WXR often have empty excerpt
      const media = result.media[0];
      expect(media).toBeDefined();
    });

    it('should infer mime type from file extension', () => {
      const result = parser.parseXml(WXR_WITH_MEDIA);
      expect(result.media[0].mimeType).toBe('image/jpeg');

      const mixedResult = parser.parseXml(WXR_MIXED);
      expect(mixedResult.media[0].mimeType).toBe('image/png');
    });

    it('should handle missing pubDate gracefully', () => {
      const result = parser.parseXml(WXR_WITH_PAGE);
      // Page has no pubDate element
      expect(result.pages[0].pubDate).toBeNull();
    });

    it('should parse valid RFC822 pubDate for media items', () => {
      const result = parser.parseXml(WXR_WITH_MEDIA_PUBDATE);

      expect(result.media).toHaveLength(1);
      expect(result.media[0].pubDate).toBeInstanceOf(Date);
      expect(result.media[0].pubDate?.toISOString()).toBe('2024-01-05T12:34:56.000Z');
    });

    it('should fallback to null for invalid pubDate nodes in post and media items', () => {
      const result = parser.parseXml(WXR_WITH_INVALID_PUBDATE);

      expect(result.posts).toHaveLength(1);
      expect(result.media).toHaveLength(1);
      expect(result.posts[0].pubDate).toBeNull();
      expect(result.media[0].pubDate).toBeNull();
    });

    it('should keep base fields parity between post and page parse branches', () => {
      const result = parser.parseXml(WXR_MIXED);
      const post = result.posts[0];
      const page = result.pages[0];

      expect(post.postType).toBe('post');
      expect(page.postType).toBe('page');
      expect(post.wpId).toBeGreaterThan(0);
      expect(page.wpId).toBeGreaterThan(0);
      expect(post.title).toBeTruthy();
      expect(page.title).toBeTruthy();
      expect(post.slug).toBeTruthy();
      expect(page.slug).toBeTruthy();
      expect(typeof post.content).toBe('string');
      expect(typeof page.content).toBe('string');
      expect(typeof post.excerpt).toBe('string');
      expect(typeof page.excerpt).toBe('string');
    });
  });

  describe('parseFile', () => {
    it('should read a file and parse its contents', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce(WXR_WITH_POST);

      const result = await parser.parseFile('/path/to/export.xml');

      expect(fs.readFile).toHaveBeenCalledWith('/path/to/export.xml', 'utf-8');
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].title).toBe('Hello World');
    });

    it('should throw an error if the file cannot be read', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(parser.parseFile('/nonexistent.xml')).rejects.toThrow('ENOENT');
    });
  });
});
