'use client';

import { useState } from 'react';
import { useProject } from '@/lib/store';

export function ProjectSetupBanner() {
  const { isConfigured, setProject } = useProject();
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');

  if (isConfigured) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-6">
      <h2 className="text-lg font-semibold">Connect to a Project</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your project ID and API key to start viewing traces.
      </p>
      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Project ID</label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. seed"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pan_..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={() => {
            if (projectId && apiKey) setProject({ projectId, apiKey });
          }}
          disabled={!projectId || !apiKey}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Connect
        </button>
      </div>
    </div>
  );
}
