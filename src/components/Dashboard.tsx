import React, { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  FolderKanban,
  GitBranch,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useCanvasStore } from '../store/useCanvasStore';
import type { OsintProject } from '../types/osint';
import { GlobalSettingsModal } from './GlobalSettingsModal';

export interface DashboardProps {
  onSelectProject: (projectId: string) => void;
}

function formatProjectDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Recently created';
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectProject }) => {
  const projects = useCanvasStore((state) => state.projects);
  const currentProjectId = useCanvasStore((state) => state.currentProjectId);
  const apiKey = useCanvasStore((state) => state.apiKey);
  const createProject = useCanvasStore((state) => state.createProject);
  const deleteProject = useCanvasStore((state) => state.deleteProject);
  const renameProject = useCanvasStore((state) => state.renameProject);
  const loadProject = useCanvasStore((state) => state.loadProject);
  const fetchProjectsFromServer = useCanvasStore(
    (state) => state.fetchProjectsFromServer,
  );

  const [newProjectName, setNewProjectName] = useState('');
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetchProjectsFromServer();
  }, [fetchProjectsFromServer]);

  useEffect(() => {
    if (renamingProjectId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingProjectId]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-project-menu]')) {
        setOpenMenuProjectId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const handleCreateNewProject = () => {
    const fallbackName = `Investigation #${projects.length + 1}`;
    const chosenName = newProjectName.trim() || fallbackName;
    createProject(chosenName);
    setNewProjectName('');
  };

  const handleOpenProjectCard = (project: OsintProject) => {
    if (renamingProjectId === project.id) return;
    loadProject(project.id);
    onSelectProject(project.id);
  };

  const handleStartRename = (
    event: React.MouseEvent,
    project: OsintProject,
  ) => {
    event.stopPropagation();
    setOpenMenuProjectId(null);
    setRenamingProjectId(project.id);
    setRenameDraft(project.name);
  };

  const handleCommitRename = (projectId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      renameProject(projectId, trimmed);
    }
    setRenamingProjectId(null);
    setRenameDraft('');
  };

  const handleCancelRename = () => {
    setRenamingProjectId(null);
    setRenameDraft('');
  };

  const handleDeleteProject = (
    event: React.MouseEvent,
    projectId: string,
  ) => {
    event.stopPropagation();
    setOpenMenuProjectId(null);
    if (renamingProjectId === projectId) {
      setRenamingProjectId(null);
    }
    deleteProject(projectId);
  };

  return (
    <div
      data-testid="dashboard-view"
      className="min-h-screen w-full bg-[#f8f9fa] text-neutral-900 font-sans"
    >
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white shadow-2xs">
              <Workflow className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-neutral-900">
                  Traceboard
                </h1>
                <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  Projects
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateNewProject();
                }
              }}
              placeholder="Project name (optional)..."
              aria-label="New project name"
              data-testid="new-project-name-input"
              className="hidden sm:block w-52 rounded-lg border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs text-neutral-800 placeholder:text-neutral-400 transition-colors focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCreateNewProject}
              data-testid="new-project-btn"
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Project</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Global Settings"
              title="Global AI & API Key Settings"
              data-testid="dashboard-settings-btn"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
            >
              <Settings className="h-4 w-4" />
              {apiKey.trim() && (
                <span
                  aria-label="API key configured"
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
                />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              All Investigations
            </h2>
          </div>
          <span
            data-testid="dashboard-project-count"
            className="text-xs font-medium text-neutral-500"
          >
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        </div>

        {projects.length === 0 ? (
          /* Centered Empty State */
          <div
            data-testid="dashboard-empty-state"
            className="flex min-h-[380px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-600">
              <FolderKanban className="h-5 w-5" />
            </div>
            <p className="max-w-md text-sm font-medium text-neutral-700">
              No projects yet. Create one to start your OSINT investigation.
            </p>
            <button
              type="button"
              onClick={handleCreateNewProject}
              data-testid="empty-state-new-project-btn"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-neutral-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Project</span>
            </button>
          </div>
        ) : (
          /* Project Cards Grid */
          <div
            data-testid="projects-grid"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {projects.map((project) => {
              const isRenaming = renamingProjectId === project.id;
              const isMenuOpen = openMenuProjectId === project.id;
              const isCurrent = currentProjectId === project.id;

              return (
                <div
                  key={project.id}
                  data-testid={`project-card-${project.id}`}
                  onClick={() => handleOpenProjectCard(project)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (
                      !isRenaming &&
                      (e.key === 'Enter' || e.key === ' ')
                    ) {
                      e.preventDefault();
                      handleOpenProjectCard(project);
                    }
                  }}
                  className={`group relative flex flex-col justify-between rounded-xl border bg-white p-5 text-left transition-all hover:border-neutral-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer ${
                    isCurrent
                      ? 'border-neutral-300 shadow-xs'
                      : 'border-neutral-200/90 shadow-2xs'
                  }`}
                >
                  <div>
                    {/* Top row: Preview icon & Three-dot menu */}
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div
                        data-testid={`project-preview-icon-${project.id}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200/80 bg-neutral-50 text-neutral-700 transition-colors group-hover:border-neutral-300 group-hover:bg-neutral-100"
                      >
                        <Workflow className="h-4 w-4" />
                      </div>

                      <div
                        className="relative"
                        data-project-menu
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={`Actions for ${project.name}`}
                          data-testid={`project-menu-btn-${project.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuProjectId((prev) =>
                              prev === project.id ? null : project.id,
                            );
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>

                        {isMenuOpen && (
                          <div
                            data-testid={`project-menu-dropdown-${project.id}`}
                            className="absolute right-0 top-9 z-30 w-36 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
                          >
                            <button
                              type="button"
                              data-testid={`project-rename-option-${project.id}`}
                              onClick={(e) => handleStartRename(e, project)}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5 text-neutral-500" />
                              <span>Rename</span>
                            </button>
                            <button
                              type="button"
                              data-testid={`project-delete-option-${project.id}`}
                              onClick={(e) => handleDeleteProject(e, project.id)}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Project Name or Inline Rename Form */}
                    {isRenaming ? (
                      <div
                        className="mb-2 flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameDraft}
                          aria-label="Rename project input"
                          data-testid={`project-rename-input-${project.id}`}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCommitRename(project.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm font-semibold text-neutral-900 focus:border-neutral-900 focus:outline-none"
                        />
                        <button
                          type="button"
                          aria-label="Save project name"
                          data-testid={`project-rename-save-${project.id}`}
                          onClick={() => handleCommitRename(project.id)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel rename"
                          onClick={handleCancelRename}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100 cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <h3
                        data-testid={`project-name-${project.id}`}
                        className="mb-1.5 truncate text-sm font-semibold text-neutral-900 group-hover:text-black"
                      >
                        {project.name}
                      </h3>
                    )}

                    {/* Created Date */}
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                      <span data-testid={`project-date-${project.id}`}>
                        Created {formatProjectDate(project.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Card Footer: Graph Summary */}
                  <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-neutral-400" />
                        {project.nodeCount ?? project.nodes.length}{' '}
                        {(project.nodeCount ?? project.nodes.length) === 1
                          ? 'node'
                          : 'nodes'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="h-3.5 w-3.5 text-neutral-400" />
                        {project.edgeCount ?? project.edges.length}{' '}
                        {(project.edgeCount ?? project.edges.length) === 1
                          ? 'edge'
                          : 'edges'}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-neutral-700 opacity-0 transition-opacity group-hover:opacity-100">
                      Open canvas →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <GlobalSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
