/**
 * GateReportPrint: a formal, print-only statement of the gate entry log.
 *
 * Renders nothing on screen. When the page is printed (Print button or Ctrl+P)
 * everything else is hidden and this statement prints on A4 landscape: header,
 * summary figures, every entry in the range, total entries, notes, and
 * signature lines.
 *
 * It is for the Entry log only. "Inside now" is a live snapshot rather than a
 * record of a period, so it has no printable form.
 *
 * It prints every entry in `records`, not just the rows the screen has revealed
 * so far (the screen shows 100 at a time). Entries run earliest first and are
 * grouped by the IST day of entry. Each day is its own table, and its heading
 * repeats on every page the day spills onto, so no page ever loses its date.
 *
 * WIRING in GateRegister.tsx (already done there)
 *
 * 1) Imports
 *      import { ..., Printer } from 'lucide-react';
 *      import GateReportPrint from './GateReportPrint';
 *
 * 2) One flag, right after the line `const showExit = ...;`
 *      const canPrint = mode === 'log' && hasRows;
 *
 * 3) Header, next to the Refresh button, Entry log only
 *      {mode === 'log' && (
 *        <button onClick={() => window.print()} disabled={!canPrint}> Print report </button>
 *      )}
 *
 * 4) End of GateRegister's return, after the photo preview portal
 *      {canPrint && <GateReportPrint fromKey={from} toKey={to} records={records} />}
 *
 * The statement is only mounted while canPrint is true, so pressing Ctrl+P on
 * "Inside now", or on a loading, error or invalid-range screen, prints the
 * normal page, never an empty statement.
 *
 * Photos are left off on purpose: the screen loads them lazily, so they would
 * not be ready when the print preview is drawn, and they would swamp a table
 * that can run to hundreds of rows.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

/** Printed at the top of the statement. Leave empty to omit. */
const ORG_NAME = '';

// Minimal structural type so this file needn't import from GateRegister.tsx
// (which imports this file).
interface GateRecordLike {
  LOG_ID: string;
  ENTRY_TYPE: string; // EMPLOYEE | VISITOR, or PERSON | VEHICLE on older rows
  NAME: string;
  PERSON_TO_MEET: string | null;
  MOBILE: string | null;
  VEHICLE_NO: string | null;
  PURPOSE: string;
  ENTRY_AT: string;
  EXIT_AT: string | null;
  loggedBy?: { EMPNAME: string } | null;
  exitLoggedBy?: { EMPNAME: string } | null;
}

interface Props {
  fromKey: string; // 'YYYY-MM-DD', an IST calendar day
  toKey: string;
  records: GateRecordLike[];
}

// ── Table shape ────────────────────────────────────────────────────────────

interface Column {
  label: string;
  /** Width in mm. null = whatever is left over (the free-text Purpose column). */
  width: number | null;
  /** gr-n = narrow serial column, gr-l = left-aligned heading. */
  cls?: 'gr-n' | 'gr-l';
}

// The one place the table's shape is defined: the colgroup and the heading row
// are both built from this list. The body cells further down follow its order.
const COLUMNS: Column[] = [
  { label: 'No.', width: 10, cls: 'gr-n' },
  { label: 'Name', width: 34, cls: 'gr-l' },
  { label: 'Type', width: 18 },
  { label: 'To meet', width: 28, cls: 'gr-l' },
  { label: 'Purpose', width: null, cls: 'gr-l' },
  { label: 'Mobile', width: 24, cls: 'gr-l' },
  { label: 'Vehicle no.', width: 24, cls: 'gr-l' },
  { label: 'Entry', width: 16 },
  { label: 'Exit', width: 18 },
  { label: 'Duration', width: 16 },
  { label: 'Entry logged\u00A0by', width: 22, cls: 'gr-l' },
  { label: 'Exit logged\u00A0by', width: 22, cls: 'gr-l' },
];

// ── Formatting ─────────────────────────────────────────────────────────────

const IST = 'Asia/Kolkata';

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true,
});
const shortDayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, day: '2-digit', month: 'short',
});
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST }); // YYYY-MM-DD
const stampFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST, day: '2-digit', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});
const countFmt = new Intl.NumberFormat('en-IN');

const stampNow = () => `${stampFmt.format(new Date())} IST`;

// A 'YYYY-MM-DD' key as a Date at noon UTC, so formatting it in UTC can never
// slip to a neighbouring day.
const keyDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const longDate = (key: string) =>
  keyDate(key).toLocaleDateString('en-IN', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  });
