import { Request, Response } from "express";
import prisma from "../util/prisma";

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
// Body: { doneBy: string, entries: [{ itmcd, itmnm, itmsubcat, filling, wastage, operatorId }] }
export const submitFillingEntries = async (req: Request, res: Response) => {
  try {
    const { doneBy, entries } = req.body;

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

    const sessionId = `FP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const created = await prisma.$transaction(
      validEntries.map((entry: any) =>
        prisma.fillingEntry.create({
          data: {
            SESSION_ID: sessionId,
            ITMCD: entry.itmcd,
            ITMNM: entry.itmnm,
            ITMSUBCAT: entry.itmsubcat ?? null,
            FILLING: Number(entry.filling),
            WASTAGE: Number(entry.wastage),
            OPERATOR_ID: entry.operatorId,
            DONE_BY: doneBy,
          },
        }),
      ),
    );

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
    const date = dateParam ? new Date(dateParam) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

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

export const getTodayFillingEntries = async (req: Request, res: Response) => {
  try {
    const { supervisorId } = req.query;
    if (!supervisorId) {
      return res
        .status(400)
        .json({ success: false, message: "supervisorId is required" });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const entries = await prisma.fillingEntry.findMany({
      where: {
        DONE_BY: supervisorId as string,
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
