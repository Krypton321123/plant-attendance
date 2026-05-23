import { Router } from 'express';
import {
  getAllEmployees,
  registerEmployee,
  getEmployeeStatus,
  approveEmployee,
} from './controllers/employee.controller';
import {
  markAttendance,
  getTodayAttendance,
  getMyAttendance,
} from './controllers/attendance.controller';
import { upload } from './util/multer';

const router = Router();

// ── Employee Routes ──────────────────────────────────────────────
router.get('/employees', getAllEmployees);
router.post('/employees/register', upload.single('photo'), registerEmployee);
router.get('/employees/:empId/status', getEmployeeStatus);
router.patch('/employees/:empId/approve', approveEmployee);

// ── Attendance Routes ────────────────────────────────────────────
router.post('/attendance/mark', upload.single('photo'), markAttendance);
router.get('/attendance/today', getTodayAttendance);
router.get('/attendance/my/:empId', getMyAttendance);

export default router;