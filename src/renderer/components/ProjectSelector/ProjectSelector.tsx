import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, ProjectData, PostData, MediaData, TabState } from '../../store';
import { showToast } from '../Toast';
import './ProjectSelector.css';

// Helper functions for project-specific tab persistence
const TAB_STATE_PREFIX = 'bds-tabs-';

const saveTabsForProject = (projectId: string, tabState: TabState): void => {
  try {
    localStorage.setItem(`${TAB_STATE_PREFIX}${projectId}`, JSON.stringify(tabState));
  } catch (error) {
    console.error('Failed to save tab state:', error);
  }
};

const loadTabsForProject = (projectId: string): TabState | null => {
  try {
    const stored = localStorage.getItem(`${TAB_STATE_PREFIX}${projectId}`);
    if (stored) {
      return JSON.parse(stored) as TabState;
    }
  } catch (error) {
    console.error('Failed to load tab state:', error);
  }
  return null;
};

export const ProjectSelector: React.FC = () => {
  const { projects, activeProject, setProjects, setActiveProject, setPosts, setMedia, setSelectedPost, setSelectedMedia, removeProject, getTabState, restoreTabState, clearTabs } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectData | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load projects on mount
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const allProjects = await window.electronAPI?.projects.getAll();
        if (allProjects) {
          setProjects(allProjects as ProjectData[]);
        }
        const active = await window.electronAPI?.projects.getActive();
        if (active) {
          setActiveProject(active as ProjectData);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      }
    };
    loadProjects();
  }, [setProjects, setActiveProject]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitchProject = async (project: ProjectData) => {
    if (project.id === activeProject?.id) {
      setIsOpen(false);
      return;
    }

    try {
      // Save current project's tab state before switching
      if (activeProject) {
        const currentTabState = getTabState();
        saveTabsForProject(activeProject.id, currentTabState);
      }
      
      // Clear tabs for the transition
      clearTabs();
      
      const updatedProject = await window.electronAPI?.projects.setActive(project.id);
      if (updatedProject) {
        setActiveProject(updatedProject as ProjectData);
        // Clear current selection and reload data
        setSelectedPost(null);
        setSelectedMedia(null);
        
        // Reload posts and media for new project
        const [postsResult, mediaResult] = await Promise.all([
          window.electronAPI?.posts.getAll({ limit: 500, offset: 0 }),
          window.electronAPI?.media.getAll(),
        ]);
        // posts.getAll returns { items, hasMore, total }
        if (postsResult) {
          const { items, hasMore, total } = postsResult as { items: PostData[]; hasMore: boolean; total: number };
          setPosts(items, hasMore, total);
        }
        if (mediaResult) setMedia(mediaResult as MediaData[]);
        
        // Restore tabs for the new project
        const savedTabState = loadTabsForProject(project.id);
        if (savedTabState) {
          restoreTabState(savedTabState);
        }
        
        showToast.success(`Switched to ${project.name}`);
      }
    } catch (error) {
      console.error('Failed to switch project:', error);
      showToast.error('Failed to switch project');
    }
    setIsOpen(false);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const newProject = await window.electronAPI?.projects.create({
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      });
      if (newProject) {
        setProjects([...projects, newProject as ProjectData]);
        showToast.success(`Created project "${newProjectName}"`);
        setNewProjectName('');
        setNewProjectDescription('');
        setShowCreateModal(false);
        
        // Optionally switch to the new project
        await handleSwitchProject(newProject as ProjectData);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      showToast.error('Failed to create project');
    }
  };

  const openDeleteModal = (e: React.MouseEvent, project: ProjectData) => {
    e.stopPropagation();
    setProjectToDelete(project);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
    setIsOpen(false);
  };

  const handleDeleteProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectToDelete || deleteConfirmText !== projectToDelete.name) return;

    try {
      const success = await window.electronAPI?.projects.deleteWithData(projectToDelete.id);
      if (success) {
        removeProject(projectToDelete.id);
        showToast.success(`Deleted project "${projectToDelete.name}" and all its data`);
        setShowDeleteModal(false);
        setProjectToDelete(null);
        setDeleteConfirmText('');
      } else {
        showToast.error('Failed to delete project');
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      showToast.error('Failed to delete project');
    }
  };

  const canDeleteProject = (project: ProjectData) => {
    // Cannot delete: default project, or the currently active project
    return project.id !== 'default' && project.id !== activeProject?.id;
  };

  return (
    <div className="project-selector" ref={dropdownRef}>
      <button
        className="project-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch project"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="project-icon">
          <path d="M14.5 3H7.71l-.85-.85A.5.5 0 0 0 6.5 2h-5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5zm-13 1h5.29l.85.85c.1.1.23.15.36.15h6.5v9h-13V4z"/>
        </svg>
        <span className="project-name">{activeProject?.name || 'Select Project'}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="dropdown-arrow">
          <path d="M4.5 5.5L8 9l3.5-3.5h-7z"/>
        </svg>
      </button>

      {isOpen && (
        <div className="project-dropdown">
          <div className="project-dropdown-header">
            <span>PROJECTS</span>
          </div>
          <div className="project-list">
            {projects.map(project => (
              <div
                key={project.id}
                className={`project-item ${project.id === activeProject?.id ? 'active' : ''}`}
              >
                <button
                  className="project-item-content"
                  onClick={() => handleSwitchProject(project)}
                >
                  <span className="project-item-name">{project.name}</span>
                  {project.id === activeProject?.id && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="check-icon">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                    </svg>
                  )}
                </button>
                {canDeleteProject(project) && (
                  <button
                    className="project-item-delete"
                    onClick={(e) => openDeleteModal(e, project)}
                    title={`Delete ${project.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/>
                      <path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1h4a1 1 0 011 1h2a1 1 0 011 1h2.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {projects.length === 0 && (
              <div className="project-empty">No projects yet</div>
            )}
          </div>
          <div className="project-dropdown-footer">
            <button className="create-project-btn" onClick={() => { setShowCreateModal(true); setIsOpen(false); }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
              </svg>
              New Project
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Project</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateProject}>
              <div className="modal-body">
                <div className="form-field">
                  <label htmlFor="project-name">Project Name</label>
                  <input
                    id="project-name"
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="My Blog"
                    autoFocus
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="project-description">Description (optional)</label>
                  <textarea
                    id="project-description"
                    value={newProjectDescription}
                    onChange={e => setNewProjectDescription(e.target.value)}
                    placeholder="A brief description of this project..."
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={!newProjectName.trim()}>
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteModal && projectToDelete && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content modal-danger" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Project</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleDeleteProject}>
              <div className="modal-body">
                <p className="delete-warning">
                  This will permanently delete the project <strong>"{projectToDelete.name}"</strong> and all its data including:
                </p>
                <ul className="delete-list">
                  <li>All blog posts</li>
                  <li>All media files</li>
                  <li>All project settings</li>
                </ul>
                <p className="delete-confirm-text">
                  Type <strong>{projectToDelete.name}</strong> to confirm deletion:
                </p>
                <div className="form-field">
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder={projectToDelete.name}
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowDeleteModal(false)}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-danger" 
                  disabled={deleteConfirmText !== projectToDelete.name}
                >
                  Delete Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSelector;
