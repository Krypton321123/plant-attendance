/**
 * AttendancePrint.tsx — print support for the Attendance page.
 *
 *  <PrintButton />  Toolbar button; sits beside Refresh.
 *  <PrintSheet />   A purpose-built A4-landscape register. It is portaled into
 *                   <body> and hidden on screen; when printing, its stylesheet
 *                   hides everything else, so no scrolling/overflow ancestor in
 *                   the app layout can clip it and it paginates normally.
 *
 * PrintSheet listens for `beforeprint`, so Ctrl/Cmd+P behaves like the button:
 * the saved PDF gets a descriptive file name and a fresh "Printed" time.
 *
 * Empty lines are left off the paper. A line whose Present, Absent and Marked
 * are all zero is dropped (one employee in Day / Night mode, one shift of an
 * employee in Both mode), and an employee with no lines left is dropped with
 * it. The on-screen grid is not affected.
 *
 * The prop types are structural — the page's own EmployeeMonthRow rows and
 * ShiftFilter value satisfy them as-is, so nothing needs exporting from it.
 */
import { memo, useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Printer } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────

type OtStatus = 'OT' | 'HALF_OT' | 'NO_OT';

interface Mark {
  status: 'P' | 'A' | null; // null = no record for that day
  otStatus: OtStatus | null;
}

export type PrintShift = 'DAY' | 'NIGHT' | 'BOTH';

export interface PrintRow {
  emp: { EMP_ID: string; EMPNAME: string; EMPFNAME: string; EMPDESG: string };
  cells: Mark[]; // Day / Night mode: one mark per day
  combinedCells: { day: Mark; night: Mark }[]; // Both mode
  present: number;
  absent: number;
  dayPresent: number;
  dayAbsent: number;
  nightPresent: number;
  nightAbsent: number;
}

