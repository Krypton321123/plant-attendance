/**
 * SalaryReportPrint: a formal, print-only salary statement.
 *
 * Renders nothing on screen. When the page is printed (Print button or Ctrl+P)
 * everything else is hidden and this statement prints on A4 landscape:
 * header, summary figures, employee table grouped by designation with
 * subtotals, grand total, basis of calculation, and signature lines.
 *
 * It does no pay maths of its own. It calls the dayMultiplier / dailyRate /
 * employeeTotals you already have in SalaryChart.tsx, so the printed figures
 * follow the same rule as the screen.
 *
 * Employees with nothing to pay are left off the statement: an amount of 0, or
 * no salary on file and no day worked. A designation with nobody left to list
 * is dropped with them. The on-screen table is not affected. Someone who
 * worked but has no salary on file stays listed, so that gap is not hidden.
 *
 * WIRE-UP in SalaryChart.tsx (4 small edits)
 *
 * 1) Imports
 *      import { ..., Printer } from "lucide-react";
 *      import SalaryReportPrint from "./SalaryReportPrint";
 *
 * 2) One flag, right after the line `const showTableContent = ...;`
 *      const canPrint =
 *        connectionStatus === "live" &&
 *        !rangeTruncated &&
 *        sortedEmployees.length > 0;
 *
 * 3) Header, right after the Refresh button's closing </button>
 *      <button
 *        onClick={() => window.print()}
 *        disabled={!canPrint}
 *        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
 *      >
 *        <Printer size={14} />
 *        Print report
 *      </button>
 *
 * 4) End of SalaryChart's return, after the legend block, before the final </div>
 *      {canPrint && (
 *        <SalaryReportPrint
 *          fromKey={fromKey}
 *          toKey={toKey}
 *          days={days}
 *          groupedEmployees={groupedEmployees}
 *          attendanceByEmpByDay={attendanceByEmpByDay}
 *          employeeTotals={employeeTotals}
 *          dayMultiplier={dayMultiplier}
 *          dailyRate={dailyRate}
 *        />
 *      )}
 *
 * The statement is only mounted while canPrint is true, so pressing Ctrl+P on
 * a loading or error screen prints the normal page, never an empty statement.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";

/** Printed at the top of the statement. Leave empty to omit. */
const ORG_NAME = "";

// Minimal structural types so this file needn't import from SalaryChart.tsx.
interface EmployeeLike {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  SALARY?: number | null;
}
interface ShiftLike {
  STATUS: "P" | "A";
  OT_STATUS?: "OT" | "HALF_OT" | "NO_OT" | null;
}
interface BucketLike {
  day?: ShiftLike;
  night?: ShiftLike;
}

interface Props {
  fromKey: string;
  toKey: string;
  days: string[];
  groupedEmployees: { designation: string; members: EmployeeLike[] }[];
  attendanceByEmpByDay: Record<string, Record<string, BucketLike>>;
  employeeTotals: Map<string, number | null>;
  // Method syntax on purpose: keeps parameter checking bivariant so the
  // page's own (wider-typed) functions can be passed straight in.
  dayMultiplier(bucket: BucketLike): number;
  dailyRate(salary: number | null | undefined): number | null;
}

// ── Formatting ─────────────────────────────────────────────────────────────

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const rupees = (n: number | null) => (n === null ? "—" : inr0.format(n));
const dayCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const stampFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const stampNow = () => `${stampFmt.format(new Date())} IST`;

// ── Print stylesheet ───────────────────────────────────────────────────────

const CSS = `
@page {
  size: A4 landscape;
  margin: 12mm 10mm 15mm;
  @bottom-left { content: "System-generated salary statement"; font: 7.5pt "Segoe UI", Arial, sans-serif; color: #555; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Segoe UI", Arial, sans-serif; color: #555; }
}
.sr-root { display: none; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.sr-root) { display: none !important; }
  .sr-root { display: block; color: #000; font: 8.5pt/1.4 "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .sr-root, .sr-root * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .sr-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16pt; padding-bottom: 7pt; border-bottom: 2pt solid #000; }
  .sr-org { margin-bottom: 2pt; font-size: 10pt; font-weight: 600; }
  .sr-title { margin: 0; font: 700 21pt/1.1 Georgia, "Times New Roman", serif; }
  .sr-meta { display: grid; grid-template-columns: auto auto; gap: 1.5pt 12pt; margin: 0; }
  .sr-meta dt { color: #555; }
  .sr-meta dd { margin: 0; font-weight: 600; }

  .sr-kpis { display: flex; margin: 9pt 0 10pt; border: .5pt solid #888; }
  .sr-kpis > div { flex: 1; padding: 5pt 9pt; border-right: .5pt solid #888; }
  .sr-kpis > div:last-child { border-right: 0; background: #ececec; }
  .sr-kpis span { display: block; color: #555; font-size: 7.5pt; }
  .sr-kpis b { font-size: 13pt; font-variant-numeric: tabular-nums; }

  .sr-t { width: 100%; table-layout: fixed; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .sr-t th, .sr-t td { padding: 3pt 5pt; border: .4pt solid #999; text-align: right; }
  .sr-t th { background: #e6e6e6; font-size: 7.5pt; font-weight: 700; text-align: center; vertical-align: middle; }
  .sr-t tr { break-inside: avoid; }
  .sr-t .sr-l { text-align: left; }
  .sr-t .sr-c { text-align: center; }
  .sr-grp td { background: #f2f2f2; font-weight: 700; text-align: left; }
  .sr-grp small { margin-left: 4pt; color: #555; font-size: 8pt; font-weight: 400; }
  .sr-sub td { font-weight: 700; }
  .sr-tot td { background: #e6e6e6; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; font-size: 10pt; font-weight: 700; }
  .sr-t .sr-none { padding: 12pt 5pt; color: #555; }

  .sr-notes { margin-top: 12pt; color: #333; font-size: 7.5pt; break-inside: avoid; }
  .sr-notes h2 { margin: 0 0 2pt; color: #000; font-size: 8pt; }
  .sr-notes p { margin: 0 0 2pt; }

  .sr-sign { display: flex; gap: 28pt; margin-top: 34pt; break-inside: avoid; }
  .sr-sign div { flex: 1; padding-top: 3pt; border-top: .75pt solid #000; font-size: 8.5pt; text-align: center; }
}
`;

