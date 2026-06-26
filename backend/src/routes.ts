import { Router } from 'express';
import {
  getAllEmployees,
  registerEmployee,
  getEmployeeStatus,
  approveEmployee,
  createEmployee,
  adminLogin,
  getTodayAttendanceByEmp,
} from './controllers/employee.controller';
import {
  markAttendance,
  getTodayAttendance,
  getMyAttendance,
  setOtStatus,
} from './controllers/attendance.controller';
import { upload } from './util/multer';
import {
  getFillingHistory,
  getFillingItems,
  getOperators,
  getTodayFillingEntries,
  submitFillingEntries,
} from './controllers/filling.controller';
import {
  getTodayWastageEntries,
  getWastageHistory,
  getWastageItems,
  submitWastageEntries,
} from './controllers/wastage.controller';
import {
  completeDispatchSession,
  createDispatchSession,
  getDepos,
  getDispatchItems,
  getParties,
  getSession,
  getTodaySessions,
  updateDispatchSession,
} from './controllers/dispatch.controller';
import prisma from './util/prisma';

const router = Router();

// ── Employee Routes ──────────────────────────────────────────────
router.get('/employees',                    getAllEmployees);
router.post('/employees/register',          upload.single('photo'), registerEmployee);
router.get('/employees/:empId/status',      getEmployeeStatus);
router.patch('/employees/:empId/approve',   approveEmployee);
router.post('/employees/create',            createEmployee);
router.post('/employees/admin-login',       adminLogin);

// ── Attendance Routes ────────────────────────────────────────────
router.post('/attendance/mark',             upload.single('photo'), markAttendance);
router.patch('/attendance/ot-status',       setOtStatus);
router.get('/attendance/today',             getTodayAttendance);
router.get('/attendance/my/:empId',         getMyAttendance);
router.get('/attendance/:empId/today',      getTodayAttendanceByEmp);

// ── Filling Routes ───────────────────────────────────────────────
router.get('/filling/items',                getFillingItems);
router.get('/filling/operators',            getOperators);
router.post('/filling/submit',              submitFillingEntries);
router.get('/filling/history',              getFillingHistory);
router.get('/filling/today-entries',        getTodayFillingEntries);

// ── Wastage Routes ───────────────────────────────────────────────
router.get('/wastage/items',                getWastageItems);
router.post('/wastage/submit',              submitWastageEntries);
router.get('/wastage/today-entries',        getTodayWastageEntries);
router.get('/wastage/history',              getWastageHistory);

// ── Dispatch Routes ──────────────────────────────────────────────
router.get('/dispatch/items',                              getDispatchItems);
router.get('/dispatch/parties',                            getParties);
router.get('/dispatch/depos',                              getDepos);
router.get('/dispatch/sessions/today',                     getTodaySessions);   // ← must be BEFORE /:sessionId
router.get('/dispatch/sessions/:sessionId',                getSession);
router.post('/dispatch/sessions',                          createDispatchSession);
router.put('/dispatch/sessions/:sessionId',                updateDispatchSession);
router.patch('/dispatch/sessions/:sessionId/complete',     completeDispatchSession);

export default router;