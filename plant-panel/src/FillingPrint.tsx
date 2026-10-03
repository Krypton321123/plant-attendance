/**
 * FillingPrint.tsx — print support for the Filling Register page.
 *
 *  <FillingPrintSheet />  A purpose-built A4-landscape register: one row per
 *                         item, one column per day, a Total column, and a Day
 *                         total row at the end. It is portaled into <body> and
 *                         hidden on screen; when printing, its stylesheet hides
 *                         everything else, so no scrolling / sticky / overflow
 *                         ancestor in the app layout can clip it and it
 *                         paginates normally. Column headings repeat on every
 *                         page and a row is never split across two pages.
 *
 * It listens for `beforeprint`, so the Print button and Ctrl/Cmd+P behave the
 * same: the saved PDF gets a descriptive file name and a fresh "Printed" time.
 *
 * Only items with filling in the month are printed (total above zero, the same
 * test as the page's "Active only" toggle). The on-screen grid is not affected.
 *
 * Quantities are formatted exactly as on screen and shaded with the screen's
 * steps (share of that item's busiest day). The day columns are narrow, so the
 * font size shrinks to fit the longest number in the grid instead of letting
 * it spill into the next cell.
 *
 * The prop types are structural: the page's own FillingItemRow satisfies
 * FillingPrintItem as-is, so nothing needs exporting from the page.
 *
 * Usage in the page:
 *   {canPrint && (
 *     <FillingPrintSheet
 *       items={filteredItems}
 *       year={selectedYear}
 *       monthIdx0={selectedMonthIdx}
 *       daysInMonth={daysInMonth}
 *       search={search.trim()}
 *     />
 *   )}
 * and a button that calls window.print().
 */
import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';

// ── Types ───────────────────────────────────────────────────────────────

export interface FillingPrintItem {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  days: (number | null)[]; // index 0 = day 1
  total: number;
}

// ── Layout, in mm: A4 landscape with 8 mm side margins ──────────────────

const TABLE_MM = 297 - 2 * 8;
const SL_MM = 7;
const ITEM_MM = 50;
const TOT_MM = 16;

const MM_PER_PT = 0.3528;
const DIGIT_EM = 0.62; // generous width of one tabular digit, in em

// Largest font size (pt) at which `chars` characters still fit one day column,
// never above `maxPt` and never so small it stops being readable.
function fitPt(chars: number, dayColMm: number, maxPt: number): number {
  const pt = (dayColMm - 0.8) / (chars * DIGIT_EM * MM_PER_PT);
  return Math.max(4.2, Math.min(maxPt, Math.floor(pt * 10) / 10));
}

// ── Helpers ─────────────────────────────────────────────────────────────

const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const IST = 'Asia/Kolkata';

// Same as the page: "12.000" reads "12", "12.500" reads "12.5".
function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

// Same steps as the page's intensityClasses(): a cell is shaded by its share
// of that item's busiest day this month. Keep the two in step if one changes.
function heatLevel(value: number, rowMax: number): 1 | 2 | 3 | 4 {
  if (rowMax <= 0) return 1;
  const ratio = value / rowMax;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.35) return 2;
  if (ratio <= 0.6) return 3;
  return 4;
}

