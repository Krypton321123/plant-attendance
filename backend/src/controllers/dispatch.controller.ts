import { Request, Response } from "express";
import prisma from "../util/prisma";

// Shared helper: parse totalFreight/advance and compute the server-side
// balance. Balance is NEVER accepted from the client — it's always derived
// here so it can't drift from (freight - advance).
function computeFreightBalance(totalFreight: any, advance: any) {
  const totalFreightVal =
    totalFreight === "" || totalFreight == null ? null : Number(totalFreight);
  const advanceVal = advance === "" || advance == null ? null : Number(advance);
  const balanceVal =
    totalFreightVal != null &&
    advanceVal != null &&
    Number.isFinite(totalFreightVal) &&
    Number.isFinite(advanceVal)
      ? totalFreightVal - advanceVal
      : null;
  return { totalFreightVal, advanceVal, balanceVal };
}

// Small helper for the plain "just input" weight fields (gross/tare/total) —
// pass the value through as-is (Prisma coerces string -> Decimal), or null
// for blank/missing.
const orNull = (v: any) => (v === "" || v == null ? null : v);

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
// OFFICE user creates a session. Always created as DRAFT — it only becomes
// visible to PPSUPERVISOR once explicitly sent (see sendDispatchSession).
// Only Dispatch Details (party/depo + items) and Empty Material Details are
// collected here. Transporter Details and Weight/Freight Details are NOT
// part of session creation anymore — those are filled by OFFICE later, at
// finalize time (see finalizeDispatchSession), after PPSUPERVISOR has
// completed loading. They're written as null here unconditionally.
export const createDispatchSession = async (req: Request, res: Response) => {
  try {
    const {
      doneBy,
      dispatchTo,
      partyCd,
      partyNm,
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
        // Transporter + Weight/Freight fields don't exist yet at this stage
        // of the flow — they're filled by OFFICE at finalize time, only
        // after PPSUPERVISOR has completed loading. See
        // finalizeDispatchSession.
        VEHICLE_NO: null,
        BILTY_NO: null,
        TRANSPORTER: null,
        DRIVER_NAME: null,
        DRIVER_NO: null,
        GRR_NO: null,
        GROSS_WT: null,
        TARE_WT: null,
        TOTAL_WT: null,
        TOTAL_FREIGHT: null,
        ADVANCE: null,
        BALANCE: null,
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
// OFFICE user updates Dispatch Details (party/depo + items) and Empty
// Material Details — a full replace of items/emptyItems. Allowed only while
// STATUS is DRAFT (not yet sent) or PENDING (sent, but PPSUPERVISOR hasn't
// completed loading yet) — office can keep correcting these fields right up
// until the supervisor finishes. Once PPSUPERVISOR marks the session
// COMPLETED, these fields are frozen for OFFICE — this endpoint no longer
// accepts writes at that point. OFFICE's remaining data-entry (Transporter +
// Weight/Freight Details) goes through finalizeDispatchSession instead, and
// is not handled here.
export const updateDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const {
      dispatchTo,
      partyCd,
      partyNm,
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
    if (existing.STATUS !== "DRAFT" && existing.STATUS !== "PENDING") {
      return res.status(400).json({
        success: false,
        message:
          existing.STATUS === "COMPLETED"
            ? "Dispatch and empty material details are locked once the supervisor has completed loading"
            : "Cannot edit a finalized session",
      });
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

// ─── PATCH /dispatch/sessions/:sessionId/send ────────────────────────────────
// OFFICE user finalizes a DRAFT session's Dispatch/Empty Material Details:
// makes it visible in PPSUPERVISOR's queue. Does NOT lock those fields
// against further OFFICE edits — office can still correct them via
// updateDispatchSession right up until the supervisor completes it (see that
// function's comment). This endpoint only flips DRAFT -> PENDING so it
// starts showing up for the supervisor to act on. An empty emptyItems list
// is fine — empty material isn't mandatory — but at least one dispatch item
// is still required (checked below).
// Body: { doneBy }
export const sendDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { doneBy } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { EMP_ID: doneBy },
    });
    if (!employee || employee.EMPTYPE !== "OFFICE") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only OFFICE users can send a dispatch session",
        });
    }

    const existing = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
      include: { items: true },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    if (existing.STATUS !== "DRAFT") {
      return res.status(400).json({
        success: false,
        message: "Only a draft session can be sent to the supervisor",
      });
    }
    if (existing.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Add at least one dispatch item before sending",
      });
    }

    const updated = await prisma.dispatchSession.update({
      where: { SESSION_ID: sessionId as string },
      data: { STATUS: "PENDING" },
      include: { items: true, emptyItems: true },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("sendDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to send session" });
  }
};

