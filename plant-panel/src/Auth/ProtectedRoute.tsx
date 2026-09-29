import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Gate for the Layout route tree. If the visitor isn't authenticated, they're
 * bounced to /login with the page they were trying to reach stashed in
 * location state, so LoginPage can send them back after a successful login.
 *
 * If a `screen` key is given, the visitor also needs that screen in their
 * allowedScreens (or isSuper) — otherwise they're bounced to /dashboard
 * rather than /login, since they ARE logged in, just not permitted here.
 * Pass no `screen` for routes any authenticated user should reach (e.g.
 * nothing right now, but this is the hook for a future "everyone can see
 * this" route).
 *
 * Usage in App.tsx:
 *   <Route element={<ProtectedRoute screen="payroll" />}>
 *     <Route path="/payroll" element={<SalaryChart />} />
 *   </Route>
 */
interface ProtectedRouteProps {
  screen?: string;
}

export default function ProtectedRoute({ screen }: ProtectedRouteProps) {
  const { isAuthenticated, canAccessScreen } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (screen && !canAccessScreen(screen)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}