const weekday = (key: string) =>
  keyDate(key).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long' });
const daysInRange = (fromKey: string, toKey: string) =>
  Math.round((keyDate(toKey).getTime() - keyDate(fromKey).getTime()) / 86_400_000) + 1;

// Timestamps are epoch milliseconds from here on. One bad value prints as a
// dash instead of throwing and taking the whole page down with it.
const fmtTime = (ms: number) => (Number.isFinite(ms) ? timeFmt.format(ms).toUpperCase() : '—');
const dayKeyOf = (ms: number) => (Number.isFinite(ms) ? dayKeyFmt.format(ms) : '');

function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return '<1m';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// 'EMPLOYEE' → 'Employee'. Older rows (PERSON, VEHICLE) read the same way.
const typeLabel = (kind: string) =>
  kind ? kind.charAt(0) + kind.slice(1).toLowerCase() : '—';

// ── Print stylesheet ───────────────────────────────────────────────────────

const CSS = `
@page {
  size: A4 landscape;
  margin: 12mm 10mm 15mm;
  @bottom-left { content: "System-generated gate entry log"; font: 7.5pt "Segoe UI", Arial, sans-serif; color: #555; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt "Segoe UI", Arial, sans-serif; color: #555; }
}
.gr-root { display: none; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.gr-root) { display: none !important; }
  .gr-root { display: block; color: #000; font: 8.5pt/1.4 "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  .gr-root, .gr-root * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .gr-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16pt; padding-bottom: 7pt; border-bottom: 2pt solid #000; }
  .gr-org { margin-bottom: 2pt; font-size: 10pt; font-weight: 600; }
  .gr-title { margin: 0; font: 700 21pt/1.1 Georgia, "Times New Roman", serif; }
  .gr-meta { display: grid; grid-template-columns: auto auto; flex-shrink: 0; gap: 1.5pt 12pt; margin: 0; }
  .gr-meta dt, .gr-meta dd { white-space: nowrap; }
  .gr-meta dt { color: #555; }
  .gr-meta dd { margin: 0; font-weight: 600; }

  .gr-kpis { display: flex; margin: 9pt 0 11pt; border: .5pt solid #888; }
  .gr-kpis > div { flex: 1; padding: 5pt 9pt; border-right: .5pt solid #888; }
  .gr-kpis > div:first-child { background: #ececec; }
  .gr-kpis > div:last-child { border-right: 0; }
  .gr-kpis span { display: block; color: #555; font-size: 7.5pt; }
  .gr-kpis b { font-size: 13pt; font-variant-numeric: tabular-nums; }

  .gr-t { width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom: 9pt; font-variant-numeric: tabular-nums; }
  .gr-t th, .gr-t td { padding: 2.5pt 4pt; border: .4pt solid #999; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
  .gr-t th { background: #e6e6e6; font-size: 7.5pt; font-weight: 700; text-align: center; }
  .gr-t td { font-size: 8pt; }
  .gr-t .gr-l { text-align: left; }
  .gr-t .gr-n { padding-right: 2pt; padding-left: 2pt; text-align: center; }
  .gr-t td.gr-c { text-align: center; white-space: nowrap; }
  .gr-t thead { break-after: avoid; }
  .gr-t tr { break-inside: avoid; }
  .gr-t .gr-day th { padding: 4pt 5pt; background: #f2f2f2; border-top: 1.5pt solid #000; font-size: 9pt; text-align: left; }
  .gr-t .gr-day small { margin-left: 5pt; color: #555; font-size: 8pt; font-weight: 400; }

  .gr-name { font-weight: 600; }
  .gr-chip { display: inline-block; padding: 0 3pt; border: .5pt solid #aaa; border-radius: 2pt; color: #555; font-size: 7pt; line-height: 1.5; }
  .gr-chip-v { border-color: #000; color: #000; font-weight: 600; }
  .gr-nil { color: #999; }
  .gr-open { color: #555; font-size: 7pt; font-style: italic; }
  .gr-sm { color: #555; font-size: 7pt; }

  /* Total, notes and signatures travel as one block, so the signature lines can
     never end up alone on a page of their own. */
  .gr-end { break-inside: avoid; break-before: avoid; }
  .gr-tot { display: flex; justify-content: space-between; padding: 3.5pt 5pt; background: #e6e6e6; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; font-size: 10pt; font-weight: 700; font-variant-numeric: tabular-nums; }

  .gr-notes { margin-top: 12pt; color: #333; font-size: 7.5pt; }
  .gr-notes h2 { margin: 0 0 2pt; color: #000; font-size: 8pt; }
  .gr-notes p { margin: 0 0 2pt; }

  .gr-sign { display: flex; gap: 28pt; margin-top: 28pt; }
  .gr-sign div { flex: 1; padding-top: 3pt; border-top: .75pt solid #000; font-size: 8.5pt; text-align: center; }
}
`;

