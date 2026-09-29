import { Router } from 'express';
import {
  getAllEmployees,
  getEmployeeStatus,
  approveEmployee,
  createEmployee,
  adminLogin,
  getTodayAttendanceByEmp,
} from './controllers/employee.controller';
import { login, signup } from './controllers/auth.controller';
import {
  markAttendance,
  getTodayAttendance,
  getMonthlyAttendance,
  getMyAttendance,
  setOtStatus,
} from './controllers/attendance.controller';
import {
  createVisitorEntry,
  markVisitorExit,
  getActiveGateLog,
  getGateHistory,
} from './controllers/gate.controller';
import { upload } from './util/multer';
import {
  getFillingHistory,
  getFillingItems,
  getFillingMonthlyHistory,
  getOperators,
  getTodayFillingEntries,
  submitFillingEntries,
} from './controllers/filling.controller';
import {
  getTodayWastageEntries,
  getWastageHistory,
  getWastageItems,
  getWastageMonthlyHistory,
  submitWastageEntries,
} from './controllers/wastage.controller';
import {
  completeDispatchSession,
  createDispatchSession,
  finalizeDispatchSession,
  getDepos,
  getDispatchItems,
  getParties,
  getSession,
  getTodaySessions,
  sendDispatchSession,
  updateDispatchSession,
} from './controllers/dispatch.controller';
import prisma from './util/prisma';
  import {
    portalLogin,
    getAllPortalUsers,
    createPortalUser,
    updatePortalUser,
    deletePortalUser,
  } from './controllers/portalUser.controller';


const router = Router();

// ── Auth Routes ───────────────────────────────────────────────────
router.post('/auth/login',                  login);
router.post('/auth/signup',                 upload.single('photo'), signup);

// ── Employee Routes ──────────────────────────────────────────────
router.get('/employees',                    getAllEmployees);
router.get('/employees/:empId/status',      getEmployeeStatus);
router.patch('/employees/:empId/approve',   approveEmployee);
router.post('/employees/create',            createEmployee);
router.post('/employees/admin-login',       adminLogin);
// ── Attendance Routes ────────────────────────────────────────────
router.post('/attendance/mark',             upload.single('photo'), markAttendance);
router.patch('/attendance/ot-status',       setOtStatus);
router.get('/attendance/today',             getTodayAttendance);
router.get('/attendance/month',             getMonthlyAttendance);
router.get('/attendance/my/:empId',         getMyAttendance);
router.get('/attendance/:empId/today',      getTodayAttendanceByEmp);
// ── Gate Routes ──────────────────────────────────────────────────
router.post('/gate/entry',                  upload.single('photo'), createVisitorEntry);
router.patch('/gate/exit',                  markVisitorExit);
router.get('/gate/active',                  getActiveGateLog);
router.get('/gate/history',                 getGateHistory);
// ── Filling Routes ───────────────────────────────────────────────
router.get('/filling/items',                getFillingItems);
router.get('/filling/operators',            getOperators);
router.post('/filling/submit',              submitFillingEntries);
router.get('/filling/history',              getFillingHistory);
router.get('/filling/today-entries',        getTodayFillingEntries);
 router.get('/filling/monthly-history',      getFillingMonthlyHistory);
// ── Wastage Routes ───────────────────────────────────────────────
router.get('/wastage/items',                getWastageItems);
router.post('/wastage/submit',              submitWastageEntries);
router.get('/wastage/today-entries',        getTodayWastageEntries);
router.get('/wastage/history',              getWastageHistory);
router.get('/wastage/monthly-history',      getWastageMonthlyHistory);
// ── Dispatch Routes ──────────────────────────────────────────────
router.get('/dispatch/items',                              getDispatchItems);
router.get('/dispatch/parties',                            getParties);
router.get('/dispatch/depos',                              getDepos);
router.get('/dispatch/sessions/today',                     getTodaySessions);   // ← must be BEFORE /:sessionId
router.get('/dispatch/sessions/:sessionId',                getSession);
router.post('/dispatch/sessions',                          createDispatchSession);
router.put('/dispatch/sessions/:sessionId',                updateDispatchSession);
router.patch('/dispatch/sessions/:sessionId/send',         sendDispatchSession);
router.patch('/dispatch/sessions/:sessionId/complete',     completeDispatchSession);
router.patch('/dispatch/sessions/:sessionId/finalize',     finalizeDispatchSession);


router.post('/portal-users/login',              portalLogin);
router.get('/portal-users',                      getAllPortalUsers);
router.post('/portal-users',                     createPortalUser);
router.patch('/portal-users/:userId',            updatePortalUser);
router.delete('/portal-users/:userId',           deletePortalUser);
export default router;