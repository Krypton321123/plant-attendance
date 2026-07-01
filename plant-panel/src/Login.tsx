import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, User, AlertCircle } from 'lucide-react';
import { useAuth } from './Auth/AuthContext';

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: any) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    // Synchronous today (no API call, per current setup) — the isSubmitting
    // state is still here so this is a one-line swap later if login() ever
    // becomes an async call to the backend's real /admin/login endpoint.
    const ok = login(username, password);
    setIsSubmitting(false);

    if (!ok) {
      setError('Incorrect username or password.');
      return;
    }

    const state = location.state as LocationState | null;
    const redirectTo = state?.from?.pathname || '/attendance';
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm">
            <Lock size={18} className="text-zinc-500" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-900 tracking-tight">Plant Attendance</h1>
          <p className="mt-1 text-[13px] text-zinc-400">Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-4 flex flex-col gap-1.5">
            <label htmlFor="username" className="text-[11px] font-medium uppercase tracking-widest text-zinc-400">
              Username
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoFocus
                className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-800 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-zinc-900"
              />
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[11px] font-medium uppercase tracking-widest text-zinc-400">
              Password
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-800 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-zinc-900"
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-600">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !username || !password}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-zinc-300">
          Placeholder credentials for now — username <span className="font-mono">admin</span>, password{' '}
          <span className="font-mono">123</span>.
        </p>
      </div>
    </div>
  );
}