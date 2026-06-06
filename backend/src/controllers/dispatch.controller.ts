import { Request, Response } from "express";
import prisma from "../util/prisma";

// ─── GET /dispatch/parties ────────────────────────────────────────────────────
// Returns mstparty entries for the "Direct to Party" picker
export const getParties = async (_req: Request, res: Response) => {
  try {
    const parties = await prisma.mstparty.findMany({
      select: { ledcd: true, lednm: true, areacd: true, areanm: true },
      orderBy: { lednm: "asc" },
    });
    res.json({ success: true, data: parties });
  } catch (error) {
    console.error("getParties error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch parties" });
  }
};

// ─── GET /dispatch/depos ──────────────────────────────────────────────────────
// Returns mstunit entries for the "Own Depo" picker
export const getDepos = async (_req: Request, res: Response) => {
  try {
    const depos = await prisma.mstunit.findMany({
      select: { untcd: true, untshnm: true, untnm: true },
      orderBy: { untnm: "asc" },
    });
    res.json({ success: true, data: depos });
  } catch (error) {
    console.error("getDepos error", error);
    res.status(500).json({ success: false, message: "Failed to fetch depos" });
  }
};

// ─── GET /dispatch/items ──────────────────────────────────────────────────────
// Returns mstitm for item picker
export const getDispatchItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.mstitm.findMany({
      select: { itmcd: true, itmnm: true, itmsubcat: true, pcksz: true },
      orderBy: [{ itmsubcat: "asc" }, { itmnm: "asc" }],
    });
    res.json({ success: true, data: items });
  } catch (error) {
    console.error("getDispatchItems error", error);
    res.status(500).json({ success: false, message: "Failed to fetch items" });
  }
};

// ─── POST /dispatch/sessions ──────────────────────────────────────────────────
// OFFICE user creates/saves a draft session
// Body: { doneBy, dispatchTo, partyCd, partyNm, vehicleNo, transporter,
//         driverName, driverNo, kaantaWt, grrNo, items, emptyItems }
export const createDispatchSession = async (req: Request, res: Response) => {
  try {
    const {
      doneBy,
      dispatchTo,
      partyCd,
      partyNm,
      vehicleNo,
      transporter,
      driverName,
      driverNo,
      kaantaWt,
      grrNo,
      items = [],
      emptyItems = [],
    } = req.body;

    if (!doneBy || !dispatchTo || !partyCd || !partyNm) {
      return res
        .status(400)
        .json({
          success: false,
          message: "doneBy, dispatchTo, partyCd, partyNm are required",
        });
    }

    const employee = await prisma.employee.findUnique({
      where: { EMP_ID: doneBy },
    });
    if (!employee || employee.EMPTYPE !== "OFFICE") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only OFFICE users can create dispatch sessions",
        });
    }

    const session = await prisma.dispatchSession.create({
      data: {
        DISPATCH_TO: dispatchTo,
        PARTY_CD: partyCd,
        PARTY_NM: partyNm,
        VEHICLE_NO: vehicleNo || null,
        TRANSPORTER: transporter || null,
        DRIVER_NAME: driverName || null,
        DRIVER_NO: driverNo || null,
        KAANTA_WT: kaantaWt || null,
        GRR_NO: grrNo || null,
        STATUS: "DRAFT",
        DONE_BY: doneBy,
        items: {
          create: items.map((i: any) => ({
            ITMCD: i.itmcd,
            ITMNM: i.itmnm,
            QTY: Number(i.qty),
          })),
        },
        emptyItems: {
          create: emptyItems.map((i: any) => ({
            ITMCD: i.itmcd,
            ITMNM: i.itmnm,
            QTY: Number(i.qty),
          })),
        },
      },
      include: { items: true, emptyItems: true },
    });

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    console.error("createDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create dispatch session" });
  }
};

