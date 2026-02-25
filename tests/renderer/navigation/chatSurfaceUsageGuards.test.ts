import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('chat surface shared usage guards', () => {
  it('uses shared chat surface state hook and transcript renderer in both surfaces', async () => {
    const chatPanel = await read('src/renderer/components/ChatPanel/ChatPanel.tsx');
    const assistantSidebar = await read('src/renderer/components/AssistantSidebar/AssistantSidebar.tsx');

    expect(chatPanel).toContain('useChatSurfaceState(');
    expect(chatPanel).toContain('<ChatTranscript');
    expect(chatPanel).toContain('<AssistantPanelControls');
    expect(chatPanel).toContain('extractAssistantResponseContent(');

    expect(assistantSidebar).toContain('useChatSurfaceState(');
    expect(assistantSidebar).toContain('<ChatTranscript');
    expect(assistantSidebar).toContain('<AssistantPanelControls');
  });
});
