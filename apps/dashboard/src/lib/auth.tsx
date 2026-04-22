'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authMe, authLogin, authRegister, type AuthUser, type Membership } from '@/lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  memberships: Membership[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'panopticon_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) {
      setLoading(false);
      return;
    }

    authMe(saved)
      .then((r) => {
        setUser(r.data.user);
        setToken(saved);
        setMemberships(r.data.memberships);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authLogin(email, password);
    setUser(r.data.user);
    setToken(r.data.token);
    localStorage.setItem(TOKEN_KEY, r.data.token);
    // Fetch memberships
    const me = await authMe(r.data.token);
    setMemberships(me.data.memberships);
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const r = await authRegister(email, password, name);
    setUser(r.data.user);
    setToken(r.data.token);
    localStorage.setItem(TOKEN_KEY, r.data.token);
    setMemberships([]);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setMemberships([]);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, memberships, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
