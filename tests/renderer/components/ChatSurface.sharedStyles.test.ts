import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Chat surface shared styles', () => {
  const sharedCssPath = path.resolve(
    __dirname,
    '../../../src/renderer/styles/chatSurface.css'
  );
  const chatPanelPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/ChatPanel/ChatPanel.tsx'
  );
  const assistantSidebarPath = path.resolve(
    __dirname,
    '../../../src/renderer/components/AssistantSidebar/AssistantSidebar.tsx'
  );

  it('defines reusable surface primitives', () => {
    const css = fs.readFileSync(sharedCssPath, 'utf8');

    expect(css).toContain('.chat-surface');
    expect(css).toContain('.chat-surface-scroll');
    expect(css).toContain('.chat-surface-input');
    expect(css).toContain('.chat-surface-error');
    expect(css).toContain('.chat-surface-section');
  });

  it('applies shared surface class names in both chat renderers', () => {
    const chatPanel = fs.readFileSync(chatPanelPath, 'utf8');
    const assistantSidebar = fs.readFileSync(assistantSidebarPath, 'utf8');

    expect(chatPanel).toContain('chat-surface');
    expect(chatPanel).toContain('chat-surface-scroll');

    expect(assistantSidebar).toContain('chat-surface');
    expect(assistantSidebar).toContain('chat-surface-input');
    expect(assistantSidebar).toContain('chat-surface-error');
    expect(assistantSidebar).toContain('chat-surface-section');
  });
});
