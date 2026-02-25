import { describe, expect, it } from 'vitest';
import { CapabilityRegistryService } from '../../../../src/main/agentic/capabilities/registry';

describe('CapabilityRegistryService', () => {
  it('returns per-surface capability differences', () => {
    const registry = new CapabilityRegistryService();

    const tabCapabilities = registry.getSnapshot({ surface: 'tab' });
    const sidebarCapabilities = registry.getSnapshot({ surface: 'sidebar' });

    expect(tabCapabilities.widgets).toContain('tabs');
    expect(sidebarCapabilities.widgets).toContain('tabs');
    expect(tabCapabilities.actions).toContain('toggleSidebar');
    expect(sidebarCapabilities.actions).toContain('toggleAssistantSidebar');
    expect(tabCapabilities.actions).not.toContain('toggleAssistantSidebar');
  });

  it('omits disabled capabilities from active lists', () => {
    const registry = new CapabilityRegistryService({
      disabledActions: ['openSettings'],
      disabledWidgets: ['chart'],
      disabledTools: ['view_image'],
    });

    const snapshot = registry.getSnapshot({ surface: 'tab' });

    expect(snapshot.actions).not.toContain('openSettings');
    expect(snapshot.widgets).not.toContain('chart');
    expect(snapshot.tools).not.toContain('view_image');
    expect(snapshot.disabled).toEqual(expect.arrayContaining(['action:openSettings', 'widget:chart', 'tool:view_image']));
  });
});
