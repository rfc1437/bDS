import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Storage key for persisted state
const STORAGE_KEY = 'bds-app-state';

// Types
export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostData {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags: string[];
  categories: string[];
}

export interface MediaData {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  startTime: string;
  endTime?: string;
  error?: string;
}

export interface ErrorDetails {
  message: string;
  title?: string;
  stack?: string;
}

export type EditorMode = 'wysiwyg' | 'markdown' | 'preview';

// App State Store
interface AppState {
  // Projects
  projects: ProjectData[];
  activeProject: ProjectData | null;
  
  // UI State
  activeView: 'posts' | 'media' | 'settings';
  sidebarVisible: boolean;
  panelVisible: boolean;
  selectedPostId: string | null;
  selectedMediaId: string | null;
  preferredEditorMode: EditorMode;
  
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
  
  // Sync
  syncStatus: 'idle' | 'syncing' | 'error';
  syncConfigured: boolean;
  pendingChanges: { posts: number; media: number };
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Project Actions
  setProjects: (projects: ProjectData[]) => void;
  setActiveProject: (project: ProjectData | null) => void;
  addProject: (project: ProjectData) => void;
  updateProject: (id: string, project: Partial<ProjectData>) => void;
  removeProject: (id: string) => void;
  
  // Actions
  setActiveView: (view: 'posts' | 'media' | 'settings') => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setSelectedPost: (id: string | null) => void;
  setSelectedMedia: (id: string | null) => void;
  setPreferredEditorMode: (mode: EditorMode) => void;
  
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
  
  setMedia: (media: MediaData[]) => void;
  addMedia: (media: MediaData) => void;
  updateMedia: (id: string, media: Partial<MediaData>) => void;
  removeMedia: (id: string) => void;
  
  setTasks: (tasks: TaskProgress[]) => void;
  updateTask: (taskId: string, task: Partial<TaskProgress>) => void;
  
  setSyncStatus: (status: 'idle' | 'syncing' | 'error') => void;
  setSyncConfigured: (configured: boolean) => void;
  setPendingChanges: (changes: { posts: number; media: number }) => void;
  
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial Project State
      projects: [],
      activeProject: null,
      
      // Initial UI State
      activeView: 'posts',
      sidebarVisible: true,
      panelVisible: false,
      selectedPostId: null,
      selectedMediaId: null,
      preferredEditorMode: 'wysiwyg',
      
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
      
      // Initial Sync State
      syncStatus: 'idle',
      syncConfigured: false,
      pendingChanges: { posts: 0, media: 0 },
      
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
      
      // UI Actions
      setActiveView: (view) => set({ activeView: view }),
      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
      setSelectedPost: (id) => set({ selectedPostId: id }),
      setSelectedMedia: (id) => set({ selectedMediaId: id }),
      setPreferredEditorMode: (mode) => set({ preferredEditorMode: mode }),
      
      // Post Actions
      setPosts: (posts, hasMore = false, total = 0) => set({ posts, hasMorePosts: hasMore, totalPosts: total }),
      appendPosts: (newPosts, hasMore) => set((state) => ({
        posts: [...state.posts, ...newPosts],
        hasMorePosts: hasMore,
      })),
      addPost: (post) => set((state) => ({ posts: [post, ...state.posts], totalPosts: state.totalPosts + 1 })),
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
        return { tasks: [...state.tasks, { taskId, status: 'running', progress: 0, message: '', startTime: new Date().toISOString(), ...task } as TaskProgress] };
      }),
      
      // Sync Actions
      setSyncStatus: (syncStatus) => set({ syncStatus }),
      setSyncConfigured: (syncConfigured) => set({ syncConfigured }),
      setPendingChanges: (pendingChanges) => set({ pendingChanges }),
      
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
        selectedPostId: state.selectedPostId,
        selectedMediaId: state.selectedMediaId,
        preferredEditorMode: state.preferredEditorMode,
        // Convert Set to array for storage
        dirtyPosts: [...state.dirtyPosts],
      }),
      // Merge function to restore Set from array
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<AppState> & { dirtyPosts?: string[] };
        return {
          ...current,
          ...persistedState,
          dirtyPosts: new Set(persistedState.dirtyPosts || []),
        };
      },
    }
  )
);
