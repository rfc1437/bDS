import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, ProjectData, PostData, MediaData } from '../../store';
import { loadTabsForProject, saveTabsForProject } from '../../utils';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import './ProjectSelector.css';

export const ProjectSelector: React.FC = () => {
  const { t } = useI18n();
  const { projects, activeProject, setProjects, setActiveProject, setPosts, setMedia, setSelectedPost, setSelectedMedia, removeProject, getTabState, restoreTabState, clearTabs } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectData | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectDataPath, setNewProjectDataPath] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load projects on mount (active project is loaded by App.tsx)
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const allProjects = await window.electronAPI?.projects.getAll();
        if (allProjects) {
          setProjects(allProjects as ProjectData[]);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      }
    };
    loadProjects();
  }, [setProjects]);

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
        
        showToast.success(t('projectSelector.toast.switched', { name: project.name }));
      }
    } catch (error) {
      console.error('Failed to switch project:', error);
      showToast.error(t('projectSelector.toast.switchFailed'));
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
        dataPath: newProjectDataPath || undefined,
      });
      if (newProject) {
        setProjects([...projects, newProject as ProjectData]);
        showToast.success(t('projectSelector.toast.created', { name: newProjectName }));
        setNewProjectName('');
        setNewProjectDescription('');
        setNewProjectDataPath(null);
        setShowCreateModal(false);
        
        // Optionally switch to the new project
        await handleSwitchProject(newProject as ProjectData);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      showToast.error(t('projectSelector.toast.createFailed'));
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selectedPath = await window.electronAPI?.app.selectFolder(t('projectSelector.selectProjectLocation'));
      if (selectedPath) {
        setNewProjectDataPath(selectedPath);
        
        // Check if the folder has existing project metadata
        const existingMetadata = await window.electronAPI?.app.readProjectMetadata(selectedPath);
        if (existingMetadata) {
          // Pre-populate form fields from existing project.json (overwrite if found)
          if (existingMetadata.name) {
            setNewProjectName(existingMetadata.name);
          }
          if (existingMetadata.description) {
            setNewProjectDescription(existingMetadata.description);
          }
          showToast.info(t('projectSelector.toast.existingSettingsFound'));
        }
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
      showToast.error(t('projectSelector.toast.selectFolderFailed'));
    }
  };

  const handleClearFolder = () => {
    setNewProjectDataPath(null);
  };

  const handleCloseCreateModal = () => {
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectDataPath(null);
    setShowCreateModal(false);
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
        showToast.success(t('projectSelector.toast.deletedWithData', { name: projectToDelete.name }));
        setShowDeleteModal(false);
        setProjectToDelete(null);
        setDeleteConfirmText('');
      } else {
        showToast.error(t('projectSelector.toast.deleteFailed'));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      showToast.error(t('projectSelector.toast.deleteFailed'));
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
        title={t('projectSelector.switchProject')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="project-icon">
          <path d="M14.5 3H7.71l-.85-.85A.5.5 0 0 0 6.5 2h-5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5zm-13 1h5.29l.85.85c.1.1.23.15.36.15h6.5v9h-13V4z"/>
        </svg>
        <span className="project-name">{activeProject?.name || t('projectSelector.selectProject')}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="dropdown-arrow">
          <path d="M4.5 5.5L8 9l3.5-3.5h-7z"/>
        </svg>
      </button>

      {isOpen && (
        <div className="project-dropdown">
          <div className="project-dropdown-header">
            <span>{t('projectSelector.projectsHeader')}</span>
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
                    title={t('projectSelector.deleteProjectTitle', { name: project.name })}
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
              <div className="project-empty">{t('projectSelector.noProjectsYet')}</div>
            )}
          </div>
          <div className="project-dropdown-footer">
            <button className="create-project-btn" onClick={() => { setShowCreateModal(true); setIsOpen(false); }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
              </svg>
              {t('projectSelector.newProject')}
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={handleCloseCreateModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('projectSelector.createNewProject')}</h3>
              <button className="modal-close" onClick={handleCloseCreateModal}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateProject}>
              <div className="modal-body">
                <div className="form-field">
                  <label htmlFor="project-name">{t('projectSelector.projectName')}</label>
                  <input
                    id="project-name"
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder={t('projectSelector.projectNamePlaceholder')}
                    autoFocus
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="project-description">{t('projectSelector.descriptionOptional')}</label>
                  <textarea
                    id="project-description"
                    value={newProjectDescription}
                    onChange={e => setNewProjectDescription(e.target.value)}
                    placeholder={t('projectSelector.descriptionPlaceholder')}
                    rows={3}
                  />
                </div>
                <div className="form-field">
                  <label>{t('projectSelector.projectLocation')}</label>
                  <div className="folder-picker">
                    {newProjectDataPath ? (
                      <div className="folder-path-display">
                        <span className="folder-path" title={newProjectDataPath}>{newProjectDataPath}</span>
                        <button type="button" className="btn-icon" onClick={handleClearFolder} title={t('projectSelector.useDefaultLocation')}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="folder-default-info">
                        <span className="default-label">{t('projectSelector.defaultInternalStorage')}</span>
                      </div>
                    )}
                    <button type="button" className="btn-secondary btn-small" onClick={handleSelectFolder}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M14.5 3H7.71l-.85-.85A.5.5 0 0 0 6.5 2h-5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5zm-13 1h5.29l.85.85c.1.1.23.15.36.15h6.5v9h-13V4z"/>
                      </svg>
                      {t('projectSelector.chooseFolder')}
                    </button>
                  </div>
                  <p className="form-hint">
                    {t('projectSelector.projectLocationHint')}
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={handleCloseCreateModal}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-primary" disabled={!newProjectName.trim()}>
                  {t('projectSelector.createProject')}
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
              <h3>{t('projectSelector.deleteProject')}</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                </svg>
              </button>
            </div>
            <form onSubmit={handleDeleteProject}>
              <div className="modal-body">
                <p className="delete-warning">
                  {t('projectSelector.deleteWarning', { name: projectToDelete.name })}
                </p>
                <ul className="delete-list">
                  <li>{t('projectSelector.deleteItemPosts')}</li>
                  <li>{t('projectSelector.deleteItemMedia')}</li>
                  <li>{t('projectSelector.deleteItemSettings')}</li>
                </ul>
                <p className="delete-confirm-text">
                  {t('projectSelector.typeToConfirm', { name: projectToDelete.name })}
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
                  {t('common.cancel')}
                </button>
                <button 
                  type="submit" 
                  className="btn-danger" 
                  disabled={deleteConfirmText !== projectToDelete.name}
                >
                  {t('projectSelector.deleteProject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