// ─── GET /dispatch/sessions/today ────────────────────────────────────────────
// Returns sessions for PPSUPERVISOR (pending queue) and OFFICE (own sessions,
// any status) to browse. Despite the route name, this is NOT always scoped to
// today:
//
//   - status=PENDING (the supervisor's actionable queue): NO date filter.
//     A session sent by office yesterday (or last week) and never completed
//     is still pending today, so it must keep showing up until someone
//     completes it. The supervisor should see every outstanding PENDING
//     session regardless of when it was created.
//   - doneBy present (an OFFICE user browsing their own sessions — Draft,
//     Pending, Completed, and Finalized alike): NO date filter either.
//     Office needs to see the full status/history of everything they've
//     created, not just what happened today — this is also how a
//     COMPLETED session (awaiting the office's finalize step) surfaces
//     back to them, so it must not be filtered out by date.
//   - otherwise (e.g. a completely unfiltered "today's activity" report):
//     keeps the original today-only window.
//
// Ordering is always CREATEDAT desc, so the most recently created/updated
// session is always first regardless of which branch above applies.
export const getTodaySessions = async (req: Request, res: Response) => {
  try {
    const { doneBy, status } = req.query;

    const where: any = {};

    const skipDateFilter = status === "PENDING" || Boolean(doneBy);
    if (!skipDateFilter) {
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
// session COMPLETED. Only allowed while STATUS is PENDING (i.e. OFFICE has
// sent it) — this prevents completing a session that was never sent, and
// prevents completing one twice. Once this runs, the session goes back to
// OFFICE (still under STATUS "COMPLETED") for them to fill Transporter and
// Weight/Freight Details via finalizeDispatchSession.
//
// Body: { doneBy, items: [{ itemId, qty, avgWtPerBox, loadingEntries: [{
//         length, width, height, extra }] }] }
//
// vehicleNo/biltyNo/transporter/driverName/driverNo/grrNo/weight-and-freight
// fields are NOT accepted here — those belong to OFFICE's finalize step,
// which only happens after this one.
export const completeDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { doneBy, items = [] } = req.body;

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
    if (existing.STATUS !== "PENDING") {
      return res.status(400).json({
        success: false,
        message:
          existing.STATUS === "DRAFT"
            ? "This session hasn't been sent by office yet"
            : "This session has already been completed",
      });
    }

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
      // Mark complete
      prisma.dispatchSession.update({
        where: { SESSION_ID: sessionId as string },
        data: { STATUS: "COMPLETED" },
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

// ─── PATCH /dispatch/sessions/:sessionId/finalize ────────────────────────────
// OFFICE user fills in Transporter Details and Weight/Freight Details for
// the first time, and finalizes the session. Only allowed once PPSUPERVISOR
// has completed loading (STATUS === "COMPLETED") — these fields don't exist
// before that point in this flow, since they're collected after the
// supervisor's stage rather than before it. Dispatch Details, Empty
// Material, and the supervisor's loading entries are NOT touched here —
// they're already frozen by this point (see updateDispatchSession and
// completeDispatchSession). On success, STATUS moves COMPLETED -> FINALIZED,
// which is a terminal state: nothing may write to the session after this.
//
// Body: { doneBy, vehicleNo, biltyNo, transporter, driverName, driverNo,
//         grrNo, grossWt, tareWt, totalWt, totalFreight, advance }
export const finalizeDispatchSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const {
      doneBy,
      vehicleNo,
      biltyNo,
      transporter,
      driverName,
      driverNo,
      grrNo,
      grossWt,
      tareWt,
      totalWt,
      totalFreight,
      advance,
    } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { EMP_ID: doneBy },
    });
    if (!employee || employee.EMPTYPE !== "OFFICE") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only OFFICE users can finalize a dispatch session",
        });
    }

    const existing = await prisma.dispatchSession.findUnique({
      where: { SESSION_ID: sessionId as string },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    if (existing.STATUS !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message:
          existing.STATUS === "FINALIZED"
            ? "This session has already been finalized"
            : "The supervisor hasn't completed loading for this session yet",
      });
    }

    const { totalFreightVal, advanceVal, balanceVal } = computeFreightBalance(
      totalFreight,
      advance,
    );

    const updated = await prisma.dispatchSession.update({
      where: { SESSION_ID: sessionId as string },
      data: {
        VEHICLE_NO: vehicleNo || null,
        BILTY_NO: biltyNo || null,
        TRANSPORTER: transporter || null,
        DRIVER_NAME: driverName || null,
        DRIVER_NO: driverNo || null,
        GRR_NO: grrNo || null,
        GROSS_WT: orNull(grossWt),
        TARE_WT: orNull(tareWt),
        TOTAL_WT: orNull(totalWt),
        TOTAL_FREIGHT: totalFreightVal,
        ADVANCE: advanceVal,
        BALANCE: balanceVal,
        STATUS: "FINALIZED",
      },
      include: {
        items: { include: { loadingEntries: true } },
        emptyItems: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("finalizeDispatchSession error", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to finalize session" });
  }
};