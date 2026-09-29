import { createContext, useContext, useState, useCallback } from 'react';
import React from 'react';
import { apiUrl } from './apiconfig';

// ════════════════════════════════════════════════════════════════════════
// Auth context — backend-verified, but still NOT real security.
//
// Credentials are checked server-side now (POST /portal-users/login), so
// this is no longer the hardcoded-in-JS admin/123 gate it used to be.
// However, per explicit request there is still no token/session: a
// successful login just gets the user's profile back from the server, and
// that profile (including allowedScreens) is trusted and stored as-is in
// localStorage. Nothing re-verifies it on later requests. Anyone who can
// write to localStorage can still grant themselves access to any screen,
// or flip isSuper to true, from devtools. This is a UI-level speed bump
// for an internal tool, not access control against a hostile client.
//
// If this app ever needs to hold something that actually matters, the
// missing piece is: issue a server-signed session/token on login, and have
// every subsequent request (including screen access) re-checked against
// that token server-side, rather than trusting a client-stored profile.
// ════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'plant-attendance-auth';

// Matches the backend's sanitize() shape in portalUser.controller.ts —
// keep these in sync if that shape changes.
export interface PortalUserProfile {
  id: string;
  username: string;
  displayName: string;
  isSuper: boolean;
  allowedScreens: string[];
}

interface AuthContextValue {
  isAuthenticated: boolean;
  user: PortalUserProfile | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  /** True if the user can see this screen key — always true for isSuper. */
  canAccessScreen: (screenKey: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): PortalUserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Minimal shape check — if this doesn't look like a profile, fail
    // closed rather than trust a malformed/tampered value.
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.username === 'string' &&
      typeof parsed.isSuper === 'boolean' &&
      Array.isArray(parsed.allowedScreens)
    ) {
      return parsed as PortalUserProfile;
    }
    return null;
  } catch {
    // localStorage can throw in some environments (privacy mode, disabled
    // storage, etc.) — fail closed rather than crash the app.
    return null;
  }
}

function writeStoredUser(user: PortalUserProfile | null): void {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore — if storage isn't available, auth simply won't persist across
    // reloads, which is a soft degradation rather than a crash.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalUserProfile | null>(() => readStoredUser());

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch(apiUrl('/portal-users/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? 'Invalid username or password' };
      }

      const body = await res.json();
      setUser(body.user);
      writeStoredUser(body.user);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not reach the server. Please try again.' };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    writeStoredUser(null);
  }, []);

  const canAccessScreen = useCallback(
    (screenKey: string) => {
      if (!user) return false;
      if (user.isSuper) return true;
      return user.allowedScreens.includes(screenKey);
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: user !== null, user, login, logout, canAccessScreen }}
    >
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