// ─── PUT /dispatch/sessions/:sessionId ───────────────────────────────────────
// OFFICE user updates an existing draft session (full replace of items)
export const updateDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const {
      doneBy,
      dispatchTo,
      partyCd,
      partyNm,
      vehicleNo,
      transporter,
      driverName,
      driverNo,
      kaantaWt,
      grrNo,
      items = [],
      emptyItems = [],
    } = req.body;

    const existing = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    if (existing.STATUS === "COMPLETED") {
      return res
        .status(400)
        .json({ success: false, message: "Cannot edit a completed session" });
    }

    // Replace items atomically
    await prisma.$transaction([
      prisma.dispatchItem.deleteMany({
        where: { SESSION_ID: sessionId as string },
      }),
      prisma.dispatchEmptyItem.deleteMany({
        where: { SESSION_ID: sessionId as string },
      }),
      prisma.dispatchSession.update({
        where: { SESSION_ID: sessionId as string },
        data: {
          DISPATCH_TO: dispatchTo,
          PARTY_CD: partyCd,
          PARTY_NM: partyNm,
          VEHICLE_NO: vehicleNo || null,
          TRANSPORTER: transporter || null,
          DRIVER_NAME: driverName || null,
          DRIVER_NO: driverNo || null,
          KAANTA_WT: kaantaWt || null,
          GRR_NO: grrNo || null,
        },
      }),
      ...items.map((i: any) =>
        prisma.dispatchItem.create({
          data: {
            SESSION_ID: sessionId as string,
            ITMCD: i.itmcd,
            ITMNM: i.itmnm,
            QTY: Number(i.qty),
          },
        }),
      ),
      ...emptyItems.map((i: any) =>
        prisma.dispatchEmptyItem.create({
          data: {
            SESSION_ID: sessionId as string,
            ITMCD: i.itmcd,
            ITMNM: i.itmnm,
            QTY: Number(i.qty),
          },
        }),
      ),
    ]);

    const updated = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
      include: { items: true, emptyItems: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("updateDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update session" });
  }
};

// ─── GET /dispatch/sessions/today ────────────────────────────────────────────
// Returns today's DRAFT sessions for PPSUPERVISOR to pick up
// Also used by OFFICE to see their own drafts (filter by doneBy)
export const getTodaySessions = async (req: Request, res: Response) => {
  try {
    const { doneBy, status } = req.query;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const where: any = { CREATEDAT: { gte: start, lte: end } };
    if (doneBy) where.DONE_BY = doneBy as string;
    if (status) where.STATUS = status as string;

    const sessions = await prisma.dispatchSession.findMany({
      where,
      include: {
        items: true,
        emptyItems: true,
        doneBy: { select: { EMPNAME: true, EMPFNAME: true } },
      },
      orderBy: { CREATEDAT: "desc" },
    });

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("getTodaySessions error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch sessions" });
  }
};

// ─── GET /dispatch/sessions/:sessionId ───────────────────────────────────────
export const getSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
      include: {
        items: true,
        emptyItems: true,
        doneBy: { select: { EMPNAME: true, EMPFNAME: true } },
      },
    });
    if (!session)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    res.json({ success: true, data: session });
  } catch (error) {
    console.error("getSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch session" });
  }
};

// ─── PATCH /dispatch/sessions/:sessionId/complete ────────────────────────────
// PPSUPERVISOR fills in FULL_BOX_WT for each item and marks session COMPLETED
// Body: { doneBy, items: [{ itemId, qty, fullBoxWt }], vehicleNo, transporter,
//         driverName, driverNo, kaantaWt, grrNo }
export const completeDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const {
      doneBy,
      items = [],
      vehicleNo,
      transporter,
      driverName,
      driverNo,
      kaantaWt,
      grrNo,
    } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { EMP_ID: doneBy },
    });
    if (!employee || employee.EMPTYPE !== "PPSUPERVISOR") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only PPSUPERVISOR can complete a session",
        });
    }

    const existing = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });

    await prisma.$transaction([
      // Update session header fields + mark complete
      prisma.dispatchSession.update({
        where: { SESSION_ID: sessionId as string },
        data: {
          STATUS: "COMPLETED",
          VEHICLE_NO: vehicleNo ?? existing.VEHICLE_NO,
          TRANSPORTER: transporter ?? existing.TRANSPORTER,
          DRIVER_NAME: driverName ?? existing.DRIVER_NAME,
          DRIVER_NO: driverNo ?? existing.DRIVER_NO,
          KAANTA_WT: kaantaWt ?? existing.KAANTA_WT,
          GRR_NO: grrNo ?? existing.GRR_NO,
        },
      }),
      // Update each item's qty and full box weight
      ...items.map((i: any) =>
        prisma.dispatchItem.update({
          where: { ITEM_ID: i.itemId },
          data: {
            QTY: Number(i.qty),
            FULL_BOX_WT:
              i.fullBoxWt !== "" && i.fullBoxWt != null
                ? Number(i.fullBoxWt)
                : null,
          },
        }),
      ),
    ]);

    const updated = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
      include: { items: true, emptyItems: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("completeDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to complete session" });
  }
};
