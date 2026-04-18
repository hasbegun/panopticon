'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface ProjectConfig {
  projectId: string;
  apiKey: string;
}

interface ProjectContextValue extends ProjectConfig {
  setProject: (cfg: ProjectConfig) => void;
  isConfigured: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'panopticon_project';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ProjectConfig>({ projectId: '', apiKey: '' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setConfig(JSON.parse(saved));
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  const setProject = (cfg: ProjectConfig) => {
    setConfig(cfg);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  };

  if (!loaded) return null;

  return (
    <ProjectContext.Provider
      value={{ ...config, setProject, isConfigured: !!config.projectId && !!config.apiKey }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