function printedStamp(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time} IST`;
}

// ── Print stylesheet ────────────────────────────────────────────────────
// Everything except the .fp-root display:none and @page sits inside @media print.

const PRINT_CSS = `
.fp-root { display: none; }
@page {
  size: A4 landscape;
  margin: 10mm 8mm 13mm;
  @bottom-left { content: "System-generated filling register"; font: 6.5pt Inter, "Segoe UI", Arial, sans-serif; color: #71717a; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 6.5pt Inter, "Segoe UI", Arial, sans-serif; color: #71717a; }
}

@media print {
  /* Show only the register: hide the app shell and undo any full-height / flex
     / overflow setup on html and body so the table can flow across pages. */
  html, body { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(.fp-root) { display: none !important; }

  .fp-root { display: block; color: #18181b; font: 8pt/1.35 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; }
  .fp-root, .fp-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Table */
  .fp-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.5pt; }
  .fp-table th, .fp-table td { padding: 0; border: 0.5pt solid #d4d4d8; text-align: center; }
  .fp-table tr { break-inside: avoid; page-break-inside: avoid; }
  .fp-body tr:nth-child(even) { background: #fafafa; }
  .fp-col-sl { width: ${SL_MM}mm; }
  .fp-col-item { width: ${ITEM_MM}mm; }
  .fp-col-tot { width: ${TOT_MM}mm; }

  /* Header rows (repeat on every page) */
  .fp-table thead th { padding: 0.8mm 0; border-color: #a1a1aa; background: #f4f4f5; color: #3f3f46; font-weight: 600; }
  .fp-table thead th.fp-top { padding: 0 0 2.5mm; border: 0; background: none; color: inherit; font-weight: 400; text-align: left; }
  .fp-table thead th.fp-sun { background: #e4e4e7; }
  .fp-dn { font-size: 6.5pt; line-height: 1.2; font-weight: 700; }
  .fp-dw { font-size: 5pt; line-height: 1.2; font-weight: 500; color: #71717a; }

  .fp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; padding-bottom: 2mm; border-bottom: 0.8pt solid #18181b; }
  .fp-title { font-size: 16pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; }
  .fp-sub { margin-top: 0.5mm; font-size: 8.5pt; color: #52525b; }
  .fp-side { text-align: right; white-space: nowrap; font-size: 7pt; color: #71717a; }
  .fp-stats { display: flex; justify-content: flex-end; gap: 6mm; margin-bottom: 1mm; font-size: 8pt; }
  .fp-stats b { margin-left: 1mm; font-size: 10pt; color: #18181b; }

  /* Body cells */
  .fp-table .fp-sl { color: #71717a; }
  .fp-table .fp-item { padding: 0.7mm 1.8mm; text-align: left; }
  .fp-name { font-size: 7pt; font-weight: 600; line-height: 1.2; }
  .fp-meta { margin-top: 0.2mm; font-size: 5.5pt; line-height: 1.2; color: #71717a; }
  .fp-table td.fp-c { font-size: var(--fp-cell, 6.5pt); font-weight: 500; }
  .fp-table td.fp-nil { color: #a1a1aa; font-weight: 400; }
  .fp-table td.fp-nil.fp-sun { background: #f4f4f5; }
  .fp-table td.fp-tot { background: #f4f4f5; font-size: 7pt; font-weight: 700; }
  .fp-table td.fp-empty { padding: 8mm 0; color: #71717a; font-size: 8pt; }

  /* Shading steps, light to dark (same four as the screen) */
  .fp-l1 { background: #ecfdf5; }
  .fp-l2 { background: #d1fae5; }
  .fp-l3 { background: #a7f3d0; }
  .fp-l4 { background: #6ee7b7; }

  /* Day total row, once, after the last item */
  .fp-table tr.fp-total td { border-top: 1.2pt solid #18181b; background: #e4e4e7; font-weight: 700; }
  .fp-table tr.fp-total td.fp-dt { font-size: var(--fp-dt, 6.5pt); }
  .fp-table tr.fp-total td.fp-tl { padding: 1.2mm 1.8mm; text-align: left; font-size: 7pt; }
  .fp-table tr.fp-total td.fp-tot { font-size: 7.5pt; }

  /* Footer */
  .fp-foot { margin-top: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .fp-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5mm 5mm; font-size: 6.5pt; color: #52525b; }
  .fp-legend > span { display: inline-flex; align-items: center; gap: 1.5mm; white-space: nowrap; }
  .fp-scale { display: inline-flex; }
  .fp-sw { display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.4pt solid #a1a1aa; }
  .fp-sw.fp-sunsw { background: #f4f4f5; }
  .fp-chip { display: inline-block; min-width: 6mm; text-align: center; color: #a1a1aa; }
  .fp-note { margin-top: 1.5mm; font-size: 6pt; color: #71717a; }
  .fp-sign { display: flex; gap: 14mm; margin-top: 11mm; }
  .fp-sign > div { flex: 1; padding-top: 1mm; border-top: 0.5pt solid #71717a; font-size: 6.5pt; color: #52525b; }
}
`;

// ── Component ───────────────────────────────────────────────────────────

const FillingPrintSheet = memo(function FillingPrintSheet({
  items,
  year,
  monthIdx0,
  daysInMonth,
  search,
}: {
  items: FillingPrintItem[];
  year: number;
  monthIdx0: number; // 0–11
  daysInMonth: number;
  search: string; // the page's search text; empty when not filtering
}) {
  const [printedAt, setPrintedAt] = useState(() => new Date());

  const monthLabel = new Date(year, monthIdx0, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const printTitle = `Filling register ${monthLabel}`;

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

  // Only items with filling in the month go on paper. The # column, the Items
  // count and every total below follow what is actually printed.
  const entries = items
    .filter((row) => row.total > 0)
    .map((row) => ({
      row,
      rowMax: Math.max(0, ...row.days.filter((v): v is number => typeof v === 'number')),
    }));

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekday = (day: number) => new Date(year, monthIdx0, day).getDay();
  const colCount = daysInMonth + 3; // #, Item, one per day, Total

  const dayTotals = days.map((_, i) => entries.reduce((sum, { row }) => sum + (row.days[i] ?? 0), 0));
  const grandTotal = entries.reduce((sum, { row }) => sum + row.total, 0);
  const fillingDays = dayTotals.filter((t) => t > 0).length;

  // Size the numbers to the longest one in the grid. The Day total row holds
  // sums, so it can need more room than any single item and is sized apart.
  let bodyChars = 1;
  for (const { row } of entries) {
    for (let i = 0; i < daysInMonth; i++) {
      const v = row.days[i];
      if (typeof v === 'number') bodyChars = Math.max(bodyChars, formatQty(v).length);
    }
  }
  const totalChars = dayTotals.reduce((m, t) => Math.max(m, t > 0 ? formatQty(t).length : 1), 1);
  const dayColMm = (TABLE_MM - SL_MM - ITEM_MM - TOT_MM) / daysInMonth;
  const rootStyle = {
    '--fp-cell': `${fitPt(bodyChars, dayColMm, 6.5)}pt`,
    '--fp-dt': `${fitPt(totalChars, dayColMm, 6.5)}pt`,
  } as CSSProperties;

  return createPortal(
    <div className="fp-root" style={rootStyle}>
      <style>{PRINT_CSS}</style>

      <table className="fp-table">
        <colgroup>
          <col className="fp-col-sl" />
          <col className="fp-col-item" />
          {days.map((d) => (
            <col key={d} />
          ))}
          <col className="fp-col-tot" />
        </colgroup>

        {/* thead repeats on every printed page, so each page is self-describing */}
        <thead>
          <tr>
            <th className="fp-top" colSpan={colCount}>
              <div className="fp-head">
                <div>
                  <div className="fp-title">{monthLabel}</div>
                  <div className="fp-sub">
                    Filling register
                    {search ? `, items matching “${search}”` : ''}
                  </div>
                </div>
                <div className="fp-side">
                  <div className="fp-stats">
                    <span>
                      Items<b>{entries.length}</b>
                    </span>
                    <span>
                      Filling days<b>{fillingDays}</b>
                    </span>
                    <span>
                      Total filled<b>{formatQty(grandTotal)}</b>
                    </span>
                  </div>
                  <div>Printed {printedStamp(printedAt)}</div>
                </div>
              </div>
            </th>
          </tr>
          <tr>
            <th className="fp-sl">#</th>
            <th className="fp-item">Item</th>
            {days.map((d) => (
              <th key={d} className={weekday(d) === 0 ? 'fp-sun' : undefined}>
                <div className="fp-dn">{d}</div>
                <div className="fp-dw">{WEEKDAY_LETTER[weekday(d)]}</div>
              </th>
            ))}
            <th className="fp-tot">Total</th>
          </tr>
        </thead>

        <tbody className="fp-body">
          {entries.map(({ row, rowMax }, i) => (
            <tr key={row.itmcd}>
              <td className="fp-sl">{i + 1}</td>
              <td className="fp-item">
                <div className="fp-name">{row.itmnm}</div>
                <div className="fp-meta">
                  {row.itmcd}
                  {row.itmsubcat ? ` · ${row.itmsubcat}` : ''}
                </div>
              </td>
              {days.map((d, di) => {
                const v = row.days[di];
                if (typeof v !== 'number') {
                  return (
                    <td key={d} className={`fp-c fp-nil${weekday(d) === 0 ? ' fp-sun' : ''}`}>
                      —
                    </td>
                  );
                }
                return (
                  <td key={d} className={`fp-c fp-l${heatLevel(v, rowMax)}`}>
                    {formatQty(v)}
                  </td>
                );
              })}
              <td className="fp-tot">{formatQty(row.total)}</td>
            </tr>
          ))}

          {/* Every item was empty, so say so instead of printing a bare header */}
          {entries.length === 0 && (
            <tr>
              <td className="fp-empty" colSpan={colCount}>
                No filling recorded for this month.
              </td>
            </tr>
          )}
        </tbody>

        {entries.length > 0 && (
          <tbody className="fp-end">
            <tr className="fp-total">
              <td className="fp-tl" colSpan={2}>
                Day total
              </td>
              {dayTotals.map((t, di) => (
                <td key={di} className="fp-dt">
                  {t > 0 ? formatQty(t) : '—'}
                </td>
              ))}
              <td className="fp-tot">{formatQty(grandTotal)}</td>
            </tr>
          </tbody>
        )}
      </table>

      <div className="fp-foot">
        <div className="fp-legend">
          <span>
            Low
            <span className="fp-scale">
              <span className="fp-sw fp-l1" />
              <span className="fp-sw fp-l2" />
              <span className="fp-sw fp-l3" />
              <span className="fp-sw fp-l4" />
            </span>
            High, relative to the item’s busiest day this month
          </span>
          <span>
            <span className="fp-chip">—</span>No entry that day
          </span>
          <span>
            <span className="fp-sw fp-sunsw" />
            Sunday
          </span>
        </div>
        <div className="fp-note">
          Total is the sum of that item’s entries for the month. Items with no filling this month are not listed.
        </div>
        <div className="fp-sign">
          <div>Prepared by</div>
          <div>Verified by</div>
          <div>Approved by</div>
        </div>
      </div>
    </div>,
    document.body
  );
});

export default FillingPrintSheet;