'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('panopticon-theme');
    if (stored === 'light') {
      setDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('panopticon-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('panopticon-theme', 'light');
    }
  };

  return (
    <button onClick={toggle} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
