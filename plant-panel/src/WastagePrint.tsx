/**
 * WastagePrint.tsx — print support for the Wastage Register page.
 *
 *  <WastagePrintSheet />  A purpose-built A4-landscape report with two tables:
 *
 *    1. The month-wise register: one row per item, one column per day, a Total
 *       column and a Day total row. It follows the page's metric switch, with
 *       one line per item for carton wastage, pcs wastage or loose oil, or
 *       three stacked lines (CTN / PCS / OIL) per item for "All 3", the same
 *       way the Attendance register stacks Day and Night.
 *    2. The party-wise summary: one row per party with that party's wastage
 *       for the month (cartons, pcs and loose oil), a "No party recorded" row
 *       for entries saved without a party, and a Total row.
 *
 *  The sheet is portaled into <body> and hidden on screen; when printing, its
 *  stylesheet hides everything else, so no scrolling / sticky / overflow
 *  ancestor in the app layout can clip it and it paginates normally. Column
 *  headings repeat on every page and a row is never split across two pages.
 *
 *  It listens for `beforeprint`, so the Print button and Ctrl/Cmd+P behave the
 *  same: the saved PDF gets a descriptive file name and a fresh "Printed" time.
 *
 *  Only lines with wastage in the month are printed (a total above zero), so a
 *  line of zeros never reaches the paper, and a party with no wastage is left
 *  out. The on-screen grid is not affected.
 *
 *  The party table covers every item in the month. It is not narrowed by the
 *  page's item search, which only filters the register above it.
 *
 *  Quantities are formatted exactly as on screen and shaded with the screen's
 *  steps (share of that line's busiest day), in the hue the page gives each
 *  metric. The day columns are narrow, so the font size shrinks to fit the
 *  longest number in the grid instead of letting it spill into the next cell.
 *
 *  The prop types are structural: the page's own WastageItemRow,
 *  PartyWastageRow and MetricKey satisfy them as-is, so nothing needs
 *  exporting from the page.
 *
 *  Usage in the page:
 *    {canPrint && (
 *      <WastagePrintSheet
 *        items={filteredItems}
 *        parties={parties}
 *        metric={metric}
 *        year={selectedYear}
 *        monthIdx0={selectedMonthIdx}
 *        daysInMonth={daysInMonth}
 *        search={search.trim()}
 *      />
 *    )}
 * and a button that calls window.print().
 */
import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';

// ── Types ───────────────────────────────────────────────────────────────

export type WastagePrintMetric = 'cartonWastage' | 'pcsWastage' | 'looseOil' | 'all';
type MetricKey = Exclude<WastagePrintMetric, 'all'>;
type Hue = 'rose' | 'amber' | 'sky';

export interface WastagePrintSeries {
  days: (number | null)[]; // index 0 = day 1
  total: number;
}

export interface WastagePrintItem {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  cartonWastage: WastagePrintSeries;
  pcsWastage: WastagePrintSeries;
  looseOil: WastagePrintSeries;
}

export interface WastagePrintParty {
  partyCd: string | null; // partyCd and partyNm both null = entries saved without a party
  partyNm: string | null;
  cartonWastage: number;
  pcsWastage: number;
  looseOil: number;
}

interface PrintLine {
  key: MetricKey;
  series: WastagePrintSeries;
  rowMax: number;
}

// ── Metrics ─────────────────────────────────────────────────────────────

const METRIC_ORDER: MetricKey[] = ['cartonWastage', 'pcsWastage', 'looseOil'];

// Same labels, units and hues as the page's METRICS table, so the sheet reads
// like the screen. Keep the two in step if one changes.
const METRIC: Record<MetricKey, { label: string; tag: string; unit: string; hue: Hue }> = {
  cartonWastage: { label: 'Carton wastage', tag: 'CTN', unit: 'cartons', hue: 'rose' },
  pcsWastage: { label: 'Pcs wastage', tag: 'PCS', unit: 'pcs', hue: 'amber' },
  looseOil: { label: 'Loose oil', tag: 'OIL', unit: 'kg/L', hue: 'sky' },
};

