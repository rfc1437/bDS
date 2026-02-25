import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('assistant sidebar guard rails', () => {
  it('keeps assistant sidebar self-contained and avoids opening chat tabs directly', async () => {
    const sidebar = await read('src/renderer/components/AssistantSidebar/AssistantSidebar.tsx');

    expect(sidebar).not.toContain('openChatTab(');
    expect(sidebar).not.toContain("type: 'chat'");
  });

  it('renders extended widget branches for assistant panel', async () => {
    const controls = await read('src/renderer/components/AssistantPanelControls/AssistantPanelControls.tsx');
    const sidebar = await read('src/renderer/components/AssistantSidebar/AssistantSidebar.tsx');

    expect(controls).toContain("element.type === 'chart'");
    expect(controls).toContain("element.type === 'form'");
    expect(controls).toContain("element.type === 'datePicker'");
    expect(controls).toContain("element.type === 'card'");
    expect(controls).toContain("element.type === 'image'");
    expect(controls).toContain("element.type === 'tabs'");
    expect(controls).toContain("element.type === 'input'");
    expect(sidebar).toContain('<AssistantPanelControls');
  });

  it('persists assistant action feedback events to chat history', async () => {
    const sidebar = await read('src/renderer/components/AssistantSidebar/AssistantSidebar.tsx');

    expect(sidebar).toContain('chat.addSystemEvent');
  });
});
