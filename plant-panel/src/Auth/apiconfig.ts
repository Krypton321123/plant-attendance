const raw = import.meta.env.VITE_API_URL;
 
if (!raw) {
  // Fail loud in dev rather than silently falling back to a relative path
  // that happens to work locally (via a proxy) but breaks anywhere else.
  throw new Error(
    'VITE_API_URL is not set. Add it to your .env file, e.g. VITE_API_URL=http://localhost:3001/api',
  );
}
 
// Strip any trailing slash so joining never produces a doubled slash
// regardless of whether .env has one on the end.
export const API_BASE_URL = raw.replace(/\/+$/, '');
 
/**
 * Build a full API URL from a path. Pass paths starting with '/', e.g.
 * apiUrl('/portal-users/login') → 'http://localhost:3001/api/portal-users/login'.
 */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}
 