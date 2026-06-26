import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, setToken } from '../api/client';
import type { AuthResult } from '../api/types';

const SESSION_KEY = 'qtm.session';

interface Session {
  email: string;
  displayName: string;
  roles: string[];
}

interface AuthContextValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);

  async function login(email: string, password: string) {
    const result = await api.post<AuthResult>('/auth/login', { email, password });
    setToken(result.token);
    const s: Session = { email: result.email, displayName: result.displayName, roles: result.roles };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }

  function logout() {
    setToken(null);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  function hasRole(...roles: string[]) {
    return !!session && roles.some((r) => session.roles.includes(r));
  }

  const isManager = hasRole('Admin', 'ProjectManager');

  return (
    <AuthContext.Provider value={{ session, login, logout, hasRole, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
