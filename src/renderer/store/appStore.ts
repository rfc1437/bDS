import { create } from 'zustand';

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
  
  // Data
  posts: PostData[];
  media: MediaData[];
  tasks: TaskProgress[];
  
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
  
  setPosts: (posts: PostData[]) => void;
  addPost: (post: PostData) => void;
  updatePost: (id: string, post: Partial<PostData>) => void;
  removePost: (id: string) => void;
  
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

export const useAppStore = create<AppState>((set) => ({
  // Initial Project State
  projects: [],
  activeProject: null,
  
  // Initial UI State
  activeView: 'posts',
  sidebarVisible: true,
  panelVisible: false,
  selectedPostId: null,
  selectedMediaId: null,
  
  // Initial Data
  posts: [],
  media: [],
  tasks: [],
  
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
  
  // Post Actions
  setPosts: (posts) => set({ posts }),
  addPost: (post) => set((state) => ({ posts: [...state.posts, post] })),
  updatePost: (id, updatedPost) => set((state) => ({
    posts: state.posts.map((p) => (p.id === id ? { ...p, ...updatedPost } : p)),
  })),
  removePost: (id) => set((state) => ({
    posts: state.posts.filter((p) => p.id !== id),
    selectedPostId: state.selectedPostId === id ? null : state.selectedPostId,
  })),
  
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
  updateTask: (taskId, task) => set((state) => ({
    tasks: state.tasks.map((t) => (t.taskId === taskId ? { ...t, ...task } : t)),
  })),
  
  // Sync Actions
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setSyncConfigured: (syncConfigured) => set({ syncConfigured }),
  setPendingChanges: (pendingChanges) => set({ pendingChanges }),
  
  // Loading Actions
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