// ── Component ──────────────────────────────────────────────────────────────

export default function SalaryReportPrint({
  fromKey,
  toKey,
  days,
  groupedEmployees,
  attendanceByEmpByDay,
  employeeTotals,
  dayMultiplier,
  dailyRate,
}: Props) {
  const period = `${longDate(fromKey)} to ${longDate(toKey)}`;
  const [generated, setGenerated] = useState(stampNow);

  // Stamp the print time, and give "Save as PDF" a sensible file name.
  // Covers both the Print button and Ctrl+P.
  useEffect(() => {
    let previousTitle = document.title;
    const before = () => {
      previousTitle = document.title;
      flushSync(() => setGenerated(stampNow()));
      document.title = `Salary statement ${period}`;
    };
    const after = () => {
      document.title = previousTitle;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [period]);

  const view = useMemo(() => {
    let serial = 0; // numbers the listed rows only, so "No." never skips
    let staff = 0; // the whole roster, listed or not
    let paid = 0;
    let missing = 0;
    let omitted = 0;
    let grand = 0;

    const groups = groupedEmployees.map(({ designation, members }) => {
      let subtotal = 0;
      const rows = members.flatMap((emp) => {
        staff += 1;

        const buckets = attendanceByEmpByDay[emp.EMP_ID] || {};
        let present = 0;
        let dayShifts = 0;
        let nightShifts = 0;
        let fullOt = 0;
        let halfOt = 0;
        let payable = 0;

        for (const d of days) {
          const b: BucketLike = buckets[d] ?? {};
          const dayIn = b.day?.STATUS === "P";
          const nightIn = b.night?.STATUS === "P";
          if (dayIn || nightIn) present += 1;
          if (dayIn) dayShifts += 1;
          if (nightIn) nightShifts += 1;
          for (const s of [b.day, b.night]) {
            if (s?.STATUS !== "P") continue;
            if (s.OT_STATUS === "OT") fullOt += 1;
            else if (s.OT_STATUS === "HALF_OT") halfOt += 1;
          }
          payable += dayMultiplier(b);
        }

        // Each employee is rounded to a whole rupee first, and subtotals and
        // the grand total add up those rounded amounts, so every column on
        // paper sums exactly.
        const total = employeeTotals.get(emp.EMP_ID) ?? null;
        const amount = total === null ? null : Math.round(total);

        // Nothing to pay means no row: an amount of 0, or no salary on file
        // and no day worked. Someone who worked but has no salary on file
        // stays listed, because that gap has to be fixed, not hidden.
        if (amount === 0 || (amount === null && payable === 0)) {
          omitted += 1;
          return [];
        }

        if (amount === null) missing += 1;
        else {
          paid += 1;
          subtotal += amount;
        }
        serial += 1;

        return [
          {
            serial,
            empId: emp.EMP_ID,
            name: `${emp.EMPNAME} ${emp.EMPFNAME}`.trim(),
            salary: emp.SALARY ?? null,
            rate: dailyRate(emp.SALARY),
            present,
            dayShifts,
            nightShifts,
            fullOt,
            halfOt,
            payable,
            amount,
          },
        ];
      });
      grand += subtotal;
      return { designation, rows, subtotal };
    });

    return {
      // A designation with nobody left to list gets no header or subtotal either.
      groups: groups.filter((g) => g.rows.length > 0),
      staff,
      paid,
      missing,
      omitted,
      grand,
    };
  }, [
    groupedEmployees,
    attendanceByEmpByDay,
    days,
    employeeTotals,
    dayMultiplier,
    dailyRate,
  ]);

  return createPortal(
    <div className="sr-root">
      <style>{CSS}</style>

      <header className="sr-head">
        <div>
          {ORG_NAME && <div className="sr-org">{ORG_NAME}</div>}
          <h1 className="sr-title">Salary statement</h1>
        </div>
        <dl className="sr-meta">
          <dt>Period</dt>
          <dd>{period}</dd>
          <dt>Days covered</dt>
          <dd>{days.length}</dd>
          <dt>Generated on</dt>
          <dd>{generated}</dd>
        </dl>
      </header>

      <div className="sr-kpis">
        <div>
          <span>Employees paid</span>
          <b>{view.paid}</b>
        </div>
        <div>
          <span>Total staff</span>
          <b>{view.staff}</b>
        </div>
        <div>
          <span>Total payable</span>
          <b>₹ {rupees(view.grand)}</b>
        </div>
      </div>

      <table className="sr-t">
        <colgroup>
          <col style={{ width: "7mm" }} />
          <col />
          <col style={{ width: "25mm" }} />
          <col style={{ width: "21mm" }} />
          <col style={{ width: "16mm" }} />
          <col style={{ width: "16mm" }} />
          <col style={{ width: "16mm" }} />
          <col style={{ width: "14mm" }} />
          <col style={{ width: "14mm" }} />
          <col style={{ width: "18mm" }} />
          <col style={{ width: "30mm" }} />
        </colgroup>
        <thead>
          <tr>
            <th>No.</th>
            <th className="sr-l">Employee</th>
            <th>Monthly salary (₹)</th>
            <th>Rate per day (₹)</th>
            <th>Days present</th>
            <th>Day shifts</th>
            <th>Night shifts</th>
            <th>Full OT</th>
            <th>Half OT</th>
            <th>Payable days</th>
            <th>Amount payable (₹)</th>
          </tr>
        </thead>
        <tbody>
          {view.groups.map((g) => (
            <Fragment key={g.designation}>
              <tr className="sr-grp">
                <td colSpan={11}>
                  {g.designation}
                  <small>
                    ({g.rows.length}{" "}
                    {g.rows.length === 1 ? "employee" : "employees"})
                  </small>
                </td>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.empId}>
                  <td className="sr-c">{r.serial}</td>
                  <td className="sr-l">{r.name}</td>
                  <td>{rupees(r.salary)}</td>
                  <td>{r.rate === null ? "—" : inr2.format(r.rate)}</td>
                  <td className="sr-c">{r.present}</td>
                  <td className="sr-c">{r.dayShifts}</td>
                  <td className="sr-c">{r.nightShifts}</td>
                  <td className="sr-c">{r.fullOt}</td>
                  <td className="sr-c">{r.halfOt}</td>
                  <td className="sr-c">{dayCount(r.payable)}</td>
                  <td>{rupees(r.amount)}</td>
                </tr>
              ))}
              <tr className="sr-sub">
                <td colSpan={10}>Subtotal, {g.designation}</td>
                <td>{rupees(g.subtotal)}</td>
              </tr>
            </Fragment>
          ))}
          {/* Everyone was left off, so say so instead of printing a bare header */}
          {view.groups.length === 0 && (
            <tr>
              <td className="sr-c sr-none" colSpan={11}>
                Nothing is payable to any employee for this period.
              </td>
            </tr>
          )}
          <tr className="sr-tot">
            <td colSpan={10}>Total payable</td>
            <td>₹ {rupees(view.grand)}</td>
          </tr>
        </tbody>
      </table>

      <section className="sr-notes">
        <h2>Basis of calculation</h2>
        <p>
          Rate per day is monthly salary divided by 30. A date with one shift
          worked counts as 1 day and a date with both shifts worked counts as 2
          days. On a single-shift date, half OT adds 0.5 day and full OT adds 1
          day. When both shifts are worked, the higher OT tier of the two
          applies to both shifts, adding 1 day (half OT) or 2 days (full OT).
          Amount payable is payable days multiplied by rate per day, rounded to
          the nearest rupee for each employee.
        </p>
        <p>
          This statement is computed from marked attendance only. It does not
          include deductions, advances or statutory contributions.
        </p>
        {view.omitted > 0 && (
          <p>
            {view.omitted}{" "}
            {view.omitted === 1
              ? "employee with nothing payable is"
              : "employees with nothing payable are"}{" "}
            not listed. Total staff counts the whole roster.
          </p>
        )}
        {view.missing > 0 && (
          <p>
            {view.missing} {view.missing === 1 ? "employee has" : "employees have"}{" "}
            no salary on file. They are listed without an amount and are
            excluded from the totals.
          </p>
        )}
      </section>

      <footer className="sr-sign">
        {["Prepared by", "Verified by", "Approved by"].map((label) => (
          <div key={label}>{label}</div>
        ))}
      </footer>
    </div>,
    document.body,
  );
}