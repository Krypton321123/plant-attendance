// Role helpers shared by the PIN screen, the admin role picker, and the drawer.

// Where each EMPTYPE lands after login. Kept in one place so the PIN screen
// and the admin role picker always agree.
export const routeForEmpType = (empType: string) => {
  switch (empType) {
    case "ADMIN":
      return "/admin/home";
    case "SUPERVISOR":
    case "PPSUPERVISOR":
    case "KPSUPERVISOR":
    case "OFFICE":
      return "/supervisor/home";
    case "GUARD":
      // Guards use the same attendance flow as individual employees —
      // their gate-log screen is reached from a button on that screen,
      // not via a separate landing route.
      return "/individual/home";
    default:
      return "/individual/home";
  }
};

// Admins can log in as any role. When they pick one, the cached session's
// EMPTYPE is overwritten with that role, so every existing screen keeps
// reading EMPTYPE exactly as before. The account's true type is kept in
// REAL_EMPTYPE so the app still knows they're allowed to switch roles.
// Regular employees never get this field, so their session is untouched.
export const markRealAdmin = (employee: any) => ({
  ...employee,
  REAL_EMPTYPE: "ADMIN",
});

export const isRealAdmin = (employee: any): boolean =>
  employee?.REAL_EMPTYPE === "ADMIN";