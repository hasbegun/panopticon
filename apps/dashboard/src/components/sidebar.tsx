'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Eye, Activity, Network, Shield, Bell, Settings, LayoutDashboard, GitCompare } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: '1' },
  { href: '/traces', label: 'Traces', icon: Eye, shortcut: '2' },
  { href: '/live', label: 'Live', icon: Activity, shortcut: '3' },
  { href: '/topology', label: 'Topology', icon: Network, shortcut: '4' },
  { href: '/compare', label: 'Compare', icon: GitCompare, shortcut: '5' },
  { href: '/security', label: 'Security', icon: Shield, shortcut: '6' },
  { href: '/alerts', label: 'Alerts', icon: Bell, shortcut: '7' },
  { href: '/settings', label: 'Settings', icon: Settings, shortcut: '8' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // Keyboard shortcuts: Cmd/Ctrl + 1-8 for nav
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= navItems.length) {
        e.preventDefault();
        router.push(navItems[idx - 1].href);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Eye className="h-5 w-5 text-primary" />
        <span className="text-lg font-bold">Panopticon</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              <kbd className="hidden text-[10px] text-muted-foreground/50 lg:inline">⌘{item.shortcut}</kbd>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-border p-4">
        <p className="text-xs text-muted-foreground">v0.1.0</p>
        <ThemeToggle />
      </div>
    </aside>
  );
}
