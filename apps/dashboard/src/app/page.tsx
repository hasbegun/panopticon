'use client';

import { useEffect, useState } from 'react';
import { Activity, Eye, Shield, Cpu, Clock, AlertTriangle } from 'lucide-react';
import { useProject } from '@/lib/store';
import { fetchMetrics, type Metrics } from '@/lib/api';
import { ProjectSetupBanner } from '@/components/project-setup';

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-3xl font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    fetchMetrics(apiKey, projectId)
      .then((r) => setMetrics(r.data))
      .catch((e) => setError(e.message));
  }, [apiKey, projectId, isConfigured]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          AI Agent & MCP Observability Overview
        </p>
      </div>

      <ProjectSetupBanner />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Traces"
          value={metrics?.unique_traces ?? '—'}
          subtitle="Last 24h"
          icon={Activity}
        />
        <StatCard
          title="Total Spans"
          value={metrics?.total_spans ?? '—'}
          subtitle="Last 24h"
          icon={Eye}
        />
        <StatCard
          title="Agents"
          value={metrics?.unique_agents ?? '—'}
          subtitle="Active"
          icon={Cpu}
        />
        <StatCard
          title="Error Rate"
          value={metrics ? `${metrics.error_rate}%` : '—'}
          subtitle={metrics ? `${metrics.error_count} errors` : 'Last 24h'}
          icon={AlertTriangle}
        />
        <StatCard
          title="Avg Latency"
          value={metrics ? `${Math.round(metrics.avg_duration_ms)}ms` : '—'}
          subtitle={metrics ? `P95: ${Math.round(metrics.p95_duration_ms)}ms` : 'Last 24h'}
          icon={Clock}
        />
        <StatCard
          title="P99 Latency"
          value={metrics ? `${Math.round(metrics.p99_duration_ms)}ms` : '—'}
          subtitle={metrics ? `P50: ${Math.round(metrics.p50_duration_ms)}ms` : 'Last 24h'}
          icon={Shield}
        />
      </div>

      {!isConfigured && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Getting Started</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>
              1. Create a project via{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">POST /v1/projects</code>
            </p>
            <p>
              2. Install the SDK:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">npm install @panopticon/sdk</code>
            </p>
            <p>3. Enter your project ID and API key above to connect</p>
          </div>
        </div>
      )}
    </div>
  );
}
