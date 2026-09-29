import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from 'path';


// ─── POST /gate/entry ─────────────────────────────────────────────────────────
// Creates a new visitor/vehicle gate-entry log. The acting guard is `loggedBy`.
// Mirrors markAttendance's approved-actor check, but here EMPTYPE must also be
// GUARD — gate logging is a guard-specific privilege. Remove the EMPTYPE check
// below if you'd rather let any approved employee log entries.

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

export const createVisitorEntry = async (req: Request, res: Response) => {
  try {
    const { entryType, name, vehicleNo, purpose, loggedBy } = req.body;
    const photo = req.file;

    if (!entryType || !name || !purpose || !loggedBy) {
      return res.status(400).json({
        success: false,
        message: 'entryType, name, purpose, and loggedBy are required',
      });
    }
    if (!['PERSON', 'VEHICLE'].includes(entryType)) {
      return res.status(400).json({ success: false, message: 'entryType must be PERSON or VEHICLE' });
    }
    if (entryType === 'VEHICLE' && !vehicleNo) {
      return res.status(400).json({ success: false, message: 'vehicleNo is required for VEHICLE entries' });
    }

    const guard = await prisma.employee.findUnique({ where: { EMP_ID: loggedBy } });
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (guard.STATUS !== 'A') {
      return res.status(403).json({ success: false, message: 'Guard not approved' });
    }
    if (guard.EMPTYPE !== 'GUARD') {
      return res.status(403).json({ success: false, message: 'Only guards can log gate entries' });
    }

    const photoPath = photo ? path.join('visitors', photo.filename) : null;

    const record = await prisma.visitorLog.create({
      data: {
        ENTRY_TYPE: entryType,
        NAME:       name,
        VEHICLE_NO: entryType === 'VEHICLE' ? vehicleNo : null,
        PURPOSE:    purpose,
        PHOTO:      photoPath,
        LOGGED_BY:  loggedBy,
        ENTRY_AT:   new Date(),
        EXIT_AT:    null,
      },
    });

    return res.json({ success: true, message: 'Entry logged', data: record });
  } catch (error) {
    console.error('createVisitorEntry error:', error);
    return res.status(500).json({ success: false, message: 'Failed to log entry' });
  }
};

// ─── PATCH /gate/exit ─────────────────────────────────────────────────────────
// Body: { logId, exitLoggedBy }
// Sets EXIT_AT exactly once — same one-time-write guard as setOtStatus. This
// matters more here than in most single-user flows: the "currently inside"
// list is shared live across every guard's device, so two guards can plausibly
// tap Mark Exit on the same row within seconds of each other at a handoff.
// exitLoggedBy may be a different guard than whoever logged the entry, so it's
// stored in its own column rather than overwriting LOGGED_BY.

export const markVisitorExit = async (req: Request, res: Response) => {
  try {
    const { logId, exitLoggedBy } = req.body;

    if (!logId || !exitLoggedBy) {
      return res.status(400).json({ success: false, message: 'logId and exitLoggedBy are required' });
    }

    const guard = await prisma.employee.findUnique({ where: { EMP_ID: exitLoggedBy } });
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (guard.STATUS !== 'A') {
      return res.status(403).json({ success: false, message: 'Guard not approved' });
    }
    if (guard.EMPTYPE !== 'GUARD') {
      return res.status(403).json({ success: false, message: 'Only guards can mark gate exits' });
    }

    const record = await prisma.visitorLog.findUnique({ where: { LOG_ID: logId } });
    if (!record) {
      return res.status(404).json({ success: false, message: 'Log entry not found' });
    }

    if (record.EXIT_AT !== null) {
      return res.status(409).json({ success: false, message: 'Exit already marked for this entry' });
    }

    const updated = await prisma.visitorLog.update({
      where: { LOG_ID: logId },
      data: {
        EXIT_AT:        new Date(),
        EXIT_LOGGED_BY: exitLoggedBy,
      },
    });

    return res.json({ success: true, message: 'Exit marked', data: updated });
  } catch (error) {
    console.error('markVisitorExit error:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark exit' });
  }
};

// ─── GET /gate/active ─────────────────────────────────────────────────────────
// Everyone/everything currently inside (EXIT_AT still null). Shared across all
// guards — not scoped to whoever is asking, matching the "one live gate log"
// model rather than a per-guard log.

export const getActiveGateLog = async (_req: Request, res: Response) => {
  try {
    const records = await prisma.visitorLog.findMany({
      where: { EXIT_AT: null },
      select: {
        LOG_ID:     true,
        ENTRY_TYPE: true,
        NAME:       true,
        VEHICLE_NO: true,
        PURPOSE:    true,
        PHOTO:      true,
        ENTRY_AT:   true,
        EXIT_AT:    true,
        LOGGED_BY:  true,
        loggedBy:   { select: { EMPNAME: true } },
      },
      orderBy: { ENTRY_AT: 'desc' },
    });

    return res.json({ success: true, data: records });
  } catch (error) {
    console.error('getActiveGateLog error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch active gate log' });
  }
};

// ─── GET /gate/history ────────────────────────────────────────────────────────
// Today's full gate log — entered and already-exited both. Uses the same IST
// day-boundary helper as attendance, so "today" means the same thing across
// the whole app. (attendance.controller.ts now exports getTodayRange for this.)

export const getGateHistory = async (_req: Request, res: Response) => {
  try {
    const { start, end } = getTodayRange();

    const records = await prisma.visitorLog.findMany({
      where: { ENTRY_AT: { gte: start, lte: end } },
      select: {
        LOG_ID:         true,
        ENTRY_TYPE:     true,
        NAME:           true,
        VEHICLE_NO:     true,
        PURPOSE:        true,
        PHOTO:          true,
        ENTRY_AT:       true,
        EXIT_AT:        true,
        LOGGED_BY:      true,
        EXIT_LOGGED_BY: true,
        loggedBy:       { select: { EMPNAME: true } },
      },
      orderBy: { ENTRY_AT: 'desc' },
    });

    return res.json({ success: true, data: records });
  } catch (error) {
    console.error('getGateHistory error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch gate history' });
  }
};