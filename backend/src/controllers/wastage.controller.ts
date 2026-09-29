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
const monthRange = (year: number, month0: number) => {
  const start = new Date(year, month0, 1, 0, 0, 0, 0);
  const end = new Date(year, month0 + 1, 0, 23, 59, 59, 999);
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
// (defaults to today if omitted, so existing callers keep working).
//
// SHARED-PER-DAY MODEL: a row's identity is (ITMCD, date) — NOT
// (ITMCD, DONE_BY, date). Any PPSUPERVISOR can see and overwrite any other
// supervisor's entry for the same item/day. For every valid entry we
// DELETE any existing WastageEntry row for that (ITMCD, date) — regardless
// of who created it — before inserting the new one with DONE_BY set to
// whoever is submitting now. This is intentionally an "ownership transfers
// to last editor" model: the new submitter becomes the row's DONE_BY, and
// the previous author is not retained anywhere once overwritten. If an
// audit trail of prior authors is ever needed, that requires a separate
// history/log table — DONE_BY alone can only reflect current ownership.
// Delete + create both happen inside one transaction, same reasoning as
// filling: a re-submit can never leave the date with zero rows (crash
// mid-way) or two rows (retried request racing itself, or two supervisors
// submitting the same item/day at nearly the same moment).
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
    // valid entry, first remove ANY prior row for that item on that date —
    // no matter which supervisor created it — then create the fresh one
    // owned by the current submitter. This is the shared-per-day behavior:
    // the delete is scoped to ITMCD + date only, so B's submit will remove
    // A's earlier row for the same item/day and replace it with B's.
    const ops = validEntries.flatMap((entry: any) => [
      prisma.wastageEntry.deleteMany({
        where: {
          ITMCD: entry.itmcd,
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
// Despite the name (kept for backward compatibility) AND despite still
// requiring supervisorId as a param (kept so existing frontend calls don't
// need to change shape), this NO LONGER scopes results to that supervisor.
//
// SHARED-PER-DAY MODEL: any PPSUPERVISOR fetching a given date sees every
// item's saved entry for that date, regardless of who (which DONE_BY)
// created it — same convention as filling's today-entries. supervisorId is
// currently unused for filtering — accepted but ignored, kept only for
// backward request-shape compatibility.
export const getTodayWastageEntries = async (req: Request, res: Response) => {
  try {
    const { supervisorId, date } = req.query;
    if (!supervisorId) {
      return res.status(400).json({ success: false, message: "supervisorId is required" });
    }

    const { start, end } = dayRange(date as string | undefined);

    const entries = await prisma.wastageEntry.findMany({
      where: {
        // NOTE: no DONE_BY filter here — this is the shared-per-day read.
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

export const getWastageMonthlyHistory = async (req: Request, res: Response) => {
  try {
    const yearParam = req.query.year as string | undefined;
    const monthParam = req.query.month as string | undefined;
 
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
 
    const entries = await prisma.wastageEntry.findMany({
      where: {
        CREATEDAT: { gte: start, lte: end },
      },
      select: {
        ITMCD: true,
        ITMNM: true,
        ITMSUBCAT: true,
        CARTON_WASTAGE: true,
        PCS_WASTAGE: true,
        LOOSE_OIL: true,
        CREATEDAT: true,
      },
      orderBy: { CREATEDAT: "asc" },
    });
 
    type MetricSeries = { days: (number | null)[]; total: number };
    type Row = {
      itmcd: string;
      itmnm: string;
      itmsubcat: string | null;
      cartonWastage: MetricSeries;
      pcsWastage: MetricSeries;
      looseOil: MetricSeries;
    };
 
    const emptySeries = (): MetricSeries => ({
      days: new Array(daysInMonth).fill(null),
      total: 0,
    });
 
    const byItem = new Map<string, Row>();
 
    for (const entry of entries) {
      let row = byItem.get(entry.ITMCD);
      if (!row) {
        row = {
          itmcd: entry.ITMCD,
          itmnm: entry.ITMNM,
          itmsubcat: entry.ITMSUBCAT ?? null,
          cartonWastage: emptySeries(),
          pcsWastage: emptySeries(),
          looseOil: emptySeries(),
        };
        byItem.set(entry.ITMCD, row);
      }
 
      // entries are CREATEDAT asc, so the last write per ITMCD is the most
      // recent name — matches the same convention used for filling.
      row.itmnm = entry.ITMNM;
      row.itmsubcat = entry.ITMSUBCAT ?? row.itmsubcat;
 
      // Same server-local-day derivation as filling's monthly-history:
      // CREATEDAT was written using dayRange's server-local `start`, so
      // getDate() recovers the intended day-of-month without any timezone
      // conversion.
      const dayIndex = entry.CREATEDAT.getDate() - 1;
      if (dayIndex < 0 || dayIndex >= daysInMonth) continue;
 
      // CARTON_WASTAGE / PCS_WASTAGE are never null on a saved row (see
      // the file-level comment above), but Number(...) defensively handles
      // it anyway rather than assuming the invariant holds forever.
      const cartons = entry.CARTON_WASTAGE !== null ? Number(entry.CARTON_WASTAGE) : null;
      const pcs = entry.PCS_WASTAGE !== null ? Number(entry.PCS_WASTAGE) : null;
      // LOOSE_OIL genuinely can be null on a saved row — left as null
      // rather than coerced to 0, so the grid can show "—" instead of a
      // misleading "0" for oil that was never recorded that day.
      const oil = entry.LOOSE_OIL !== null && entry.LOOSE_OIL !== undefined
        ? Number(entry.LOOSE_OIL)
        : null;
 
      if (cartons !== null) {
        row.cartonWastage.days[dayIndex] = cartons;
        row.cartonWastage.total += cartons;
      }
      if (pcs !== null) {
        row.pcsWastage.days[dayIndex] = pcs;
        row.pcsWastage.total += pcs;
      }
      if (oil !== null) {
        row.looseOil.days[dayIndex] = oil;
        row.looseOil.total += oil;
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
    console.error("getWastageMonthlyHistory error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch monthly wastage history" });
  }
};