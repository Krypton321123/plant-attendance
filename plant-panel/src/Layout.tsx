import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

/**
 * Root layout — renders the persistent sidebar on the left and the current
 * page (from React Router's <Outlet />) on the right.
 *
 * Pass supervisorId / employeeCount down from your auth context or a top-level
 * data fetch once you have one wired up.
 */
interface LayoutProps {
  employeeCount?: number;
  supervisorName?: string;
  supervisorRole?: string;
}

export default function Layout({ employeeCount, supervisorName, supervisorRole }: LayoutProps) {
  return (
    <div className="flex min-h-screen w-full bg-zinc-50">
      <Sidebar
        plantName="Plant Ops"
        employeeCount={employeeCount}
        supervisorName={supervisorName}
        supervisorRole={supervisorRole}
      />

      {/* Page content — fills remaining space, padded on mobile for the bottom tab bar */}
      <main className="min-w-0 flex-1 pb-16 sm:pb-0">
        <Outlet />
      </main>
    </div>
  );
}