interface PrintLine {
  tag: 'Day' | 'Night' | null;
  marks: Mark[];
  present: number;
  absent: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const SHIFT_LABEL: Record<PrintShift, string> = {
  DAY: 'day shift',
  NIGHT: 'night shift',
  BOTH: 'day and night shifts',
};

const OT_LETTER: Record<OtStatus, string> = { OT: 'F', HALF_OT: 'H', NO_OT: 'N' };
const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const IST = 'Asia/Kolkata';

function markText(m: Mark): string {
  if (m.status === null) return '—';
  if (m.status === 'A') return 'A';
  return m.otStatus ? `P·${OT_LETTER[m.otStatus]}` : 'P';
}

function markClass(m: Mark): string {
  return m.status === 'P' ? 'ap-present' : m.status === 'A' ? 'ap-absent' : 'ap-off';
}

function printedStamp(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time} IST`;
}

// One printed line per employee per shift: a single line in Day / Night mode,
// two stacked lines in Both mode. That keeps every day column one mark wide.
function printLines(row: PrintRow, combined: boolean): PrintLine[] {
  if (!combined) return [{ tag: null, marks: row.cells, present: row.present, absent: row.absent }];
  return [
    { tag: 'Day', marks: row.combinedCells.map((c) => c.day), present: row.dayPresent, absent: row.dayAbsent },
    { tag: 'Night', marks: row.combinedCells.map((c) => c.night), present: row.nightPresent, absent: row.nightAbsent },
  ];
}

// A line with Present, Absent and Marked all zero is a row of dashes: nothing
// was recorded for it all month, so it stays off the paper. Marked is
// present + absent, so one check covers all three columns.
function hasMarks(line: PrintLine): boolean {
  return line.present + line.absent > 0;
}

// ── Print stylesheet ────────────────────────────────────────────────────
// Everything except the .ap-root display:none sits inside @media print.

const PRINT_CSS = `
.ap-root { display: none; }
@page { size: A4 landscape; margin: 10mm 8mm; }

@media print {
  /* Show only the register: hide the app shell and undo any full-height / flex
     / overflow setup on html and body so the table can flow across pages. */
  html, body { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(.ap-root) { display: none !important; }

  .ap-root { display: block; color: #18181b; font: 8pt/1.35 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Table */
  .ap-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.5pt; }
  .ap-table th, .ap-table td { padding: 0; border: 0.5pt solid #d4d4d8; text-align: center; }
  .ap-table tbody, .ap-table tr { break-inside: avoid; page-break-inside: avoid; }
  .ap-table tbody:nth-of-type(even) tr { background: #fafafa; }
  .ap-both tbody tr:first-child td { border-top: 0.8pt solid #a1a1aa; }
  .ap-col-sl { width: 7mm; }
  .ap-col-emp { width: 44mm; }
  .ap-col-sh { width: 10mm; }
  .ap-col-tot { width: 11mm; }

  /* Header rows (repeat on every page) */
  .ap-table thead th { padding: 0.8mm 0; border-color: #a1a1aa; background: #f4f4f5; color: #3f3f46; font-weight: 600; }
  .ap-table thead th.ap-top { padding: 0 0 2.5mm; border: 0; background: none; color: inherit; font-weight: 400; text-align: left; }
  .ap-table thead th.ap-sun { background: #e4e4e7; }
  .ap-dn { font-size: 6.5pt; line-height: 1.2; font-weight: 700; }
  .ap-dw { font-size: 5pt; line-height: 1.2; font-weight: 500; color: #71717a; }

  .ap-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; padding-bottom: 2mm; border-bottom: 0.8pt solid #18181b; }
  .ap-title { font-size: 16pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; }
  .ap-sub { margin-top: 0.5mm; font-size: 8.5pt; color: #52525b; }
  .ap-side { text-align: right; white-space: nowrap; font-size: 7pt; color: #71717a; }
  .ap-stats { display: flex; justify-content: flex-end; gap: 6mm; margin-bottom: 1mm; font-size: 8pt; }
  .ap-stats b { margin-left: 1mm; font-size: 10pt; color: #18181b; }

  /* Body cells */
  .ap-table .ap-sl { color: #71717a; }
  .ap-table .ap-emp { padding: 0.6mm 1.6mm; text-align: left; }
  .ap-name { font-size: 7pt; font-weight: 600; line-height: 1.2; }
  .ap-desg { font-size: 6pt; line-height: 1.2; color: #71717a; }
  .ap-table .ap-sh { font-weight: 600; }
  .ap-table .ap-c { height: 5mm; }
  .ap-table td.ap-tot { font-size: 7pt; }
  .ap-table td.ap-empty { padding: 8mm 0; color: #71717a; font-size: 8pt; }

  /* Marks */
  .ap-chip { display: inline-block; min-width: 6mm; padding: 0.4mm 1mm; border-radius: 0.8mm; text-align: center; font-size: 6pt; font-weight: 600; }
  .ap-present { background: #dcfce7; color: #166534; font-weight: 600; }
  .ap-absent { background: #fee2e2; color: #b91c1c; font-weight: 700; }
  .ap-off { color: #a1a1aa; }
  .ap-sh-d { background: #fffbeb; color: #b45309; }
  .ap-sh-n { background: #eef2ff; color: #4338ca; }
  .ap-tp { color: #15803d; font-weight: 700; }
  .ap-ta { color: #b91c1c; font-weight: 700; }
  .ap-tz { color: #a1a1aa; }
  .ap-tm { color: #52525b; }

  /* Footer */
  .ap-foot { margin-top: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .ap-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5mm 5mm; font-size: 6.5pt; color: #52525b; }
  .ap-legend > span { display: inline-flex; align-items: center; gap: 1.5mm; white-space: nowrap; }
  .ap-note { margin-top: 1.5mm; font-size: 6pt; color: #71717a; }
  .ap-sign { display: flex; gap: 14mm; margin-top: 11mm; }
  .ap-sign > div { flex: 1; padding-top: 1mm; border-top: 0.5pt solid #71717a; font-size: 6.5pt; color: #52525b; }
}
`;

// ── Components ──────────────────────────────────────────────────────────

export function PrintButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      onClick={() => window.print()}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 font-mono text-[12px] font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:text-zinc-500"
      aria-label="Print attendance register"
      title={disabled ? 'Nothing to print yet' : 'Print, or save as PDF to share'}
    >
      <Printer size={15} />
      Print
    </button>
  );
}

const PrintSheet = memo(function PrintSheet({
  rows,
  shift,
  year,
  monthIdx0,
  presentOnly,
}: {
  rows: PrintRow[];
  shift: PrintShift;
  year: number;
  monthIdx0: number; // 0–11
  presentOnly: boolean;
}) {
  const [printedAt, setPrintedAt] = useState(() => new Date());

  const combined = shift === 'BOTH';
  const unit = combined ? 'shifts' : 'days';
  const totalDays = new Date(year, monthIdx0 + 1, 0).getDate();
  // #, Employee, (Shift in Both mode), one column per day, then Present / Absent / Marked.
  const colCount = totalDays + (combined ? 6 : 5);
  const monthLabel = new Date(year, monthIdx0, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const printTitle = `Attendance register ${monthLabel} (${SHIFT_LABEL[shift]})`;

  // Runs for the Print button and Ctrl/Cmd+P alike: names the saved PDF and
  // stamps the real print time. flushSync gets the new time into the DOM
  // before the browser captures the page.
  useEffect(() => {
    let originalTitle = document.title;
    const onBeforePrint = () => {
      originalTitle = document.title;
      document.title = printTitle;
      flushSync(() => setPrintedAt(new Date()));
    };
    const onAfterPrint = () => {
      document.title = originalTitle;
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [printTitle]);

  // Only lines with something recorded go on paper, and an employee with no
  // lines left is dropped. The # column and the Employees count below follow
  // what is actually printed, not the full list passed in.
  const entries = rows
    .map((row) => ({ row, lines: printLines(row, combined).filter(hasMarks) }))
    .filter((entry) => entry.lines.length > 0);

  const totals = entries.reduce(
    (t, { row }) => ({ present: t.present + row.present, absent: t.absent + row.absent }),
    { present: 0, absent: 0 }
  );
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  const weekday = (day: number) => new Date(year, monthIdx0, day).getDay();

  return createPortal(
    <div className="ap-root">
      <style>{PRINT_CSS}</style>

      <table className={`ap-table${combined ? ' ap-both' : ''}`}>
        <colgroup>
          <col className="ap-col-sl" />
          <col className="ap-col-emp" />
          {combined && <col className="ap-col-sh" />}
          {days.map((d) => (
            <col key={d} />
          ))}
          <col className="ap-col-tot" />
          <col className="ap-col-tot" />
          <col className="ap-col-tot" />
        </colgroup>

        {/* thead repeats on every printed page, so each page is self-describing */}
        <thead>
          <tr>
            <th className="ap-top" colSpan={colCount}>
              <div className="ap-head">
                <div>
                  <div className="ap-title">{monthLabel}</div>
                  <div className="ap-sub">
                    Attendance register, {SHIFT_LABEL[shift]}
                    {presentOnly ? ', present employees only' : ''}
                  </div>
                </div>
                <div className="ap-side">
                  <div className="ap-stats">
                    <span>
                      Employees<b>{entries.length}</b>
                    </span>
                    <span>
                      Present {unit}
                      <b>{totals.present}</b>
                    </span>
                    <span>
                      Absent {unit}
                      <b>{totals.absent}</b>
                    </span>
                  </div>
                  <div>Printed {printedStamp(printedAt)}</div>
                </div>
              </div>
            </th>
          </tr>
          <tr>
            <th className="ap-sl">#</th>
            <th className="ap-emp">Employee</th>
            {combined && <th className="ap-sh">Shift</th>}
            {days.map((d) => (
              <th key={d} className={weekday(d) === 0 ? 'ap-sun' : undefined}>
                <div className="ap-dn">{d}</div>
                <div className="ap-dw">{WEEKDAY_LETTER[weekday(d)]}</div>
              </th>
            ))}
            <th className="ap-tot">Present</th>
            <th className="ap-tot">Absent</th>
            <th className="ap-tot">Marked</th>
          </tr>
        </thead>

        {entries.map(({ row, lines }, i) => {
          return (
            <tbody key={row.emp.EMP_ID}>
              {lines.map((line, li) => (
                <tr key={li}>
                  {li === 0 && (
                    <td className="ap-sl" rowSpan={lines.length}>
                      {i + 1}
                    </td>
                  )}
                  {li === 0 && (
                    <td className="ap-emp" rowSpan={lines.length}>
                      <div className="ap-name">
                        {row.emp.EMPNAME} {row.emp.EMPFNAME}
                      </div>
                      <div className="ap-desg">{row.emp.EMPDESG}</div>
                    </td>
                  )}
                  {line.tag && <td className={`ap-sh ${line.tag === 'Day' ? 'ap-sh-d' : 'ap-sh-n'}`}>{line.tag}</td>}
                  {line.marks.map((m, d) => (
                    <td key={d} className={`ap-c ${markClass(m)}`}>
                      {markText(m)}
                    </td>
                  ))}
                  <td className="ap-tot ap-tp">{line.present}</td>
                  <td className={`ap-tot ${line.absent > 0 ? 'ap-ta' : 'ap-tz'}`}>{line.absent}</td>
                  <td className="ap-tot ap-tm">{line.present + line.absent}</td>
                </tr>
              ))}
            </tbody>
          );
        })}

        {/* Every line was empty, so say so instead of printing a bare header */}
        {entries.length === 0 && (
          <tbody>
            <tr>
              <td className="ap-empty" colSpan={colCount}>
                No attendance recorded for this month.
              </td>
            </tr>
          </tbody>
        )}
      </table>

      <div className="ap-foot">
        <div className="ap-legend">
          <span>
            <span className="ap-chip ap-present">P</span>Present
          </span>
          <span>
            <span className="ap-chip ap-absent">A</span>Absent
          </span>
          <span>
            <span className="ap-chip ap-off">—</span>No record
          </span>
          <span>
            <span className="ap-chip ap-present">P·F</span>Present, full OT
          </span>
          <span>
            <span className="ap-chip ap-present">P·H</span>Present, half OT
          </span>
          <span>
            <span className="ap-chip ap-present">P·N</span>Present, no OT
          </span>
        </div>
        <div className="ap-note">
          Marked counts {unit} that have an attendance record. A dash means nothing was recorded and is not counted as absent.{' '}
          {combined
            ? 'Employees and shifts with no attendance recorded this month are not listed.'
            : 'Employees with no attendance recorded this month are not listed.'}
        </div>
        <div className="ap-sign">
          <div>Prepared by</div>
          <div>Verified by</div>
          <div>Approved by</div>
        </div>
      </div>
    </div>,
    document.body
  );
});

export default PrintSheet;