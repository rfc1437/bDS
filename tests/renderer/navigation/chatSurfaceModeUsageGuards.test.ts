import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('chat surface mode usage guards', () => {
  it('uses shared mode config in both chat surfaces', async () => {
    const chatPanel = await read('src/renderer/components/ChatPanel/ChatPanel.tsx');
    const assistantSidebar = await read('src/renderer/components/AssistantSidebar/AssistantSidebar.tsx');

    expect(chatPanel).toContain('getChatSurfaceMode(');
    expect(assistantSidebar).toContain('getChatSurfaceMode(');

    expect(chatPanel).toContain('showModelSelector');
    expect(chatPanel).toContain('showWelcomeTips');
    expect(assistantSidebar).toContain('showWelcomeTips');
    expect(assistantSidebar).toContain('showToolMarkers');
  });
});
