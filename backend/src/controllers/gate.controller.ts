import { Request, Response } from 'express';
import prisma from '../util/prisma';
import path from 'path';


// ─── POST /gate/entry ─────────────────────────────────────────────────────────
// Creates a new gate-entry log. The acting guard is `loggedBy`.
// Mirrors markAttendance's approved-actor check, but here EMPTYPE must also be
// GUARD — gate logging is a guard-specific privilege. Remove the EMPTYPE check
// below if you'd rather let any approved employee log entries.
//
// entryType is one of:
//   EMPLOYEE — generic entry: name + purpose (+ photo).
//   VISITOR  — name, personToMeet, purpose, 10-digit mobile, and an optional
//              vehicleNo (+ photo). These extra columns stay null on EMPLOYEE rows.

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

// Multipart text fields arrive as strings; anything else is treated as empty.
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const createVisitorEntry = async (req: Request, res: Response) => {
  try {
    const entryType    = clean(req.body.entryType);
    const name         = clean(req.body.name);
    const purpose      = clean(req.body.purpose);
    const loggedBy     = clean(req.body.loggedBy);
    const personToMeet = clean(req.body.personToMeet);
    const mobile       = clean(req.body.mobile);
    const vehicleNo    = clean(req.body.vehicleNo).toUpperCase();
    const photo = req.file;

    if (!entryType || !name || !purpose || !loggedBy) {
      return res.status(400).json({
        success: false,
        message: 'entryType, name, purpose, and loggedBy are required',
      });
    }
    if (!['EMPLOYEE', 'VISITOR'].includes(entryType)) {
      return res.status(400).json({ success: false, message: 'entryType must be EMPLOYEE or VISITOR' });
    }

    const isVisitor = entryType === 'VISITOR';
    if (isVisitor && !personToMeet) {
      return res.status(400).json({ success: false, message: 'personToMeet is required for VISITOR entries' });
    }
    if (isVisitor && !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: 'A valid 10-digit mobile number is required for VISITOR entries' });
    }

    const guard = await prisma.employee.findUnique({ where: { EMP_ID: loggedBy } });
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (guard.STATUS !== 'A') {
      return res.status(403).json({ success: false, message: 'Guard not approved' });
    }
    if (guard.EMPTYPE !== 'ADMIN' && guard.EMPTYPE !== 'GUARD') {
      return res.status(403).json({ success: false, message: 'Only guards can log gate entries' });
    }

    const photoPath = photo ? path.join('visitors', photo.filename) : null;

    const record = await prisma.visitorLog.create({
      data: {
        ENTRY_TYPE:     entryType,
        NAME:           name,
        PERSON_TO_MEET: isVisitor ? personToMeet : null,
        MOBILE:         isVisitor ? mobile : null,
        VEHICLE_NO:     isVisitor && vehicleNo ? vehicleNo : null,
        PURPOSE:        purpose,
        PHOTO:          photoPath,
        LOGGED_BY:      loggedBy,
        ENTRY_AT:       new Date(),
        EXIT_AT:        null,
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
    if (guard.EMPTYPE !== 'ADMIN' && guard.EMPTYPE !== 'GUARD') {
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
        LOG_ID:         true,
        ENTRY_TYPE:     true,
        NAME:           true,
        PERSON_TO_MEET: true,
        MOBILE:         true,
        VEHICLE_NO:     true,
        PURPOSE:        true,
        PHOTO:          true,
        ENTRY_AT:       true,
        EXIT_AT:        true,
        LOGGED_BY:      true,
        loggedBy:       { select: { EMPNAME: true } },
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
// Full gate log — entered and already-exited both — for a date range.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD. Both ends are inclusive and read as
// IST calendar days, so "a day" means the same thing here as in getTodayRange
// (and across the rest of the app). If only one end is given it's treated as a
// single day; with neither, this returns today's log exactly as it did before
// ranges were supported. Ranges are capped (MAX_RANGE_DAYS) so one request
// can't pull the whole table.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 92;

// 'YYYY-MM-DD' → the instant that IST day starts (or ends, to the millisecond).
// Null when the string is malformed or isn't a real calendar date (2026-02-31).
const parseIstDay = (ymd: string, endOfDay: boolean): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;

  const y  = Number(m[1]);
  const mo = Number(m[2]);
  const d  = Number(m[3]);

  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }

  const utcMs = endOfDay ? Date.UTC(y, mo - 1, d, 23, 59, 59, 999) : probe.getTime();
  return new Date(utcMs - IST_OFFSET_MS);
};

export const getGateHistory = async (req: Request, res: Response) => {
  try {
    const fromRaw = clean(req.query.from);
    const toRaw   = clean(req.query.to);

    // One end alone means a single day; neither means today.
    const fromDay = fromRaw || toRaw;
    const toDay   = toRaw || fromRaw;
    const today   = getTodayRange();

    const start = fromDay ? parseIstDay(fromDay, false) : today.start;
    const end   = toDay   ? parseIstDay(toDay, true)    : today.end;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: 'from and to must be valid dates in YYYY-MM-DD format',
      });
    }
    if (start.getTime() > end.getTime()) {
      return res.status(400).json({ success: false, message: '"from" must not be after "to"' });
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
      });
    }

    const records = await prisma.visitorLog.findMany({
      where: { ENTRY_AT: { gte: start, lte: end } },
      select: {
        LOG_ID:         true,
        ENTRY_TYPE:     true,
        NAME:           true,
        PERSON_TO_MEET: true,
        MOBILE:         true,
        VEHICLE_NO:     true,
        PURPOSE:        true,
        PHOTO:          true,
        ENTRY_AT:       true,
        EXIT_AT:        true,
        LOGGED_BY:      true,
        EXIT_LOGGED_BY: true,
        loggedBy:       { select: { EMPNAME: true } },
        exitLoggedBy:   { select: { EMPNAME: true } },
      },
      orderBy: { ENTRY_AT: 'desc' },
    });

    return res.json({ success: true, data: records });
  } catch (error) {
    console.error('getGateHistory error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch gate history' });
  }
};