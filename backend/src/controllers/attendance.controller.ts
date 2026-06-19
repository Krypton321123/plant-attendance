import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from 'path';

// ─── Shift helpers ────────────────────────────────────────────────────────────

const getCurrentShift = (): 'DAY' | 'NIGHT' => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET);
  return istNow.getUTCHours() >= 20 ? 'NIGHT' : 'DAY';
};

const getTodayRange = () => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET);

  const startOfDay = new Date(istNow);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const start = new Date(startOfDay.getTime() - IST_OFFSET);

  const endOfDay = new Date(istNow);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const end = new Date(endOfDay.getTime() - IST_OFFSET);

  return { start, end };
};

// ─── POST /attendance/mark ────────────────────────────────────────────────────
// When markedBy is provided (supervisor marking someone else):
//   - The SUPERVISOR must be approved, not the target employee.
//   - This lets supervisors mark attendance for unapproved/non-smartphone employees.
// When markedBy is absent (individual marking themselves):
//   - The employee themselves must be approved.

export const markAttendance = async (req: Request, res: Response) => {
  try {
    const { empId, status, location, markedBy, latValue, longValue } = req.body;
    const photo = req.file;

    if (!empId || !status) {
      return res.status(400).json({ success: false, message: 'empId and status are required' });
    }
    if (!['P', 'A'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be P or A' });
    }

    const isSupervisorMark = !!markedBy && markedBy !== empId;

    if (isSupervisorMark) {
      // Verify the SUPERVISOR is approved — the target employee doesn't need to be
      const supervisor = await prisma.employee.findUnique({ where: { EMP_ID: markedBy } });
      if (!supervisor) {
        return res.status(404).json({ success: false, message: 'Supervisor not found' });
      }
      if (supervisor.STATUS !== 'A') {
        return res.status(403).json({ success: false, message: 'Supervisor not approved' });
      }
      // Still confirm the target employee exists
      const target = await prisma.employee.findUnique({ where: { EMP_ID: empId } });
      if (!target) {
        return res.status(404).json({ success: false, message: 'Employee not found' });
      }
    } else {
      // Individual self-mark — the employee themselves must be approved
      const employee = await prisma.employee.findUnique({ where: { EMP_ID: empId } });
      if (!employee) {
        return res.status(404).json({ success: false, message: 'Employee not found' });
      }
      if (employee.STATUS !== 'A') {
        return res.status(403).json({ success: false, message: 'Employee not approved yet' });
      }
    }

    const shift = getCurrentShift();
    const { start, end } = getTodayRange();

    const existing = await prisma.attendance.findFirst({
      where: {
        EMP_ID:    empId,
        SHIFT:     shift,
        CREATEDAT: { gte: start, lte: end },
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Attendance already marked for the ${shift} shift today`,
        shift,
      });
    }

    const photoPath = photo ? path.join('attendance', photo.filename) : null;

    const record = await prisma.attendance.create({
      data: {
        EMP_ID:     empId,
        STATUS:     status,
        PHOTO:      photoPath,
        LOCATION:   location  || null,
        MARKED_BY:  markedBy  || empId,
        SHIFT:      shift,
        LAT_VALUE:  latValue  || null,
        LONG_VALUE: longValue || null,
        CREATEDAT:  new Date(),
      },
    });

    return res.json({
      success: true,
      message: 'Attendance marked successfully',
      data: { ...record, shift },
    });
  } catch (error) {
    console.error('markAttendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark attendance' });
  }
};

// ─── GET /attendance/today?supervisorId=… ────────────────────────────────────
// Returns employees in the supervisor's department + supervisor's own attendance.

export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const { supervisorId } = req.query;
    console.log("supervisorId", supervisorId)

    if (!supervisorId) {
      return res.status(400).json({ success: false, message: 'supervisorId query param is required' });
    }

    const supervisor = await prisma.employee.findUnique({
      where:  { EMP_ID: supervisorId as string },
      select: { DEPARTMENT: true, EMPTYPE: true },
    });

    if (!supervisor) {
      return res.status(404).json({ success: false, message: 'Supervisor not found' });
    }

    const { start, end } = getTodayRange();
    const currentShift   = getCurrentShift();

    // ── Employees under the supervisor (excluding supervisor themselves) ──────
    const employees = await prisma.employee.findMany({
      where: {
        DEPARTMENT: supervisor.DEPARTMENT,
        EMP_ID:     { not: supervisorId as string },
      },
      select: {
        EMP_ID:          true,
        EMPNAME:         true,
        EMPFNAME:        true,
        EMPDESG:         true,
        EMPTYPE:         true,
        EMPPROFILEPHOTO: true,
        attendances: {
          where:   { CREATEDAT: { gte: start, lte: end } },
          select:  {
            STATUS:     true,
            CREATEDAT:  true,
            LOCATION:   true,
            MARKED_BY:  true,
            PHOTO:      true,
            SHIFT:      true,
            LAT_VALUE:  true,
            LONG_VALUE: true,
          },
          take:    2,
          orderBy: { CREATEDAT: 'asc' },
        },
      },
      orderBy: { EMPNAME: 'asc' },
    });

    const result = employees.map((emp: any) => {
      const dayRecord   = emp.attendances.find((a: any) => a.SHIFT === 'DAY')   ?? null;
      const nightRecord = emp.attendances.find((a: any) => a.SHIFT === 'NIGHT') ?? null;
      return {
        EMP_ID:             emp.EMP_ID,
        EMPNAME:            emp.EMPNAME,
        EMPFNAME:           emp.EMPFNAME,
        EMPDESG:            emp.EMPDESG,
        EMPTYPE:            emp.EMPTYPE,
        EMPPROFILEPHOTO:    emp.EMPPROFILEPHOTO,
        dayAttendance:      dayRecord,
        nightAttendance:    nightRecord,
        currentShiftMarked: currentShift === 'DAY' ? !!dayRecord : !!nightRecord,
        currentShift,
      };
    });

    // ── Supervisor's own attendance for today ────────────────────────────────
    const selfRecords = await prisma.attendance.findMany({
      where: {
        EMP_ID:    supervisorId as string,
        CREATEDAT: { gte: start, lte: end },
      },
      select: {
        STATUS:     true,
        CREATEDAT:  true,
        LOCATION:   true,
        SHIFT:      true,
        LAT_VALUE:  true,
        LONG_VALUE: true,
      },
      orderBy: { CREATEDAT: 'asc' },
    });

    const selfDay   = selfRecords.find(r => r.SHIFT === 'DAY')   ?? null;
    const selfNight = selfRecords.find(r => r.SHIFT === 'NIGHT') ?? null;

    res.json({
      success:      true,
      data:         result,
      currentShift,
      selfAttendance: {
        dayRecord:            selfDay,
        nightRecord:          selfNight,
        activeRecord:         currentShift === 'DAY' ? selfDay : selfNight,
        isCurrentShiftMarked: currentShift === 'DAY' ? !!selfDay : !!selfNight,
      },
    });
  } catch (error) {
    console.error('getTodayAttendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
};

// ─── GET /attendance/:empId/today ─────────────────────────────────────────────

export const getTodayAttendanceByEmp = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;
    const { start, end } = getTodayRange();

    const records = await prisma.attendance.findMany({
      where: {
        EMP_ID:    empId as string,
        CREATEDAT: { gte: start, lte: end },
      },
      select: {
        STATUS:     true,
        CREATEDAT:  true,
        LOCATION:   true,
        SHIFT:      true,
        LAT_VALUE:  true,
        LONG_VALUE: true,
      },
      orderBy: { CREATEDAT: 'asc' },
    });

    const currentShift = getCurrentShift();
    const dayRecord    = records.find(r => r.SHIFT === 'DAY')   ?? null;
    const nightRecord  = records.find(r => r.SHIFT === 'NIGHT') ?? null;
    const activeRecord = currentShift === 'DAY' ? dayRecord : nightRecord;

    return res.json({
      success: true,
      data: {
        currentShift,
        dayRecord,
        nightRecord,
        activeRecord,
        isCurrentShiftMarked: !!activeRecord,
      },
    });
  } catch (err) {
    console.error('getTodayAttendanceByEmp error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── GET /attendance/my/:empId ────────────────────────────────────────────────

export const getMyAttendance = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;
    const { start, end } = getTodayRange();

    const records = await prisma.attendance.findMany({
      where: {
        EMP_ID:    empId as string,
        CREATEDAT: { gte: start, lte: end },
      },
      orderBy: { CREATEDAT: 'asc' },
    });

    res.json({ success: true, data: records });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
};