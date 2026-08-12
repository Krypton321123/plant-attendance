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
// Returns mstitm for item picker. wgtconv (weight per box) is included so the
// supervisor's loading table can compute item weight client-side as
// totalBoxes * wgtconv.
export const getDispatchItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.mstitm.findMany({
      select: {
        itmcd: true,
        itmnm: true,
        itmsubcat: true,
        pcksz: true,
        wgtconv: true,
      },
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
// Returns sessions for PPSUPERVISOR (pending queue) and OFFICE (own drafts) to
// browse. Despite the route name, this is NOT always scoped to today:
//
//   - status=DRAFT (the supervisor's pending-work queue): NO date filter.
//     A draft created yesterday (or last week) and never completed is still
//     pending today, so it must keep showing up until someone completes it —
//     filtering it out by CREATEDAT was the original bug here. The supervisor
//     should see every outstanding draft regardless of when it was created.
//   - any other/absent status (e.g. OFFICE browsing what THEY created today,
//     or a completed-sessions report): keeps the original today-only window,
//     since "today's sessions" is the literal, correct meaning there.
//
// Ordering is always CREATEDAT desc, so the most recently created session
// (today's or an older pending one) is always first regardless of which
// branch above applies.
export const getTodaySessions = async (req: Request, res: Response) => {
  try {
    const { doneBy, status } = req.query;

    const where: any = {};

    if (status !== "DRAFT") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      where.CREATEDAT = { gte: start, lte: end };
    }

    if (doneBy) where.DONE_BY = doneBy as string;
    if (status) where.STATUS = status as string;

    const sessions = await prisma.dispatchSession.findMany({
      where,
      include: {
        items: { include: { loadingEntries: true } },
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
        items: { include: { loadingEntries: true } },
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
// PPSUPERVISOR records loading entries (length/width/height/extra) and the
// actual measured average weight per box for each item, and marks the
// session COMPLETED.
// Body: { doneBy, items: [{ itemId, qty, avgWtPerBox, loadingEntries: [{
//         length, width, height, extra }] }], vehicleNo, transporter,
//         driverName, driverNo, kaantaWt, grrNo }
// avgWtPerBox is the supervisor's actual measured average weight per box for
// the item (distinct from mstitm.wgtconv, the fixed catalog rate used for the
// existing "Weight" figure). It is required — every item must carry a value
// before a session can be completed; validated below so a bad/missing value
// never reaches the transaction.
// Note: vehicleNo/transporter/driverName/driverNo/kaantaWt/grrNo are accepted
// for backward compatibility (existing sessions may still carry them from the
// OFFICE-side create step) but are no longer editable from the supervisor's
// form; if omitted, the session's existing values are left untouched.
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

    // avgWtPerBox is required per item — reject before the transaction if any
    // item is missing a valid positive value, rather than silently writing
    // null and letting gross weight go missing downstream.
    const missingAvgWt = items.some((i: any) => {
      const v = Number(i.avgWtPerBox);
      return i.avgWtPerBox === "" || i.avgWtPerBox == null || !Number.isFinite(v) || v <= 0;
    });
    if (missingAvgWt) {
      return res.status(400).json({
        success: false,
        message: "Average weight per box is required for every item",
      });
    }

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
      // For each item: update qty + avg weight per box, then fully replace
      // its loading entries
      ...items.flatMap((i: any) => {
        const entries = i.loadingEntries ?? [];
        return [
          prisma.dispatchItem.update({
            where: { ITEM_ID: i.itemId },
            data: {
              QTY: Number(i.qty),
              AVG_WT_PER_BOX: Number(i.avgWtPerBox),
            },
          }),
          prisma.dispatchLoadingEntry.deleteMany({
            where: { ITEM_ID: i.itemId },
          }),
          ...entries.map((e: any) =>
            prisma.dispatchLoadingEntry.create({
              data: {
                ITEM_ID: i.itemId,
                LENGTH: Number(e.length),
                WIDTH: Number(e.width),
                HEIGHT: Number(e.height),
                EXTRA: e.extra !== "" && e.extra != null ? Number(e.extra) : 0,
              },
            }),
          ),
        ];
      }),
    ]);

    const updated = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
      include: {
        items: { include: { loadingEntries: true } },
        emptyItems: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("completeDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to complete session" });
  }
};