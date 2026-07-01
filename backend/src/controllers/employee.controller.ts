import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from "path"

const ADMIN_ID = "admin"
const ADMIN_PASSWORD = "123"

// GET /employees - List all employees (for selection screen)
export const getAllEmployees = async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      select: {
        EMP_ID: true,
        EMPNAME: true,
        EMPFNAME: true,
        EMPDESG: true,
        EMPTYPE: true,
        STATUS: true,
        SALARY: true,          // ← added: needed for the payroll-by-designation view
        EMPPROFILEPHOTO: true,
        DEVICEID: true,
      },
      orderBy: { EMPNAME: 'asc' },
    });
    res.json({ success: true, data: employees });
  } catch (error) {
    console.log("fetch employee error", error)
    res.status(500).json({ success: false, message: 'Failed to fetch employees' });
  }
};

// POST /employees/register - Register device + upload profile photo
export const registerEmployee = async (req: Request, res: Response) => {
  try {
    const { empId, deviceId } = req.body;
    const photo = req.file;

    if (!empId || !deviceId) {
      return res.status(400).json({ success: false, message: 'empId and deviceId are required' });
    }

    const employee = await prisma.employee.findUnique({ where: { EMP_ID: empId } });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // If already approved and same device, just return their status
    if (employee.STATUS === 'A' && employee.DEVICEID === deviceId) {
      return res.json({
        success: true,
        message: 'Already registered and approved',
        data: { status: 'A', empType: employee.EMPTYPE },
      });
    }

    const photoPath = photo
      ? path.join('profiles', photo.filename)
      : employee.EMPPROFILEPHOTO;

    const updated = await prisma.employee.update({
      where: { EMP_ID: empId },
      data: {
        DEVICEID: deviceId,
        EMPPROFILEPHOTO: photoPath || undefined,
        STATUS: 'NA', // Reset to pending on new registration
      },
    });

    return res.json({
      success: true,
      message: 'Registration submitted. Awaiting approval.',
      data: { status: updated.STATUS },
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'This device is already registered to another employee' });
    }
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// GET /employees/:empId/status - Check approval status
export const getEmployeeStatus = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;
    const employee = await prisma.employee.findUnique({
      where: { EMP_ID: empId as string },
      select: { STATUS: true, EMPTYPE: true, EMPNAME: true, EMPPROFILEPHOTO: true },
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    res.json({ success: true, data: employee });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch status' });
  }
};

// PATCH /employees/:empId/approve - Admin: approve an employee (toggle A/NA)
export const approveEmployee = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;
    const { status } = req.body; // "A" or "NA"

    if (!['A', 'NA'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be A or NA' });
    }

    const updated = await prisma.employee.update({
      where: { EMP_ID: empId as string },
      data: { STATUS: status },
    });

    res.json({ success: true, message: `Employee ${status === 'A' ? 'approved' : 'revoked'}`, data: updated });
  } catch {
    res.status(500).json({ success: false, message: 'Approval failed' });
  }
};

// POST /employees/create - Supervisor creates a new employee record
export const createEmployee = async (req: Request, res: Response) => {
  try {
    const { EMPNAME, EMPFNAME, EMPDESG, EMPTYPE } = req.body;

    if (!EMPNAME?.trim()) {
      return res.status(400).json({ success: false, message: 'First name is required' });
    }
    if (!EMPFNAME?.trim()) {
      return res.status(400).json({ success: false, message: 'Last name is required' });
    }
    if (!EMPDESG?.trim()) {
      return res.status(400).json({ success: false, message: 'Designation is required' });
    }
    if (!['INDIVIDUAL', 'SUPERVISOR'].includes(EMPTYPE)) {
      return res.status(400).json({ success: false, message: 'EMPTYPE must be INDIVIDUAL or SUPERVISOR' });
    }

    const employee = await prisma.employee.create({
      data: {
        EMPNAME: EMPNAME.trim(),
        EMPFNAME: EMPFNAME.trim(),
        EMPDESG: EMPDESG.trim(),
        EMPTYPE,
        STATUS: 'NA',
      },
      select: {
        EMP_ID: true,
        EMPNAME: true,
        EMPFNAME: true,
        EMPDESG: true,
        EMPTYPE: true,
        STATUS: true,
        CREATEDAT: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      data: employee,
    });
  } catch (error) {
    console.log('create employee error', error);
    res.status(500).json({ success: false, message: 'Failed to create employee' });
  }
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { adminId, password } = req.body;
 
    if (!adminId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Admin ID and password are required',
      });
    }
 
    if (adminId !== ADMIN_ID || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials',
      });
    }
 
    return res.json({
      success: true,
      message: 'Admin authenticated successfully',
      data: { role: 'ADMIN' },
    });
  } catch (error) {
    console.error('Admin login error', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

export const getTodayAttendanceByEmp = async (req: Request, res: Response) => {
  try {
    const { empId } = req.params;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const record = await prisma.attendance.findFirst({
      where: {
        EMP_ID: empId as string,
        CREATEDAT: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      select: {
        STATUS:    true,
        CREATEDAT: true,
        LOCATION:  true,
      },
    });

    return res.json({ success: true, data: record ?? null });
  } catch (err) {
    console.error("getTodayAttendanceByEmp error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};