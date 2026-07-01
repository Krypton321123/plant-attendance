import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Gate for the Layout route tree. If the visitor isn't authenticated, they're
 * bounced to /login with the page they were trying to reach stashed in
 * location state, so LoginPage can send them back after a successful login.
 *
 * Usage in App.tsx:
 *   <Route element={<ProtectedRoute />}>
 *     <Route element={<Layout ... />}>
 *       <Route path="/attendance" element={<AttendancePage />} />
 *       ...
 *     </Route>
 *   </Route>
 */
export default function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}