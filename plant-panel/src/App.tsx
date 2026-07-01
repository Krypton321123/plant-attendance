import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import AttendancePage from './AttendancePage';
import PlaceholderPage from './PlaceholderPage';
import { AuthProvider } from './Auth/AuthContext';
import ProtectedRoute from './Auth/ProtectedRoute';
import LoginPage from './Login';

/**
 * App.tsx — React Router v6 root.
 *
 * Structure:
 *   /login               → LoginPage       (public — no auth required)
 *   /                    → redirect to /attendance
 *   /attendance          → AttendancePage  (your existing dashboard, attendance view)
 *   /payroll             → PayrollPage     (your existing dashboard, payroll view) [placeholder for now]
 *   /employees           → EmployeesPage   [placeholder]
 *   /departments         → DepartmentsPage [placeholder]
 *   /activity            → ActivityPage    [placeholder]
 *   /settings            → SettingsPage    [placeholder]
 *
 * Everything under the Layout route is now gated by <ProtectedRoute />: if
 * you're not "logged in" (see auth/AuthContext.tsx), you're bounced to
 * /login and sent back to wherever you were trying to go once you sign in.
 *
 * AUTH NOTE: login is currently client-side only, hardcoded to admin/123,
 * and persisted in localStorage. It does NOT call the backend's real
 * POST /admin/login endpoint. This is a placeholder gate, not real security
 * — see the comment at the top of auth/AuthContext.tsx for details and what
 * to swap in later.
 *
 * To add a real page: create the component in /pages/, import it here,
 * and swap out the matching <PlaceholderPage />.
 */
export default function App() {
  return (
    <BrowserRouter basename="/plant">
      <AuthProvider>
        <Routes>
          {/* Public — no auth required to view the login screen itself */}
          <Route path="/login" element={<LoginPage />} />

          {/* Everything below this line requires being "logged in" */}
          <Route element={<ProtectedRoute />}>
            {/* The Layout route wraps everything — sidebar lives here */}
            <Route
              element={
                <Layout
                  supervisorName="Rajesh Singh"
                  supervisorRole="Line Supervisor"
                  // employeeCount={employees.length} ← wire from context once you have auth
                />
              }
            >
              {/* Default redirect */}
              <Route index element={<Navigate to="/attendance" replace />} />
              {/* Live pages */}
              <Route path="/attendance" element={<AttendancePage />} />
              {/* Placeholders — replace one by one as you build each page */}
              <Route
                path="/payroll"
                element={
                  <PlaceholderPage
                    title="Payroll"
                    description="Salary by designation. Wire up your PayrollView component here."
                  />
                }
              />
              <Route
                path="/employees"
                element={
                  <PlaceholderPage
                    title="Employees"
                    description="Full roster management. Wire up an EmployeesPage component here."
                  />
                }
              />
              <Route
                path="/departments"
                element={
                  <PlaceholderPage
                    title="Departments"
                    description="Department and team structure."
                  />
                }
              />
              <Route
                path="/activity"
                element={
                  <PlaceholderPage
                    title="Activity Log"
                    description="Audit trail of attendance marks and changes."
                  />
                }
              />
              <Route
                path="/settings"
                element={
                  <PlaceholderPage
                    title="Settings"
                    description="App configuration, shift timings, notifications."
                  />
                }
              />
              {/* Catch-all — still inside the protected tree, so an unknown
                  authenticated path lands back on /attendance rather than
                  leaking through to a public 404 */}
              <Route path="*" element={<Navigate to="/attendance" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}