import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from 'path';

// POST /auth/login
// Body: { mpin: string, deviceId: string }
export const login = async (req: Request, res: Response) => {
  try {
    const { mpin, deviceId } = req.body;

    if (!mpin || typeof mpin !== 'string' || mpin.length !== 6) {
      return res.status(400).json({ success: false, message: 'Enter a valid 6-digit PIN' });
    }
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    const employee = await prisma.employee.findFirst({
      where: { MPIN: mpin },
    });

    if (!employee) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN' });
    }

    if (!employee.DEVICEID) {
      // Shouldn't normally happen since DEVICEID is bound at signup,
      // but guard against employees created directly in the DB without one.
      return res.status(403).json({
        success: false,
        message: 'This account has no device on file. Contact an admin.',
      });
    }

    if (employee.DEVICEID !== deviceId) {
      return res.status(403).json({
        success: false,
        message: 'This PIN is already registered on a different device. Contact an admin if you need it reset.',
      });
    }

    if (employee.STATUS !== 'A') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Contact an admin.',
      });
    }

    const { MPIN, ...safeEmployee } = employee;

    return res.json({
      success: true,
      message: 'Login successful',
      data: safeEmployee,
    });
  } catch (error) {
    console.error('login error', error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// POST /auth/signup
// multipart/form-data: empName, empFName, mobile, deviceId, photo (file)
export const signup = async (req: Request, res: Response) => {
  try {
    const { empName, empFName, mobile, deviceId } = req.body;
    const photo = req.file;

    if (!empName?.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!empFName?.trim()) {
      return res.status(400).json({ success: false, message: "Father's name is required" });
    }
    if (!mobile?.trim() || !/^\d{10}$/.test(mobile.trim())) {
      return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
    }
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }
    if (!photo) {
      return res.status(400).json({ success: false, message: 'Photo is required' });
    }

    // A device can only be tied to one account. Since MPIN/STATUS aren't set
    // yet at signup, we can't rely on the login uniqueness check — enforce it here.
    const existingDevice = await prisma.employee.findFirst({
      where: { DEVICEID: deviceId },
    });
    if (existingDevice) {
      return res.status(409).json({
        success: false,
        message: 'This device is already registered to an account',
      });
    }

    const photoPath = path.join('profiles', photo.filename);

    const employee = await prisma.employee.create({
      data: {
        EMPNAME: empName.trim(),
        EMPFNAME: empFName.trim(),
        EMPDESG: 'NA', // set by admin on approval
        EMPTYPE: 'INDIVIDUAL', // set by admin on approval
        EMPPROFILEPHOTO: photoPath,
        DEVICEID: deviceId,
        MOBILE: mobile.trim(),
        STATUS: 'NA', // inactive until an admin assigns MPIN + flips this to 'A'
      },
      select: {
        EMP_ID: true,
        EMPNAME: true,
        EMPFNAME: true,
        STATUS: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Sign up submitted. An admin will assign your PIN.',
      data: employee,
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'This device is already registered to an account' });
    }
    console.error('signup error', error);
    return res.status(500).json({ success: false, message: 'Sign up failed' });
  }
};