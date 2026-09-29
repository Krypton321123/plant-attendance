import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './Layout';
import AttendancePage from './DashboardPage';
import { AuthProvider, useAuth } from './Auth/AuthContext';
import ProtectedRoute from './Auth/ProtectedRoute';
import LoginPage from './Login';
import SalaryChart from './SalaryChart';
import Attendance from './Attendance';
import UserManagement from './UserManagement';
import FillingRegister from './FillingRegister';
import WastageRegister from './WastageRegister';

/**
 * App.tsx — React Router v6 root.
 *
 * Structure:
 *   /login               → LoginPage        (public — no auth required)
 *   /                    → redirect to /dashboard
 *   /dashboard           → AttendancePage    (screen key: "dashboard")
 *   /attendance          → Attendance        (screen key: "attendance")
 *   /payroll             → SalaryChart       (screen key: "payroll")
 *   /users               → UserManagement    (super users only, no screen key —
 *                                              gated on isSuper directly, not
 *                                              on allowedScreens, since a
 *                                              non-super user should never be
 *                                              able to grant themselves this
 *                                              regardless of what's in their
 *                                              allowedScreens list)
 *
 * Each real screen is now wrapped in its OWN <ProtectedRoute screen="...">,
 * rather than one shared wrapper for the whole Layout tree — this is what
 * lets different portal users see different subsets of the sidebar/routes.
 * Placeholder pages (Employees, Departments, Activity, Settings) have been
 * removed entirely, along with PlaceholderPage — they were never real
 * screens and had no business being in the access-control list.
 *
 * Screen keys used in `screen="..."` props below must match SCREENS in
 * screens.ts, which is also what UserManagement's checkbox list reads from.
 *
 * AUTH NOTE: login now calls the real backend (POST /portal-users/login,
 * portalLogin controller). Passwords are plaintext and there is no
 * token/session — see the comment block at the top of Auth/AuthContext.tsx
 * for exactly what that does and doesn't protect against.
 */
export default function App() {
  return (
    <BrowserRouter basename="/plant">
      <AuthProvider>
        <Routes>
          {/* Public — no auth required to view the login screen itself */}
          <Route path="/login" element={<LoginPage />} />

          {/* Every route below requires being logged in AND (except /users,
              which checks isSuper itself) having that specific screen. */}
          <Route element={<AuthedLayout />}>
            {/* Default redirect */}
            <Route index element={<Navigate to="/dashboard" replace />} />

            <Route element={<ProtectedRoute screen="dashboard" />}>
              <Route path="/dashboard" element={<AttendancePage />} />
            </Route>

            <Route element={<ProtectedRoute screen="attendance" />}>
              <Route path="/attendance" element={<Attendance />} />
            </Route>

            <Route element={<ProtectedRoute screen="payroll" />}>
              <Route path="/payroll" element={<SalaryChart />} />
            </Route>
            <Route element={<ProtectedRoute screen="filling" />}>
  <Route path="/filling" element={<FillingRegister />} />
</Route>
<Route element={<ProtectedRoute screen="wastage" />}>
  <Route path="/wastage" element={<WastageRegister />} />
</Route>

            {/* No `screen` prop — UserManagement checks req.user.isSuper on
                the backend for every request it makes, and the route itself
                is additionally hidden from the sidebar for non-super users
                in Sidebar.tsx. A non-super user landing here directly by URL
                still can't do anything, since the API calls it makes will
                be rejected server-side — but for a cleaner UX we should
                still bounce them; see SuperOnlyRoute below. */}
            <Route element={<SuperOnlyRoute />}>
              <Route path="/users" element={<UserManagement />} />
            </Route>

            {/* Catch-all — still inside the authed tree, so an unknown path
                lands on /dashboard rather than leaking through to a public
                404 */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

/**
 * Wraps the Layout route: requires login (no specific screen — just "are
 * you logged in at all"), then renders Layout with the real logged-in
 * user's name, replacing the old hardcoded "Rajesh Singh" / "Line
 * Supervisor" props.
 */
function AuthedLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <LayoutWithUser />;
}

function LayoutWithUser() {
  const { user } = useAuth();
  return (
    <Layout
      supervisorName={user?.displayName ?? 'User'}
      supervisorRole={user?.isSuper ? 'Administrator' : 'Team Member'}
      // employeeCount={employees.length} ← wire from context once you have it
    />
  );
}

/**
 * Same idea as ProtectedRoute, but checks isSuper directly instead of a
 * screen key — User Management is never granted via allowedScreens, only
 * via the IS_SUPER flag, so this is intentionally a separate small
 * component rather than reusing ProtectedRoute with a fake "users" screen
 * key that would then need to show up in screens.ts and the checkbox list,
 * which would be misleading (you can't actually grant it that way).
 */
function SuperOnlyRoute() {
  const { user } = useAuth();
  if (!user?.isSuper) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}