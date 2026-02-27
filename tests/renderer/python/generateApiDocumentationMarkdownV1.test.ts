import { describe, expect, it } from 'vitest';
import { generateApiDocumentationMarkdownV1 } from '../../../src/renderer/python/generateApiDocumentationMarkdownV1';

describe('generateApiDocumentationMarkdownV1', () => {
  it('includes a top-level table of contents with module jump links', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('## Table of contents');
    expect(markdown).toContain('- [projects](#projects)');
    expect(markdown).toContain('- [posts](#posts)');
    expect(markdown).toContain('- [media](#media)');
    expect(markdown).toContain('- [Data Structures](#data-structures)');
  });

  it('includes per-module API sub-table of contents with endpoint jump links', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('**Module APIs**');
    expect(markdown).toContain('- [projects.create](#projectscreate)');
    expect(markdown).toContain('- [posts.getAll](#postsgetall)');
    expect(markdown).toContain('- [media.import](#mediaimport)');
  });

  it('includes quick links back to top navigation sections', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('[↑ Back to Table of contents](#table-of-contents)');
  });

  it('documents sync and publish APIs in dedicated module sections', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('## sync');
    expect(markdown).toContain('### sync.getRepoState');
    expect(markdown).toContain('### sync.commitAll');
    expect(markdown).toContain('- [sync](#sync)');
    expect(markdown).toContain('## publish');
    expect(markdown).toContain('### publish.uploadSite');
    expect(markdown).toContain('- [publish](#publish)');
    // chat namespace should not be present
    expect(markdown).not.toContain('## chat');
  });

  it('includes a dedicated Data Structures section with core object shapes', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('## Data Structures');
    expect(markdown).toContain('### PostData');
    expect(markdown).toContain('- id (`string`, required)');
    expect(markdown).toContain('- title (`string`, required)');
    expect(markdown).toContain('- content (`string`, required)');
    expect(markdown).toContain('### MediaData');
    expect(markdown).toContain('- filename (`string`, required)');
    expect(markdown).toContain('- mimeType (`string`, required)');
  });

  it('documents return type details in the response section', () => {
    const markdown = generateApiDocumentationMarkdownV1();

    expect(markdown).toContain('**Response specification**');
    expect(markdown).toContain('- Return type: `PostData | null`');
    expect(markdown).toContain('- Return type: `MediaData[]`');
  });
});