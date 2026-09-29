import { Request, Response } from "express";
import prisma from "../util/prisma";

// Small helper: given a "YYYY-MM-DD" string (or nothing, meaning today),
// return the [start, end] Date range covering that whole calendar day.
// Used both when reading entries for a date and when deciding which
// existing rows count as "the same date" for delete-then-insert.
const dayRange = (dateParam?: string) => {
  const base = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const monthRange = (year: number, month0: number) => {
  const start = new Date(year, month0, 1, 0, 0, 0, 0);
  const end = new Date(year, month0 + 1, 0, 23, 59, 59, 999); // day 0 of next month = last day of this month
  return { start, end };
};

// GET /filling/items
// Returns all items from mstitm, grouped by itmsubcat
export const getFillingItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.mstitm.findMany({
      select: {
        itmcd: true,
        itmnm: true,
        itmsubcat: true,
        pcksz: true,
      },
      orderBy: [{ itmsubcat: "asc" }, { itmnm: "asc" }],
    });
    res.json({ success: true, data: items });
  } catch (error) {
    console.error("getFillingItems error", error);
    res.status(500).json({ success: false, message: "Failed to fetch items" });
  }
};

// GET /filling/operators
// Returns all employees with EMPTYPE = "OPERATOR"
export const getOperators = async (_req: Request, res: Response) => {
  try {
    const operators = await prisma.employee.findMany({
      where: { EMPTYPE: "OPERATOR", STATUS: "A" },
      select: {
        EMP_ID: true,
        EMPNAME: true,
        EMPFNAME: true,
        EMPDESG: true,
      },
      orderBy: { EMPNAME: "asc" },
    });
    res.json({ success: true, data: operators });
  } catch (error) {
    console.error("getOperators error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch operators" });
  }
};