// ── Pieces ─────────────────────────────────────────────────────────────────

const NIL = <span className="gr-nil">—</span>;

function Colgroup() {
  return (
    <colgroup>
      {COLUMNS.map((c) => (
        <col key={c.label} style={c.width ? { width: `${c.width}mm` } : undefined} />
      ))}
    </colgroup>
  );
}

interface Row {
  id: string;
  serial: number;
  name: string;
  type: string;
  visitor: boolean;
  toMeet: string | null;
  purpose: string;
  mobile: string | null;
  vehicle: string | null;
  entryTime: string;
  exitTime: string | null;
  exitDay: string | null; // only when the exit falls on a later day than the entry
  duration: string | null;
  entryBy: string | null;
  exitBy: string | null;
}

interface DayGroup {
  key: string; // 'YYYY-MM-DD', or '' if the entry time was unreadable
  heading: string;
  rows: Row[];
}

// ── Component ──────────────────────────────────────────────────────────────

function GateReportPrint({ fromKey, toKey, records }: Props) {
  const period =
    fromKey === toKey ? longDate(fromKey) : `${longDate(fromKey)} to ${longDate(toKey)}`;
  const [generated, setGenerated] = useState(stampNow);

  // Stamp the print time, and give "Save as PDF" a sensible file name.
  // Covers both the Print button and Ctrl+P.
  useEffect(() => {
    let previousTitle = document.title;
    const before = () => {
      previousTitle = document.title;
      flushSync(() => setGenerated(stampNow()));
      document.title = `Gate entry log ${period}`;
    };
    const after = () => {
      document.title = previousTitle;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [period]);

  const view = useMemo(() => {
    // Earliest entry first, the way a paper register reads. Array.sort is
    // stable, so entries with identical timestamps keep the server's order.
    const ordered = records
      .map((r) => {
        const t = Date.parse(r.ENTRY_AT);
        return { r, t: Number.isNaN(t) ? Infinity : t };
      })
      .sort((a, b) => (a.t === b.t ? 0 : a.t < b.t ? -1 : 1));

    const groups: DayGroup[] = [];
    const otherTypes = new Set<string>();
    let serial = 0; // numbers every listed entry, so "No." runs on across days
    let employees = 0;
    let visitors = 0;
    let others = 0; // older entry types that are neither of the two above
    let withVehicle = 0;
    let notExited = 0;

    for (const { r, t } of ordered) {
      const dayKey = dayKeyOf(t);
      let group = groups[groups.length - 1];
      if (!group || group.key !== dayKey) {
        group = {
          key: dayKey,
          heading: dayKey ? `${weekday(dayKey)}, ${longDate(dayKey)}` : 'Date not recorded',
          rows: [],
        };
        groups.push(group);
      }

      const kind = (r.ENTRY_TYPE ?? '').trim().toUpperCase();
      if (kind === 'EMPLOYEE') employees += 1;
      else if (kind === 'VISITOR') visitors += 1;
      else {
        others += 1;
        if (kind) otherTypes.add(typeLabel(kind));
      }

      const exitMs = r.EXIT_AT ? Date.parse(r.EXIT_AT) : NaN;
      const exited = Number.isFinite(exitMs);
      if (!exited) notExited += 1;
      if (r.VEHICLE_NO) withVehicle += 1;
      serial += 1;

      group.rows.push({
        id: r.LOG_ID,
        serial,
        name: r.NAME,
        type: typeLabel(kind),
        visitor: kind === 'VISITOR',
        toMeet: r.PERSON_TO_MEET || null,
        purpose: r.PURPOSE,
        mobile: r.MOBILE || null,
        vehicle: r.VEHICLE_NO || null,
        entryTime: fmtTime(t),
        exitTime: exited ? fmtTime(exitMs) : null,
        exitDay: exited && dayKeyOf(exitMs) !== dayKey ? shortDayFmt.format(exitMs) : null,
        // No exit means no duration: a running figure would be meaningless on paper.
        duration: exited && Number.isFinite(t) ? formatDuration(exitMs - t) : null,
        entryBy: r.loggedBy?.EMPNAME || null,
        exitBy: r.exitLoggedBy?.EMPNAME || null,
      });
    }

    return {
      groups,
      total: serial,
      employees,
      visitors,
      others,
      withVehicle,
      notExited,
      otherTypes: Array.from(otherTypes).sort(),
    };
  }, [records]);

  const noteOpen =
    view.notExited > 0
      ? `${view.notExited} ${view.notExited === 1 ? 'entry has' : 'entries have'} no exit marked. ` +
        'They are either still inside at the time of printing or were not closed out at the gate, ' +
        'so no duration is shown for them.'
      : null;

  const noteOther =
    view.others > 0
      ? `${view.others} ${view.others === 1 ? 'entry was' : 'entries were'} logged under an earlier ` +
        `entry type${view.otherTypes.length ? ` (${view.otherTypes.join(', ')})` : ''} and ` +
        `${view.others === 1 ? 'is' : 'are'} counted in Total entries but not in the Employees or Visitors figures.`
      : null;

  return createPortal(
    <div className="gr-root">
      <style>{CSS}</style>

      <header className="gr-head">
        <div>
          {ORG_NAME && <div className="gr-org">{ORG_NAME}</div>}
          <h1 className="gr-title">Gate entry log</h1>
        </div>
        <dl className="gr-meta">
          <dt>Period</dt>
          <dd>{period}</dd>
          <dt>Days covered</dt>
          <dd>{daysInRange(fromKey, toKey)}</dd>
          <dt>Generated on</dt>
          <dd>{generated}</dd>
        </dl>
      </header>

      <div className="gr-kpis">
        <div>
          <span>Total entries</span>
          <b>{countFmt.format(view.total)}</b>
        </div>
        <div>
          <span>Employees</span>
          <b>{countFmt.format(view.employees)}</b>
        </div>
        <div>
          <span>Visitors</span>
          <b>{countFmt.format(view.visitors)}</b>
        </div>
        <div>
          <span>With vehicle</span>
          <b>{countFmt.format(view.withVehicle)}</b>
        </div>
        <div>
          <span>Exit not marked</span>
          <b>{countFmt.format(view.notExited)}</b>
        </div>
      </div>

      {/* One table per day. A table's header rows repeat on every page it
          spans, so the day banner travels with the column headings. */}
      {view.groups.map((g) => (
        <table className="gr-t" key={g.key || 'undated'}>
          <Colgroup />
          <thead>
            <tr className="gr-day">
              <th colSpan={COLUMNS.length}>
                {g.heading}
                <small>
                  ({g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'})
                </small>
              </th>
            </tr>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className={c.cls}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.id}>
                <td className="gr-n">{r.serial}</td>
                <td className="gr-name">{r.name}</td>
                <td className="gr-c">
                  <span className={r.visitor ? 'gr-chip gr-chip-v' : 'gr-chip'}>{r.type}</span>
                </td>
                <td>{r.toMeet ?? NIL}</td>
                <td>{r.purpose || NIL}</td>
                <td>{r.mobile ?? NIL}</td>
                <td>{r.vehicle ?? NIL}</td>
                <td className="gr-c">{r.entryTime}</td>
                <td className="gr-c">
                  {r.exitTime ? (
                    <>
                      {r.exitTime}
                      {r.exitDay && <div className="gr-sm">{r.exitDay}</div>}
                    </>
                  ) : (
                    <span className="gr-open">Not marked</span>
                  )}
                </td>
                <td className="gr-c">{r.duration ?? NIL}</td>
                <td>{r.entryBy ?? NIL}</td>
                <td>{r.exitBy ?? NIL}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <div className="gr-end">
        <div className="gr-tot">
          <span>Total entries</span>
          <span>{countFmt.format(view.total)}</span>
        </div>

        <section className="gr-notes">
          <h2>Notes</h2>
          <p>
            Every gate entry logged in the period is listed, earliest first and grouped by the day
            of entry. All times are in IST. Duration is the time between entry and exit; where the
            exit falls on a later day, that date is shown under the exit time.
          </p>
          {noteOpen && <p>{noteOpen}</p>}
          {noteOther && <p>{noteOther}</p>}
        </section>

        <footer className="gr-sign">
          {['Prepared by', 'Verified by', 'Approved by'].map((label) => (
            <div key={label}>{label}</div>
          ))}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// memo: the page re-renders every minute (live durations), and there is no
// reason to rebuild a table of hundreds of hidden rows each time.
export default memo(GateReportPrint);