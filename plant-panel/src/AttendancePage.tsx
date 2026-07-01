import AttendanceDashboard from './AttendancePanel';

/**
 * Route: /attendance
 *
 * Thin wrapper around your existing AttendanceDashboard.
 * The sidebar is now handled by Layout.tsx — AttendanceDashboard's own
 * internal <Sidebar> and <MobileTabs> will conflict once you embed it here.
 *
 * See INTEGRATION.md for the two-step plan to strip the built-in nav out of
 * AttendanceDashboard and let Layout own it instead.
 *
 * For now this renders the whole dashboard as-is so nothing breaks.
 */
export default function AttendancePage() {
  return <AttendanceDashboard />;
}