// POST /filling/submit
// Body: { doneBy: string, date?: "YYYY-MM-DD", entries: [{ itmcd, itmnm, itmsubcat, batchNo, filling, wastage, operatorId }] }
//
// "date" is the calendar date the supervisor is filling in for (defaults to
// today if omitted, so existing callers keep working).
//
// SHARED-PER-DAY MODEL: a row's identity is (ITMCD, date) — NOT
// (ITMCD, DONE_BY, date). Any PPSUPERVISOR can see and overwrite any other
// supervisor's entry for the same item/day. For every valid entry we
// DELETE any existing FillingEntry row for that (ITMCD, date) — regardless
// of who created it — before inserting the new one with DONE_BY set to
// whoever is submitting now. This is intentionally an "ownership transfers
// to last editor" model: the new submitter becomes the row's DONE_BY, and
// the previous author is not retained anywhere once overwritten. If an
// audit trail of prior authors is ever needed, that requires a separate
// history/log table — DONE_BY alone can only reflect current ownership.
// Delete + create both happen inside one transaction so a re-submit can
// never leave the date with zero rows (crash mid-way) or two rows
// (retried request racing itself, or two supervisors submitting the same
// item/day at nearly the same moment).
export const submitFillingEntries = async (req: Request, res: Response) => {
  try {
    const { doneBy, date, entries } = req.body;

    if (!doneBy) {
      return res
        .status(400)
        .json({ success: false, message: "doneBy is required" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "entries array is required" });
    }

    const supervisor = await prisma.employee.findUnique({
      where: { EMP_ID: doneBy },
    });
    if (!supervisor || supervisor.EMPTYPE !== "PPSUPERVISOR") {
      return res
        .status(403)
        .json({ success: false, message: "Only PPSUPERVISOR can submit" });
    }

    // Only submit rows that are fully filled
    const validEntries = entries.filter(
      (e: any) => e.operatorId && e.filling !== "" && e.wastage !== "",
    );
    if (validEntries.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No complete entries to submit" });
    }

    const { start, end } = dayRange(date);
    const sessionId = `FP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    // Delete-then-insert per item, inside a single transaction: for each
    // valid entry, first remove ANY prior row for that item on that date —
    // no matter which supervisor created it — then create the fresh one
    // owned by the current submitter. This is the shared-per-day behavior:
    // the delete is scoped to ITMCD + date only, so B's submit will remove
    // A's earlier row for the same item/day and replace it with B's.
    const ops = validEntries.flatMap((entry: any) => [
      prisma.fillingEntry.deleteMany({
        where: {
          ITMCD: entry.itmcd,
          CREATEDAT: { gte: start, lte: end },
        },
      }),
      prisma.fillingEntry.create({
        data: {
          SESSION_ID: sessionId,
          ITMCD: entry.itmcd,
          ITMNM: entry.itmnm,
          ITMSUBCAT: entry.itmsubcat ?? null,
          BATCH_NO: entry.batchNo ? String(entry.batchNo).trim() : null,
          FILLING: Number(entry.filling),
          WASTAGE: Number(entry.wastage),
          OPERATOR_ID: entry.operatorId,
          DONE_BY: doneBy,
          // Keep CREATEDAT inside the requested date's range rather than
          // "now", so an entry submitted for a past date still shows up
          // when that date is reloaded (and doesn't leak into "today").
          CREATEDAT: date ? start : undefined,
        },
      }),
    ]);

    const results = await prisma.$transaction(ops);
    // Every other item in `ops` is the create() result; count those.
    const created = results.filter((_: unknown, i: number) => i % 2 === 1);

    res.status(201).json({
      success: true,
      message: `${created.length} entries saved`,
      data: { sessionId, count: created.length },
    });
  } catch (error) {
    console.error("submitFillingEntries error", error);
    res.status(500).json({ success: false, message: "Failed to save entries" });
  }
};

// GET /filling/history?date=YYYY-MM-DD
// Returns all sessions for a given date (defaults to today)
export const getFillingHistory = async (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date as string | undefined;
    const { start, end } = dayRange(dateParam);

    const entries = await prisma.fillingEntry.findMany({
      where: {
        CREATEDAT: { gte: start, lte: end },
      },
      include: {
        operator: { select: { EMPNAME: true, EMPFNAME: true } },
        doneBy: { select: { EMPNAME: true, EMPFNAME: true } },
      },
      orderBy: { CREATEDAT: "desc" },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error("getFillingHistory error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch history" });
  }
};

// GET /filling/today-entries?supervisorId=...&date=YYYY-MM-DD
// Despite the name (kept for backward compatibility) AND despite still
// requiring supervisorId as a param (kept so existing frontend calls don't
// need to change shape), this NO LONGER scopes results to that supervisor.
//
// SHARED-PER-DAY MODEL: any PPSUPERVISOR fetching a given date sees every
// item's saved entry for that date, regardless of who (which DONE_BY)
// created it. supervisorId is currently unused for filtering — it's
// accepted but ignored, kept only for backward request-shape compatibility
// and in case it's needed again later (e.g. for a "highlight rows I
// personally entered" UI, which would need a look at DONE_BY per-row
// rather than filtering the whole query by it).
export const getTodayFillingEntries = async (req: Request, res: Response) => {
  try {
    const { supervisorId, date } = req.query;
    if (!supervisorId) {
      return res
        .status(400)
        .json({ success: false, message: "supervisorId is required" });
    }

    const { start, end } = dayRange(date as string | undefined);

    const entries = await prisma.fillingEntry.findMany({
      where: {
        // NOTE: no DONE_BY filter here — this is the shared-per-day read.
        CREATEDAT: { gte: start, lte: end },
      },
      include: {
        operator: { select: { EMPNAME: true, EMPFNAME: true, EMPDESG: true } },
      },
      orderBy: { CREATEDAT: "desc" },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error("getTodayFillingEntries error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch today entries" });
  }
};

export const getFillingMonthlyHistory = async (req: Request, res: Response) => {
  try {
    const yearParam = req.query.year as string | undefined;
    const monthParam = req.query.month as string | undefined; // 0-based, like /attendance/month
 
    const now = new Date();
    const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
    const month0 = monthParam !== undefined ? parseInt(monthParam, 10) : now.getMonth();
 
    if (Number.isNaN(year) || Number.isNaN(month0) || month0 < 0 || month0 > 11) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid year or month" });
    }
 
    const { start, end } = monthRange(year, month0);
    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
 
    const entries = await prisma.fillingEntry.findMany({
      where: {
        CREATEDAT: { gte: start, lte: end },
      },
      select: {
        ITMCD: true,
        ITMNM: true,
        ITMSUBCAT: true,
        FILLING: true,
        CREATEDAT: true,
      },
      orderBy: { CREATEDAT: "asc" },
    });
 
    // Group by ITMCD, building a fixed-length days[] array per item.
    // Using a Map (not a plain object) to avoid any surprises if an ITMCD
    // ever collided with an Object.prototype key.
    type Row = {
      itmcd: string;
      itmnm: string;
      itmsubcat: string | null;
      days: (number | null)[];
      total: number;
    };
    const byItem = new Map<string, Row>();
 
    for (const entry of entries) {
      let row = byItem.get(entry.ITMCD);
      if (!row) {
        row = {
          itmcd: entry.ITMCD,
          itmnm: entry.ITMNM,
          itmsubcat: entry.ITMSUBCAT ?? null,
          days: new Array(daysInMonth).fill(null),
          total: 0,
        };
        byItem.set(entry.ITMCD, row);
      }
 
      // entries are ordered CREATEDAT asc, so the last write here for a
      // given ITMCD is naturally the most recent name — no extra sort needed.
      row.itmnm = entry.ITMNM;
      row.itmsubcat = entry.ITMSUBCAT ?? row.itmsubcat;
 
      // CREATEDAT is a full timestamp; convert to a 1..daysInMonth day index.
      // Using getDate() on the raw Date is correct here because CREATEDAT
      // was written in server-local time by submitFillingEntries (it reused
      // dayRange's `start`, which is itself server-local midnight) — so no
      // timezone conversion is needed to recover "which day of the month"
      // from it. This mirrors how submitFillingEntries wrote it in the
      // first place.
      const dayIndex = entry.CREATEDAT.getDate() - 1; // 0-based
      if (dayIndex >= 0 && dayIndex < daysInMonth) {
        const amount = Number(entry.FILLING);
        row.days[dayIndex] = amount;
        row.total += amount;
      }
    }
 
    const items = Array.from(byItem.values()).sort((a, b) =>
      a.itmnm.localeCompare(b.itmnm),
    );
 
    res.json({
      success: true,
      data: { year, month: month0, daysInMonth, items },
    });
  } catch (error) {
    console.error("getFillingMonthlyHistory error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch monthly history" });
  }
};