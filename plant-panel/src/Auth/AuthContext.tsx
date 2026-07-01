import { createContext, useContext, useState, useCallback } from 'react';
import React from "react"

// ════════════════════════════════════════════════════════════════════════
// Auth context — CLIENT-SIDE ONLY, hardcoded credentials.
//
// IMPORTANT — read before relying on this for anything real:
// This is a UI gate, not real security. The username/password check happens
// entirely in the browser (see ADMIN_USERNAME / ADMIN_PASSWORD below), so
// anyone can read them out of the shipped JS bundle, open devtools and flip
// localStorage directly, or just call setAuthed(true) from the console.
// There is no server-side verification here — the backend's real
// POST /admin/login endpoint (adminLogin controller) is NOT called by this
// flow. This is meant as a placeholder speed-bump per explicit request, not
// as access control. Swap in a real API-backed session (e.g. a token from
// POST /admin/login stored and checked server-side on every request) before
// this app holds anything that actually needs protecting.
// ════════════════════════════════════════════════════════════════════════

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '123';

const STORAGE_KEY = 'plant-attendance-auth';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredAuth(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // localStorage can throw in some environments (privacy mode, disabled
    // storage, etc.) — fail closed rather than crash the app.
    return false;
  }
}

function writeStoredAuth(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, 'true');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore — if storage isn't available, auth simply won't persist across
    // reloads, which is a soft degradation rather than a crash.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => readStoredAuth());

  const login = useCallback((username: string, password: string): boolean => {
    const trimmedUsername = username.trim();
    const ok = trimmedUsername === ADMIN_USERNAME && password === ADMIN_PASSWORD;
    if (ok) {
      setIsAuthenticated(true);
      writeStoredAuth(true);
    }
    return ok;
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    writeStoredAuth(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}