import { Request, Response } from "express";
import prisma from "../util/prisma";

// Small helper: given a "YYYY-MM-DD" string (or nothing, meaning today),
// return the [start, end] Date range covering that whole calendar day.
// Same helper as the filling controller — used both when reading entries
// for a date and when deciding which existing rows count as "the same
// date" for delete-then-insert.
const dayRange = (dateParam?: string) => {
  const base = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

// GET /wastage/items
// Returns all items from mstitm ordered by subcat + name
export const getWastageItems = async (_req: Request, res: Response) => {
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
    console.error("getWastageItems error", error);
    res.status(500).json({ success: false, message: "Failed to fetch items" });
  }
};

// POST /wastage/submit
// Body: { doneBy: string, date?: "YYYY-MM-DD", entries: [{ itmcd, itmnm, itmsubcat, cartonWastage, pcsWastage, looseOil }] }
//
// "date" is the calendar date the supervisor is recording wastage for
// (defaults to today if omitted, so existing callers keep working). For
// every valid entry we DELETE any existing WastageEntry rows for that same
// (ITMCD, DONE_BY, date) before inserting the new one, so re-submitting the
// same date updates in place instead of piling up duplicate rows. Delete +
// create both happen inside one transaction, same reasoning as filling: a
// re-submit can never leave the date with zero rows (crash mid-way) or two
// rows (retried request racing itself).
export const submitWastageEntries = async (req: Request, res: Response) => {
  try {
    const { doneBy, date, entries } = req.body;

    if (!doneBy) {
      return res.status(400).json({ success: false, message: "doneBy is required" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: "entries array is required" });
    }

    const supervisor = await prisma.employee.findUnique({ where: { EMP_ID: doneBy } });
    if (!supervisor || supervisor.EMPTYPE !== "PPSUPERVISOR") {
      return res.status(403).json({ success: false, message: "Only PPSUPERVISOR can submit wastage entries" });
    }

    // Only submit rows that have at least one non-empty value
    const validEntries = entries.filter(
      (e: any) =>
        e.cartonWastage !== "" || e.pcsWastage !== "" || e.looseOil !== ""
    );
    if (validEntries.length === 0) {
      return res.status(400).json({ success: false, message: "No entries to submit" });
    }

    const { start, end } = dayRange(date);
    const sessionId = `WP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    // Delete-then-insert per item, inside a single transaction: for each
    // valid entry, first remove any prior row for that item/supervisor/date,
    // then create the fresh one. Scoped to DONE_BY as well as ITMCD + date,
    // so one supervisor's re-submit never touches another supervisor's
    // entry for the same item on the same day.
    const ops = validEntries.flatMap((entry: any) => [
      prisma.wastageEntry.deleteMany({
        where: {
          ITMCD: entry.itmcd,
          DONE_BY: doneBy,
          CREATEDAT: { gte: start, lte: end },
        },
      }),
      prisma.wastageEntry.create({
        data: {
          SESSION_ID:     sessionId,
          ITMCD:          entry.itmcd,
          ITMNM:          entry.itmnm,
          ITMSUBCAT:      entry.itmsubcat ?? null,
          CARTON_WASTAGE: entry.cartonWastage !== "" ? Number(entry.cartonWastage) : 0,
          PCS_WASTAGE:    entry.pcsWastage    !== "" ? Number(entry.pcsWastage)    : 0,
          LOOSE_OIL:      entry.looseOil      !== "" ? Number(entry.looseOil)      : null,
          DONE_BY:        doneBy,
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
      message: `${created.length} wastage entries saved`,
      data: { sessionId, count: created.length },
    });
  } catch (error) {
    console.error("submitWastageEntries error", error);
    res.status(500).json({ success: false, message: "Failed to save wastage entries" });
  }
};

// GET /wastage/today-entries?supervisorId=xxx&date=YYYY-MM-DD
// Despite the name (kept for backward compatibility), this now returns the
// supervisor's saved entries for ANY given date, defaulting to today when
// "date" is omitted — same convention as filling's today-entries. The
// frontend uses this both on initial load and whenever the date picker
// changes.
export const getTodayWastageEntries = async (req: Request, res: Response) => {
  try {
    const { supervisorId, date } = req.query;
    if (!supervisorId) {
      return res.status(400).json({ success: false, message: "supervisorId is required" });
    }

    const { start, end } = dayRange(date as string | undefined);

    const entries = await prisma.wastageEntry.findMany({
      where: {
        DONE_BY:   supervisorId as string,
        CREATEDAT: { gte: start, lte: end },
      },
      orderBy: { CREATEDAT: "desc" },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error("getTodayWastageEntries error", error);
    res.status(500).json({ success: false, message: "Failed to fetch today wastage entries" });
  }
};

// GET /wastage/history?date=YYYY-MM-DD
export const getWastageHistory = async (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date as string | undefined;
    const { start, end } = dayRange(dateParam);

    const entries = await prisma.wastageEntry.findMany({
      where: { CREATEDAT: { gte: start, lte: end } },
      include: { doneBy: { select: { EMPNAME: true, EMPFNAME: true } } },
      orderBy: { CREATEDAT: "desc" },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error("getWastageHistory error", error);
    res.status(500).json({ success: false, message: "Failed to fetch wastage history" });
  }
};