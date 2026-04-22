'use client';

import { useEffect, useState } from 'react';
import {
  Activity, Eye, Shield, Cpu, Clock, AlertTriangle, TrendingUp,
} from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useProject } from '@/lib/store';
import { fetchMetrics, fetchTimeseries, type Metrics, type TimeseriesBucket } from '@/lib/api';
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

function formatBucketDay(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return ts;
  }
}

export default function DashboardPage() {
  const { apiKey, projectId, isConfigured } = useProject();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trend, setTrend] = useState<TimeseriesBucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    fetchMetrics(apiKey, projectId)
      .then((r) => setMetrics(r.data))
      .catch((e) => setError(e.message));
    // 7-day trend with 6-hour buckets
    fetchTimeseries(apiKey, projectId, 10080, 360)
      .then((r) => setTrend(r.data))
      .catch(() => {});
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

      {/* 7-Day Performance Trends */}
      {isConfigured && trend.length > 0 && (
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <TrendingUp className="h-5 w-5 text-primary" /> 7-Day Trends
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Throughput trend */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-primary" /> Throughput
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trend.map((b) => ({ time: formatBucketDay(b.bucket), spans: Number(b.span_count), traces: Number(b.trace_count) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="spans" name="Spans" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="traces" name="Traces" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Error rate trend */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-red-400" /> Error Rate
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={trend.map((b) => ({ time: formatBucketDay(b.bucket), errors: Number(b.error_count), rate: Number(b.span_count) > 0 ? ((Number(b.error_count) / Number(b.span_count)) * 100).toFixed(1) : 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="rate" name="Error %" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Latency trend */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-amber-400" /> Latency (ms)
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={trend.map((b) => ({ time: formatBucketDay(b.bucket), avg: b.avg_duration_ms, p95: b.p95_duration_ms }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="avg" name="Avg" stroke="hsl(var(--primary))" dot={false} />
                  <Line type="monotone" dataKey="p95" name="P95" stroke="#f59e0b" dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

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
