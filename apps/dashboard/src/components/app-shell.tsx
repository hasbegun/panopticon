'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/lib/auth';
import { useProject } from '@/lib/store';
import { Loader2 } from 'lucide-react';

const PUBLIC_PATHS = ['/login'];

/**
 * AppShell handles the auth gate.
 * Access is granted if EITHER:
 *   1. User is authenticated via JWT (new RBAC flow), OR
 *   2. Project is configured via API key (legacy flow — backward compatible)
 * Only redirects to /login if neither is available.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isConfigured } = useProject();
  const pathname = usePathname();

  // Show loading spinner while restoring session
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Public pages (login) render without sidebar
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  // Allow access via JWT auth OR legacy API-key mode
  const hasAccess = !!user || isConfigured;

  if (!hasAccess) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Authenticated layout
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
