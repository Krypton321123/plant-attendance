import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from 'path';



// Helper: get today's date range in IST
const getTodayRange = () => {
  const now = new Date();
  // IST = UTC+5:30
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + IST_OFFSET);

  const startOfDay = new Date(istNow);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const start = new Date(startOfDay.getTime() - IST_OFFSET);

  const endOfDay = new Date(istNow);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const end = new Date(endOfDay.getTime() - IST_OFFSET);

  return { start, end };
};

// POST /attendance/mark - Mark attendance (individual marks themselves)
export const markAttendance = async (req: Request, res: Response) => {
  try {
    const { empId, status, location, markedBy } = req.body;
    const photo = req.file;

    if (!empId || !status) {
      return res.status(400).json({ success: false, message: 'empId and status are required' });
    }

    if (!['P', 'A'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be P (Present) or A (Absent)' });
    }

    // Verify employee is approved
    const employee = await prisma.employee.findUnique({ where: { EMP_ID: empId } });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (employee.STATUS !== 'A') return res.status(403).json({ success: false, message: 'Employee not approved yet' });

    // Check if already marked today
    const { start, end } = getTodayRange();
    const existing = await prisma.attendance.findFirst({
      where: {
        EMP_ID: empId,
        CREATEDAT: { gte: start, lte: end },
      },
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'Attendance already marked for today' });
    }

    const photoPath = photo ? path.join('attendance', photo.filename) : null;

    const record = await prisma.attendance.create({
      data: {
        EMP_ID: empId,
        STATUS: status,
        PHOTO: photoPath,
        LOCATION: location || null,
        MARKED_BY: markedBy || empId,
        CREATEDAT: new Date(),
      },
    });

    return res.json({ success: true, message: 'Attendance marked successfully', data: record });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to mark attendance' });
  }
};

// GET /attendance/today - Get today's attendance for all employees (for supervisor screen)
export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const { supervisorId } = req.query;

    if (!supervisorId) {
      return res.status(400).json({ success: false, message: 'supervisorId query param is required' });
    }

    // Fetch supervisor and their department
    const supervisor = await prisma.employee.findUnique({
      where: { EMP_ID: supervisorId as string },
      select: { DEPARTMENT: true, EMPTYPE: true },
    });

    if (!supervisor) {
      return res.status(404).json({ success: false, message: 'Supervisor not found' });
    }

    const { start, end } = getTodayRange();

    const employees = await prisma.employee.findMany({
      where: {
        DEPARTMENT: supervisor.DEPARTMENT,       // ← department filter
        EMP_ID: { not: supervisorId as string }, // ← exclude the supervisor themselves
      },
      select: {
        EMP_ID: true,
        EMPNAME: true,
        EMPFNAME: true,
        EMPDESG: true,
        EMPTYPE: true,
        EMPPROFILEPHOTO: true,
        attendances: {
          where: { CREATEDAT: { gte: start, lte: end } },
          select: {
            STATUS: true,
            CREATEDAT: true,
            LOCATION: true,
            MARKED_BY: true,
            PHOTO: true,
          },
          take: 1,
        },
      },
      orderBy: { EMPNAME: 'asc' },
    });

    const result = employees.map((emp: any) => ({
      ...emp,
      todayAttendance: emp.attendances[0] || null,
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
};

// GET /attendance/my/:empId - Get today's attendance for a single employee
export const getMyAttendance = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;
    const { start, end } = getTodayRange();

    const record = await prisma.attendance.findFirst({
      where: {
        EMP_ID: empId as string,
        CREATEDAT: { gte: start, lte: end },
      },
    });

    res.json({ success: true, data: record });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
};