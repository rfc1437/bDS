import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeleteReference, ConfirmDeleteDetails } from '../components/ConfirmDeleteModal';
import type { SidebarView } from '../navigation/sidebarViewRegistry';
import type {
  ProjectData,
  PostData,
  MediaData,
  TaskProgress,
} from '../../main/shared/electronApi';

// Storage key for persisted state
const STORAGE_KEY = 'bds-app-state';

// Tab types
export type TabType = 'post' | 'media' | 'settings' | 'style' | 'tags' | 'chat' | 'import' | 'metadata-diff' | 'git-diff' | 'documentation' | 'site-validation';

export interface Tab {
  type: TabType;
  id: string;
  isTransient: boolean;
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}

// Types
export type { ProjectData, PostData, MediaData, TaskProgress };

export interface ErrorDetails {
  message: string;
  title?: string;
  stack?: string;
}

// Re-export types from ConfirmDeleteModal for convenience
export type { DeleteReference, ConfirmDeleteDetails };

export type EditorMode = 'wysiwyg' | 'markdown' | 'preview';
export type GitDiffViewStyle = 'inline' | 'side-by-side';
export type PanelTab = 'tasks' | 'output' | 'post-links' | 'git-log';

export interface GitDiffPreferences {
  wordWrap: boolean;
  viewStyle: GitDiffViewStyle;
  hideUnchangedRegions: boolean;
}

// App State Store
interface AppState {
  // Projects
  projects: ProjectData[];
  activeProject: ProjectData | null;
  
  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  
  // UI State
  activeView: SidebarView;
  sidebarVisible: boolean;
  panelVisible: boolean;
  panelActiveTab: PanelTab;
  selectedPostId: string | null;
  selectedMediaId: string | null;
  preferredEditorMode: EditorMode;
  picoTheme: import('../../main/shared/picoThemes').PicoThemeName | undefined;
  gitDiffPreferences: GitDiffPreferences;
  
  // Data
  posts: PostData[];
  media: MediaData[];
  tasks: TaskProgress[];
  
  // Pagination
  hasMorePosts: boolean;
  totalPosts: number;
  
  // Track which posts have unsaved changes (by post ID)
  dirtyPosts: Set<string>;
  
  // Error modal
  errorModal: ErrorDetails | null;

  // Confirm delete modal
  confirmDeleteModal: ConfirmDeleteDetails | null;
  
  // Loading states
  isLoading: boolean;
  error: string | null;

  // Project Actions
  setProjects: (projects: ProjectData[]) => void;
  setActiveProject: (project: ProjectData | null) => void;
  addProject: (project: ProjectData) => void;
  updateProject: (id: string, project: Partial<ProjectData>) => void;
  removeProject: (id: string) => void;
  
