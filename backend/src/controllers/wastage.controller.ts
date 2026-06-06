import { Request, Response } from "express";
import prisma from "../util/prisma";

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
// Body: { doneBy: string, entries: [{ itmcd, itmnm, itmsubcat, cartonWastage, pcsWastage, looseOil }] }
export const submitWastageEntries = async (req: Request, res: Response) => {
  try {
    const { doneBy, entries } = req.body;

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

    const sessionId = `WP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const created = await prisma.$transaction(
      validEntries.map((entry: any) =>
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
          },
        })
      )
    );

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

// GET /wastage/today-entries?supervisorId=xxx
// Returns today's wastage entries for the given supervisor (most recent first per item)
export const getTodayWastageEntries = async (req: Request, res: Response) => {
  try {
    const { supervisorId } = req.query;
    if (!supervisorId) {
      return res.status(400).json({ success: false, message: "supervisorId is required" });
    }

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);

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
    const date  = dateParam ? new Date(dateParam) : new Date();
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

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