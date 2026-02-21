import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('duplication guards for shared navigation features', () => {
  it('keeps menu view actions on shared activity executor', async () => {
    const app = await read('src/renderer/App.tsx');

    expect(app).toContain("window.electronAPI?.on('menu:viewPosts'");
    expect(app).toContain("window.electronAPI?.on('menu:viewMedia'");
    expect(app).toContain('executeActivityClick(');

    expect(app).not.toMatch(/menu:viewPosts[\s\S]*setActiveView\('posts'\)/);
    expect(app).not.toMatch(/menu:viewMedia[\s\S]*setActiveView\('media'\)/);
  });

  it('keeps activity bar execution on shared action executor', async () => {
    const activityBar = await read('src/renderer/components/ActivityBar/ActivityBar.tsx');

    expect(activityBar).toContain("from '../../navigation/activityExecution'");
    expect(activityBar).toContain('runActivityClick(');

    expect(activityBar).not.toContain('getActivityClickActions(');
    expect(activityBar).not.toMatch(/for \(const action of actions\)/);
  });

  it('keeps sidebar and git sidebar tab openings on tabPolicy helpers', async () => {
    const sidebar = await read('src/renderer/components/Sidebar/Sidebar.tsx');
    const gitSidebar = await read('src/renderer/components/GitSidebar/GitSidebar.tsx');

    expect(sidebar).toContain('openChatTab(');
    expect(sidebar).toContain('openImportTab(');
    expect(sidebar).toContain('openEntityTab(');

    expect(sidebar).not.toMatch(/openTab\(\{\s*type:\s*'chat'/);
    expect(sidebar).not.toMatch(/openTab\(\{\s*type:\s*'import'/);

    expect(gitSidebar).toContain('openGitDiffFileTab(');
    expect(gitSidebar).toContain('openGitDiffCommitTab(');
    expect(gitSidebar).not.toMatch(/openTab\(\{\s*type:\s*'git-diff'/);
  });

  it('keeps editor/tabbar routing on shared resolver and parser', async () => {
    const editor = await read('src/renderer/components/Editor/Editor.tsx');
    const tabBar = await read('src/renderer/components/TabBar/TabBar.tsx');

    expect(editor).toContain('resolveEditorRoute(activeTab)');
    expect(editor).not.toContain("activeTab?.type === 'settings'");
    expect(editor).not.toContain("activeTab?.type === 'git-diff'");

    expect(tabBar).toContain('parseGitDiffTabId(');
    expect(tabBar).not.toContain('getCommitHashFromGitDiffTabId');
    expect(tabBar).not.toContain('getGitDiffResource(');
  });

  it('keeps post creation on shared create-and-focus helper', async () => {
    const app = await read('src/renderer/App.tsx');
    const sidebar = await read('src/renderer/components/Sidebar/Sidebar.tsx');

    expect(app).toContain('createAndFocusPost(');
    expect(sidebar).toContain('createAndFocusPost(');

    expect(app).not.toMatch(/menu:newPost[\s\S]*window\.electronAPI\?\.posts\.create\(\{/);
    expect(sidebar).not.toMatch(/handleCreatePost[\s\S]*window\.electronAPI\?\.posts\.create\(\{/);
  });
});
