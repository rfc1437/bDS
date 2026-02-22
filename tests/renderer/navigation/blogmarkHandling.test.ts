import { describe, expect, it, vi } from 'vitest';
import { handleBlogmarkCreatedEvent } from '../../../src/renderer/navigation/blogmarkHandling';

describe('handleBlogmarkCreatedEvent', () => {
  it('does not collapse sidebar when already in posts view', () => {
    const setActiveView = vi.fn();
    const toggleSidebar = vi.fn();
    const setSelectedPost = vi.fn();
    const openTab = vi.fn();

    handleBlogmarkCreatedEvent(
      {
        activeView: 'posts',
        sidebarVisible: true,
      },
      {
        id: 'post-1',
      },
      {
        setActiveView,
        toggleSidebar,
        setSelectedPost,
        openTab,
      },
    );

    expect(setActiveView).not.toHaveBeenCalled();
    expect(toggleSidebar).not.toHaveBeenCalled();
    expect(setSelectedPost).toHaveBeenCalledWith('post-1');
    expect(openTab).toHaveBeenCalledTimes(1);
  });

  it('switches to posts view and opens sidebar when needed', () => {
    const setActiveView = vi.fn();
    const toggleSidebar = vi.fn();
    const setSelectedPost = vi.fn();
    const openTab = vi.fn();

    handleBlogmarkCreatedEvent(
      {
        activeView: 'media',
        sidebarVisible: false,
      },
      {
        id: 'post-2',
      },
      {
        setActiveView,
        toggleSidebar,
        setSelectedPost,
        openTab,
      },
    );

    expect(setActiveView).toHaveBeenCalledWith('posts');
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(setSelectedPost).toHaveBeenCalledWith('post-2');
    expect(openTab).toHaveBeenCalledTimes(1);
  });
});