// ── Layout, in mm: A4 landscape with 8 mm side margins ──────────────────

const TABLE_MM = 297 - 2 * 8;
const SL_MM = 7;
const ITEM_MM = 50; // one line per item
const ITEM_STACKED_MM = 42; // narrower once a Metric column is added
const MET_MM = 9;
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

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number';
}

// Same steps as the page's intensityClasses(): a cell is shaded by its share
// of that line's busiest day this month. Keep the two in step if one changes.
function heatLevel(value: number, rowMax: number): 1 | 2 | 3 | 4 {
  if (rowMax <= 0) return 1;
  const ratio = value / rowMax;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.35) return 2;
  if (ratio <= 0.6) return 3;
  return 4;
}

function hasWastage(p: WastagePrintParty): boolean {
  return p.cartonWastage > 0 || p.pcsWastage > 0 || p.looseOil > 0;
}

function isNamed(p: WastagePrintParty): boolean {
  return p.partyCd !== null || p.partyNm !== null;
}

function printedStamp(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time} IST`;
}

// ── Print stylesheet ────────────────────────────────────────────────────
// Everything except the .wp-root display:none and @page sits inside @media print.

const PRINT_CSS = `
.wp-root { display: none; }
@page {
  size: A4 landscape;
  margin: 10mm 8mm 13mm;
  @bottom-left { content: "System-generated wastage register"; font: 6.5pt Inter, "Segoe UI", Arial, sans-serif; color: #71717a; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 6.5pt Inter, "Segoe UI", Arial, sans-serif; color: #71717a; }
}

@media print {
  /* Show only the report: hide the app shell and undo any full-height / flex
     / overflow setup on html and body so the tables can flow across pages. */
  html, body { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(.wp-root) { display: none !important; }

  .wp-root { display: block; color: #18181b; font: 8pt/1.35 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-variant-numeric: tabular-nums; }
  .wp-root, .wp-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Tables */
  .wp-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.5pt; }
  .wp-table th, .wp-table td { padding: 0; border: 0.5pt solid #d4d4d8; text-align: center; }
  .wp-table tr { break-inside: avoid; page-break-inside: avoid; }
  .wp-group, .wp-end { break-inside: avoid; page-break-inside: avoid; }
  .wp-grid .wp-group:nth-of-type(even) tr { background: #fafafa; }
  .wp-stacked .wp-group tr:first-child td { border-top: 0.8pt solid #a1a1aa; }

  /* Header rows (repeat on every page) */
  .wp-table thead th { padding: 0.8mm 0; border-color: #a1a1aa; background: #f4f4f5; color: #3f3f46; font-weight: 600; }
  .wp-table thead th.wp-top { padding: 0 0 2.5mm; border: 0; background: none; color: inherit; font-weight: 400; text-align: left; }
  .wp-table thead th.wp-sun { background: #e4e4e7; }
  .wp-dn { font-size: 6.5pt; line-height: 1.2; font-weight: 700; }
  .wp-dw { font-size: 5pt; line-height: 1.2; font-weight: 500; color: #71717a; }

  .wp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; padding-bottom: 2mm; border-bottom: 0.8pt solid #18181b; }
  .wp-title { font-size: 16pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; }
  .wp-title.wp-title-sm { font-size: 11pt; }
  .wp-sub { margin-top: 0.5mm; font-size: 8.5pt; color: #52525b; }
  .wp-side { text-align: right; white-space: nowrap; font-size: 7pt; color: #71717a; }
  .wp-stats { display: flex; justify-content: flex-end; gap: 6mm; margin-bottom: 1mm; font-size: 8pt; }
  .wp-stats b { margin-left: 1mm; font-size: 10pt; color: #18181b; }

  /* Body cells */
  .wp-table .wp-sl { color: #71717a; }
  .wp-table .wp-item { padding: 0.7mm 1.8mm; text-align: left; }
  .wp-name { font-size: 7pt; font-weight: 600; line-height: 1.2; }
  .wp-meta { margin-top: 0.2mm; font-size: 5.5pt; line-height: 1.2; color: #71717a; }
  .wp-table td.wp-c { font-size: var(--wp-cell, 6.5pt); font-weight: 500; }
  .wp-stacked td.wp-c { height: 4.2mm; }
  .wp-table td.wp-nil, .wp-table td.wp-zero { color: #a1a1aa; font-weight: 400; }
  .wp-table td.wp-nil.wp-sun, .wp-table td.wp-zero.wp-sun { background: #f4f4f5; }
  .wp-table td.wp-tot { background: #f4f4f5; font-size: 7pt; font-weight: 700; }
  .wp-table td.wp-empty { padding: 8mm 0; color: #71717a; font-size: 8pt; }
  .wp-table td.wp-mt { font-size: 5.5pt; font-weight: 700; letter-spacing: 0.02em; }

  /* Shading steps, light to dark (Tailwind 50 / 100 / 200 / 300 of each hue) */
  .wp-rose-1 { background: #fff1f2; }
  .wp-rose-2 { background: #ffe4e6; }
  .wp-rose-3 { background: #fecdd3; }
  .wp-rose-4 { background: #fda4af; }
  .wp-amber-1 { background: #fffbeb; }
  .wp-amber-2 { background: #fef3c7; }
  .wp-amber-3 { background: #fde68a; }
  .wp-amber-4 { background: #fcd34d; }
  .wp-sky-1 { background: #f0f9ff; }
  .wp-sky-2 { background: #e0f2fe; }
  .wp-sky-3 { background: #bae6fd; }
  .wp-sky-4 { background: #7dd3fc; }

  /* Metric tint: tag cells, party column headings and legend chips. The
     longer selectors keep it ahead of the heading and total-row backgrounds. */
  .wp-tint-rose, .wp-table td.wp-mt.wp-tint-rose, .wp-party thead th.wp-tint-rose { background: #ffe4e6; color: #be123c; }
  .wp-tint-amber, .wp-table td.wp-mt.wp-tint-amber, .wp-party thead th.wp-tint-amber { background: #fef3c7; color: #b45309; }
  .wp-tint-sky, .wp-table td.wp-mt.wp-tint-sky, .wp-party thead th.wp-tint-sky { background: #e0f2fe; color: #0369a1; }

  /* Day total rows, once, after the last item */
  .wp-table tr.wp-total td { background: #e4e4e7; font-weight: 700; }
  .wp-end tr:first-child td { border-top: 1.2pt solid #18181b; }
  .wp-table tr.wp-total td.wp-dt { font-size: var(--wp-dt, 6.5pt); }
  .wp-table tr.wp-total td.wp-tl { padding: 1.2mm 1.8mm; text-align: left; font-size: 7pt; }
  .wp-table tr.wp-total td.wp-tot { font-size: 7.5pt; }

  /* Party-wise summary */
  .wp-psec { margin-top: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .wp-party th.wp-pn, .wp-party td.wp-pn { padding-left: 2mm; text-align: left; }
  .wp-party th.wp-num, .wp-party td.wp-num { padding-right: 6mm; text-align: right; }
  .wp-party tbody td { padding-top: 1.1mm; padding-bottom: 1.1mm; font-size: 7.5pt; }
  .wp-party tbody tr:nth-child(even) { background: #fafafa; }
  .wp-party td.wp-pcode { padding-left: 2mm; text-align: left; font-size: 6.5pt; color: #52525b; }
  .wp-party td.wp-num { font-weight: 600; }
  .wp-party td.wp-zero { color: #a1a1aa; font-weight: 400; }
  .wp-party td.wp-none { color: #71717a; font-style: italic; }
  .wp-party tr.wp-total td { font-size: 8pt; }

  /* Footer */
  .wp-foot { margin-top: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .wp-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5mm 5mm; font-size: 6.5pt; color: #52525b; }
  .wp-legend > span { display: inline-flex; align-items: center; gap: 1.5mm; white-space: nowrap; }
  .wp-scale { display: inline-flex; }
  .wp-sw { display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.4pt solid #a1a1aa; }
  .wp-sw.wp-sunsw { background: #f4f4f5; }
  .wp-chip { display: inline-block; min-width: 6mm; text-align: center; color: #a1a1aa; }
  .wp-lt { display: inline-block; min-width: 6mm; padding: 0.3mm 1mm; border-radius: 0.8mm; text-align: center; font-size: 5.5pt; font-weight: 700; }
  .wp-note { margin-top: 1.5mm; font-size: 6pt; color: #71717a; }
  .wp-sign { display: flex; gap: 14mm; margin-top: 11mm; break-inside: avoid; page-break-inside: avoid; break-before: avoid; }
  .wp-sign > div { flex: 1; padding-top: 1mm; border-top: 0.5pt solid #71717a; font-size: 6.5pt; color: #52525b; }
}
`;

// ── Small pieces ────────────────────────────────────────────────────────

function Scale({ hue }: { hue: Hue }) {
  return (
    <span className="wp-scale">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`wp-sw wp-${hue}-${n}`} />
      ))}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────────

const WastagePrintSheet = memo(function WastagePrintSheet({
  items,
  parties,
  metric,
  year,
  monthIdx0,
  daysInMonth,
  search,
}: {
  items: WastagePrintItem[];
  parties: WastagePrintParty[];
  metric: WastagePrintMetric;
  year: number;
  monthIdx0: number; // 0–11
  daysInMonth: number;
  search: string; // the page's item search text; empty when not filtering
}) {
  const [printedAt, setPrintedAt] = useState(() => new Date());

  // `single` is the one metric being printed, or null for the stacked "All 3".
  const single: MetricKey | null = metric === 'all' ? null : metric;
  const shown: MetricKey[] = single === null ? METRIC_ORDER : [single];
  const stacked = single === null;

  const monthLabel = new Date(year, monthIdx0, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const metricName = single === null ? 'all metrics' : METRIC[single].label.toLowerCase();
  const printTitle = `Wastage register ${monthLabel} (${metricName})`;
  const metricSubtitle =
    single === null ? 'all three metrics' : `${METRIC[single].label.toLowerCase()} (${METRIC[single].unit})`;
  const emptyText =
    single === null
      ? 'No wastage recorded for this month.'
      : `No ${METRIC[single].label.toLowerCase()} recorded for this month.`;
  const gridNote =
    single === null
      ? 'Total is the sum of each line’s entries for the month. Items, and metrics within an item, with no wastage this month are not listed.'
      : `Total is the sum of that item’s entries for the month. Items with no ${METRIC[single].label.toLowerCase()} this month are not listed.`;
  const partyNote = search
    ? 'Party totals cover every item entered this month, not only the items matching the search. “No party recorded” collects entries saved without a party, so every entry is counted once.'
    : 'Party totals cover every item entered this month. “No party recorded” collects entries saved without a party, so every entry is counted once.';

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

  // ── Month-wise register ────────────────────────────────────────────────
  // One line per item per printed metric, and only lines with wastage in the
  // month. An item with no lines left is dropped. The # column, the Items
  // count and every total below follow what is actually printed.
  const entries = items
    .map((item) => ({
      item,
      lines: shown
        .filter((key) => item[key].total > 0)
        .map(
          (key): PrintLine => ({
            key,
            series: item[key],
            rowMax: Math.max(0, ...item[key].days.filter(isNum)),
          }),
        ),
    }))
    .filter((entry) => entry.lines.length > 0);

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekday = (day: number) => new Date(year, monthIdx0, day).getDay();
  const colCount = daysInMonth + (stacked ? 4 : 3); // #, Item, (Metric), one per day, Total

  const dayTotals: Record<MetricKey, number[]> = { cartonWastage: [], pcsWastage: [], looseOil: [] };
  const grand: Record<MetricKey, number> = { cartonWastage: 0, pcsWastage: 0, looseOil: 0 };
  for (const key of shown) {
    dayTotals[key] = days.map((_, i) =>
      entries.reduce((sum, { lines }) => {
        const line = lines.find((l) => l.key === key);
        return sum + (line ? (line.series.days[i] ?? 0) : 0);
      }, 0),
    );
    grand[key] = entries.reduce((sum, { lines }) => {
      const line = lines.find((l) => l.key === key);
      return sum + (line ? line.series.total : 0);
    }, 0);
  }
  const activeDays = days.filter((_, i) => shown.some((key) => dayTotals[key][i] > 0)).length;

  // Size the numbers to the longest one in the grid. The Day total rows hold
  // sums, so they can need more room than any single cell and are sized apart.
  let bodyChars = 1;
  for (const { lines } of entries) {
    for (const { series } of lines) {
      for (let i = 0; i < daysInMonth; i++) {
        const v = series.days[i];
        if (isNum(v)) bodyChars = Math.max(bodyChars, formatQty(v).length);
      }
    }
  }
  let totalChars = 1;
  for (const key of shown) {
    for (const t of dayTotals[key]) totalChars = Math.max(totalChars, t > 0 ? formatQty(t).length : 1);
  }
  const itemMm = stacked ? ITEM_STACKED_MM : ITEM_MM;
  const dayColMm = (TABLE_MM - SL_MM - itemMm - (stacked ? MET_MM : 0) - TOT_MM) / daysInMonth;
  const rootStyle = {
    '--wp-cell': `${fitPt(bodyChars, dayColMm, 6.5)}pt`,
    '--wp-dt': `${fitPt(totalChars, dayColMm, 6.5)}pt`,
  } as CSSProperties;

  const stats = [
    { label: 'Items', value: String(entries.length) },
    { label: 'Wastage days', value: String(activeDays) },
    ...shown.map((key) => ({
      label: stacked ? METRIC[key].label : `Total ${METRIC[key].unit}`,
      value: formatQty(grand[key]),
    })),
  ];

  // ── Party-wise summary ─────────────────────────────────────────────────
  // Named parties in the order given, then the "no party" row last. Parties
  // with no wastage are left off, same as empty lines in the register.
  const withWastage = parties.filter(hasWastage);
  const namedParties = withWastage.filter(isNamed);
  const noParty = withWastage.find((p) => !isNamed(p)) ?? null;
  const partyTotals: Record<MetricKey, number> = { cartonWastage: 0, pcsWastage: 0, looseOil: 0 };
  for (const p of withWastage) {
    for (const key of METRIC_ORDER) partyTotals[key] += p[key];
  }

  return createPortal(
    <div className="wp-root" style={rootStyle}>
      <style>{PRINT_CSS}</style>

      <table className={`wp-table wp-grid${stacked ? ' wp-stacked' : ''}`}>
        <colgroup>
          <col style={{ width: `${SL_MM}mm` }} />
          <col style={{ width: `${itemMm}mm` }} />
          {stacked && <col style={{ width: `${MET_MM}mm` }} />}
          {days.map((d) => (
            <col key={d} />
          ))}
          <col style={{ width: `${TOT_MM}mm` }} />
        </colgroup>

        {/* thead repeats on every printed page, so each page is self-describing */}
        <thead>
          <tr>
            <th className="wp-top" colSpan={colCount}>
              <div className="wp-head">
                <div>
                  <div className="wp-title">{monthLabel}</div>
                  <div className="wp-sub">
                    Wastage register, {metricSubtitle}
                    {search ? `, items matching “${search}”` : ''}
                  </div>
                </div>
                <div className="wp-side">
                  <div className="wp-stats">
                    {stats.map((s) => (
                      <span key={s.label}>
                        {s.label}
                        <b>{s.value}</b>
                      </span>
                    ))}
                  </div>
                  <div>Printed {printedStamp(printedAt)}</div>
                </div>
              </div>
            </th>
          </tr>
          <tr>
            <th className="wp-sl">#</th>
            <th className="wp-item">Item</th>
            {stacked && <th>Metric</th>}
            {days.map((d) => (
              <th key={d} className={weekday(d) === 0 ? 'wp-sun' : undefined}>
                <div className="wp-dn">{d}</div>
                <div className="wp-dw">{WEEKDAY_LETTER[weekday(d)]}</div>
              </th>
            ))}
            <th className="wp-tot">Total</th>
          </tr>
        </thead>

        {/* One tbody per item, so an item's stacked lines never split across pages */}
        {entries.map(({ item, lines }, i) => (
          <tbody key={item.itmcd} className="wp-group">
            {lines.map((line, li) => {
              const { hue, tag } = METRIC[line.key];
              return (
                <tr key={line.key}>
                  {li === 0 && (
                    <td className="wp-sl" rowSpan={lines.length}>
                      {i + 1}
                    </td>
                  )}
                  {li === 0 && (
                    <td className="wp-item" rowSpan={lines.length}>
                      <div className="wp-name">{item.itmnm}</div>
                      <div className="wp-meta">
                        {item.itmcd}
                        {item.itmsubcat ? ` · ${item.itmsubcat}` : ''}
                      </div>
                    </td>
                  )}
                  {stacked && <td className={`wp-mt wp-tint-${hue}`}>{tag}</td>}
                  {days.map((d, di) => {
                    const v = line.series.days[di];
                    const sun = weekday(d) === 0 ? ' wp-sun' : '';
                    if (!isNum(v)) {
                      return (
                        <td key={d} className={`wp-c wp-nil${sun}`}>
                          —
                        </td>
                      );
                    }
                    // Zero is an entry saved with none in this metric, so it is
                    // shown quietly rather than shaded like real wastage.
                    if (v === 0) {
                      return (
                        <td key={d} className={`wp-c wp-zero${sun}`}>
                          0
                        </td>
                      );
                    }
                    return (
                      <td key={d} className={`wp-c wp-${hue}-${heatLevel(v, line.rowMax)}`}>
                        {formatQty(v)}
                      </td>
                    );
                  })}
                  <td className="wp-tot">{formatQty(line.series.total)}</td>
                </tr>
              );
            })}
          </tbody>
        ))}

        {/* Nothing to list for this metric, so say so instead of printing a bare header */}
        {entries.length === 0 && (
          <tbody>
            <tr>
              <td className="wp-empty" colSpan={colCount}>
                {emptyText}
              </td>
            </tr>
          </tbody>
        )}

        {/* Day totals, once, after the last item: one row per printed metric */}
        {entries.length > 0 && (
          <tbody className="wp-end">
            {shown.map((key, ki) => (
              <tr key={key} className="wp-total">
                {ki === 0 && (
                  <td className="wp-tl" colSpan={2} rowSpan={shown.length}>
                    Day total
                  </td>
                )}
                {stacked && <td className={`wp-mt wp-tint-${METRIC[key].hue}`}>{METRIC[key].tag}</td>}
                {dayTotals[key].map((t, di) => (
                  <td key={di} className="wp-dt">
                    {t > 0 ? formatQty(t) : '—'}
                  </td>
                ))}
                <td className="wp-tot">{formatQty(grand[key])}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>

      <div className="wp-foot">
        <div className="wp-legend">
          {shown.map((key) => (
            <span key={key}>
              {stacked && (
                <>
                  <span className={`wp-lt wp-tint-${METRIC[key].hue}`}>{METRIC[key].tag}</span>
                  {METRIC[key].label} ({METRIC[key].unit})
                </>
              )}
              Low
              <Scale hue={METRIC[key].hue} />
              High
            </span>
          ))}
          <span>Shading is relative to that {stacked ? 'line’s' : 'item’s'} busiest day this month</span>
          <span>
            <span className="wp-chip">0</span>Entry saved, none in {stacked ? 'that metric' : 'this metric'}
          </span>
          <span>
            <span className="wp-chip">—</span>No entry that day
          </span>
          <span>
            <span className="wp-sw wp-sunsw" />
            Sunday
          </span>
        </div>
        <div className="wp-note">{gridNote}</div>
      </div>

      {/* Party-wise summary: its own table with its own repeating heading, kept
          together on one page when it fits */}
      {(namedParties.length > 0 || noParty) && (
        <section className="wp-psec">
          <table className="wp-table wp-party">
            <colgroup>
              <col style={{ width: `${SL_MM}mm` }} />
              <col />
              <col style={{ width: '32mm' }} />
              {METRIC_ORDER.map((key) => (
                <col key={key} style={{ width: '40mm' }} />
              ))}
            </colgroup>

            <thead>
              <tr>
                <th className="wp-top" colSpan={3 + METRIC_ORDER.length}>
                  <div className="wp-head">
                    <div>
                      <div className="wp-title wp-title-sm">Party-wise wastage</div>
                      <div className="wp-sub">{monthLabel}, all items</div>
                    </div>
                    <div className="wp-side">
                      <div className="wp-stats">
                        <span>
                          Parties<b>{namedParties.length}</b>
                        </span>
                      </div>
                      <div>Printed {printedStamp(printedAt)}</div>
                    </div>
                  </div>
                </th>
              </tr>
              <tr>
                <th className="wp-sl">#</th>
                <th className="wp-pn">Party</th>
                <th className="wp-pn">Code</th>
                {METRIC_ORDER.map((key) => (
                  <th key={key} className={`wp-num wp-tint-${METRIC[key].hue}`}>
                    {METRIC[key].label}
                    <div className="wp-dw">{METRIC[key].unit}</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {namedParties.map((p, i) => (
                <tr key={`${p.partyCd ?? ''}|${p.partyNm ?? ''}`}>
                  <td className="wp-sl">{i + 1}</td>
                  <td className="wp-pn">{p.partyNm ?? p.partyCd}</td>
                  <td className="wp-pcode">{p.partyNm && p.partyCd ? p.partyCd : ''}</td>
                  {METRIC_ORDER.map((key) => (
                    <td key={key} className={`wp-num${p[key] > 0 ? '' : ' wp-zero'}`}>
                      {p[key] > 0 ? formatQty(p[key]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {noParty && (
                <tr>
                  <td className="wp-sl" />
                  <td className="wp-pn wp-none">No party recorded</td>
                  <td className="wp-pcode" />
                  {METRIC_ORDER.map((key) => (
                    <td key={key} className={`wp-num${noParty[key] > 0 ? '' : ' wp-zero'}`}>
                      {noParty[key] > 0 ? formatQty(noParty[key]) : '—'}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>

            <tbody className="wp-end">
              <tr className="wp-total">
                <td className="wp-tl" colSpan={3}>
                  Total
                </td>
                {METRIC_ORDER.map((key) => (
                  <td key={key} className="wp-num">
                    {formatQty(partyTotals[key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="wp-note">{partyNote}</div>
        </section>
      )}

      <div className="wp-sign">
        <div>Prepared by</div>
        <div>Verified by</div>
        <div>Approved by</div>
      </div>
    </div>,
    document.body
  );
});

export default WastagePrintSheet;