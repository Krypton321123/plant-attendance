import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from "path"



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