  // Tab Actions
  openTab: (tab: { type: TabType; id: string; isTransient: boolean }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  pinTab: (id: string) => void;
  clearTabs: () => void;
  getTabState: () => TabState;
  restoreTabState: (state: TabState) => void;
  
  // Actions
  setActiveView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setPanelActiveTab: (tab: PanelTab) => void;
  setSelectedPost: (id: string | null) => void;
  setSelectedMedia: (id: string | null) => void;
  setPreferredEditorMode: (mode: EditorMode) => void;
  setPicoTheme: (theme: import('../../main/shared/picoThemes').PicoThemeName | undefined) => void;
  setGitDiffPreferences: (preferences: GitDiffPreferences) => void;
  
  setPosts: (posts: PostData[], hasMore?: boolean, total?: number) => void;
  appendPosts: (posts: PostData[], hasMore: boolean) => void;
  addPost: (post: PostData) => void;
  updatePost: (id: string, post: Partial<PostData>) => void;
  removePost: (id: string) => void;
  
  // Dirty tracking
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  isDirty: (id: string) => boolean;
  
  // Error modal actions
  showErrorModal: (error: ErrorDetails) => void;
  hideErrorModal: () => void;

  // Confirm delete modal actions
  showConfirmDeleteModal: (details: ConfirmDeleteDetails) => void;
  hideConfirmDeleteModal: () => void;

  setMedia: (media: MediaData[]) => void;
  addMedia: (media: MediaData) => void;
  updateMedia: (id: string, media: Partial<MediaData>) => void;
  removeMedia: (id: string) => void;
  
  setTasks: (tasks: TaskProgress[]) => void;
  updateTask: (taskId: string, task: Partial<TaskProgress>) => void;
  
  // Loading Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial Project State
      projects: [],
      activeProject: null,
      
      // Initial Tabs State
      tabs: [],
      activeTabId: null,
      
      // Initial UI State
      activeView: 'posts',
      sidebarVisible: true,
      panelVisible: false,
      panelActiveTab: 'tasks',
      selectedPostId: null,
      selectedMediaId: null,
      preferredEditorMode: 'wysiwyg',
      picoTheme: undefined,
      gitDiffPreferences: {
        wordWrap: true,
        viewStyle: 'inline',
        hideUnchangedRegions: false,
      },
      
      // Initial Data
      posts: [],
      media: [],
      tasks: [],
      
      // Pagination
      hasMorePosts: false,
      totalPosts: 0,
      
      // Dirty posts tracking
      dirtyPosts: new Set<string>(),
      
      // Error modal
      errorModal: null,

      // Confirm delete modal
      confirmDeleteModal: null,
      
      // Initial Loading State
      isLoading: false,
      error: null,

      // Project Actions
      setProjects: (projects) => set({ projects }),
      setActiveProject: (activeProject) => set({ activeProject }),
      addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),
      updateProject: (id, updatedProject) => set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? { ...p, ...updatedProject } : p)),
      })),
      removeProject: (id) => set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
      })),
      
      // Tab Actions
      openTab: ({ type, id, isTransient }) => set((state) => {
        const existingTabIndex = state.tabs.findIndex((t) => t.id === id && t.type === type);
        
        if (existingTabIndex >= 0) {
          // Tab already exists - if trying to pin (isTransient=false), update it
          if (!isTransient) {
            const updatedTabs = [...state.tabs];
            updatedTabs[existingTabIndex] = { ...updatedTabs[existingTabIndex], isTransient: false };
            return { tabs: updatedTabs, activeTabId: id };
          }
          // Just switch to the existing tab
          return { activeTabId: id };
        }
        
        // If opening as transient, replace existing transient tab of the same type
        if (isTransient) {
          const transientIndex = state.tabs.findIndex((t) => t.isTransient && t.type === type);
          if (transientIndex >= 0) {
            const updatedTabs = [...state.tabs];
            updatedTabs[transientIndex] = { type, id, isTransient: true };
            return { tabs: updatedTabs, activeTabId: id };
          }
        }
        
        // Add new tab
        const newTab: Tab = { type, id, isTransient };
        return { tabs: [...state.tabs, newTab], activeTabId: id };
      }),
      
      closeTab: (id) => set((state) => {
        const tabIndex = state.tabs.findIndex((t) => t.id === id);
        if (tabIndex === -1) return state;
        
        const newTabs = state.tabs.filter((t) => t.id !== id);
        let newActiveTabId = state.activeTabId;
        
        // If closing the active tab, activate an adjacent tab
        if (state.activeTabId === id) {
          if (newTabs.length === 0) {
            newActiveTabId = null;
          } else if (tabIndex < newTabs.length) {
            // Activate the tab that moved into this position (next tab)
            newActiveTabId = newTabs[tabIndex].id;
          } else {
            // Activate the previous tab
            newActiveTabId = newTabs[newTabs.length - 1].id;
          }
        }
        
        return { tabs: newTabs, activeTabId: newActiveTabId };
      }),
      
      setActiveTab: (id) => set((state) => {
        // Only set if the tab exists
        const tabExists = state.tabs.some((t) => t.id === id);
        if (!tabExists) return state;
        return { activeTabId: id };
      }),
      
      pinTab: (id) => set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, isTransient: false } : t)),
      })),
      
      clearTabs: () => set({ tabs: [], activeTabId: null }),
      
      getTabState: () => {
        const state = get();
        return { tabs: state.tabs, activeTabId: state.activeTabId };
      },
      
      restoreTabState: (tabState) => set({ 
        tabs: tabState.tabs, 
        activeTabId: tabState.activeTabId 
      }),
      
      // UI Actions
      setActiveView: (view) => set({ activeView: view }),
      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
      setPanelActiveTab: (panelActiveTab) => set({ panelActiveTab }),
      setSelectedPost: (id) => set({ selectedPostId: id }),
      setSelectedMedia: (id) => set({ selectedMediaId: id }),
      setPreferredEditorMode: (mode) => set({ preferredEditorMode: mode }),
      setPicoTheme: (theme) => set({ picoTheme: theme }),
      setGitDiffPreferences: (preferences) => set({ gitDiffPreferences: preferences }),
      
      // Post Actions
      setPosts: (posts, hasMore = false, total = 0) => set({ posts, hasMorePosts: hasMore, totalPosts: total }),
      appendPosts: (newPosts, hasMore) => set((state) => {
        const existingIds = new Set(state.posts.map(p => p.id));
        const uniqueNewPosts = newPosts.filter(p => !existingIds.has(p.id));
        return {
          posts: [...state.posts, ...uniqueNewPosts],
          hasMorePosts: hasMore,
        };
      }),
      addPost: (post) => set((state) => {
        if (state.posts.some(p => p.id === post.id)) return state;
        return { posts: [post, ...state.posts], totalPosts: state.totalPosts + 1 };
      }),
      updatePost: (id, updatedPost) => set((state) => ({
        posts: state.posts.map((p) => (p.id === id ? { ...p, ...updatedPost } : p)),
      })),
      removePost: (id) => set((state) => {
        const newDirtyPosts = new Set(state.dirtyPosts);
        newDirtyPosts.delete(id);
        return {
          posts: state.posts.filter((p) => p.id !== id),
          dirtyPosts: newDirtyPosts,
          selectedPostId: state.selectedPostId === id ? null : state.selectedPostId,
        };
      }),
      
      // Dirty tracking
      markDirty: (id) => set((state) => ({
        dirtyPosts: new Set([...state.dirtyPosts, id]),
      })),
      
      markClean: (id) => set((state) => {
        const newDirtyPosts = new Set(state.dirtyPosts);
        newDirtyPosts.delete(id);
        return { dirtyPosts: newDirtyPosts };
      }),
      
      isDirty: (id) => get().dirtyPosts.has(id),
      
      // Error modal actions
      showErrorModal: (error) => set({ errorModal: error }),
      hideErrorModal: () => set({ errorModal: null }),

      // Confirm delete modal actions
      showConfirmDeleteModal: (details) => set({ confirmDeleteModal: details }),
      hideConfirmDeleteModal: () => set({ confirmDeleteModal: null }),

      // Media Actions
      setMedia: (media) => set({ media }),
      addMedia: (media) => set((state) => ({ media: [...state.media, media] })),
      updateMedia: (id, updatedMedia) => set((state) => ({
        media: state.media.map((m) => (m.id === id ? { ...m, ...updatedMedia } : m)),
      })),
      removeMedia: (id) => set((state) => ({
        media: state.media.filter((m) => m.id !== id),
        selectedMediaId: state.selectedMediaId === id ? null : state.selectedMediaId,
      })),
      
      // Task Actions
      setTasks: (tasks) => set({ tasks }),
      updateTask: (taskId, task) => set((state) => {
        const exists = state.tasks.some((t) => t.taskId === taskId);
        if (exists) {
          return { tasks: state.tasks.map((t) => (t.taskId === taskId ? { ...t, ...task } : t)) };
        }
        // Add new task if it doesn't exist yet
        return { tasks: [...state.tasks, { taskId, name: '', status: 'running', progress: 0, message: '', startTime: new Date().toISOString(), ...task } as TaskProgress] };
      }),
      
      // Loading Actions
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
    }),
    {
      name: STORAGE_KEY,
      // Only persist UI state, not data (which is loaded from backend)
      partialize: (state) => ({
        activeView: state.activeView,
        sidebarVisible: state.sidebarVisible,
        panelVisible: state.panelVisible,
        panelActiveTab: state.panelActiveTab,
        selectedPostId: state.selectedPostId,
        selectedMediaId: state.selectedMediaId,
        preferredEditorMode: state.preferredEditorMode,
        picoTheme: state.picoTheme,
        gitDiffPreferences: state.gitDiffPreferences,
        // Tabs are persisted here for now (project-specific persistence handled separately)
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        // Convert Set to array for storage
        dirtyPosts: [...state.dirtyPosts],
      }),
      // Merge function to restore Set from array
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppState> & { dirtyPosts?: string[]; tabs?: Tab[] };
        return {
          ...current,
          ...persistedState,
          tabs: persistedState.tabs || [],
          activeTabId: persistedState.activeTabId || null,
          panelActiveTab: persistedState.panelActiveTab || current.panelActiveTab,
          dirtyPosts: new Set(persistedState.dirtyPosts || []),
          picoTheme: persistedState.picoTheme || current.picoTheme,
          gitDiffPreferences: persistedState.gitDiffPreferences || current.gitDiffPreferences,
        };
      },
    }
  )
);
