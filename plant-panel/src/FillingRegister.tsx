import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, AlertTriangle, Search, X, Layers, Printer } from 'lucide-react';
import FillingPrintSheet from './FillingPrint';

// ════════════════════════════════════════════════════════════════════════
// Filling Register — item × day-of-month grid.
//
// Sibling page to Attendance.tsx: same data-loading shape, same table
// chrome, same visual tokens (zinc palette, font-mono for data, sticky
// header + sticky first column, motion timing). What's different is the
// axes: rows are catalog ITEMS instead of employees, and each cell holds a
// FILLING quantity for that item on that day instead of a P/A mark.
//
// Backend contract: GET /filling/monthly-history?year=YYYY&month=M (month
// 0-based, matching /attendance/month's convention). See
// filling.controller.monthly-addition.ts for the endpoint this expects —
// it does the ITMCD-grouping and day-array shaping server-side, so this
// page just renders what it's given. Like Attendance.tsx, this page is
// API-only: no VITE_API_URL means a clear configuration error, never a
// silent fallback to sample data.
//
// Printing: the Print button hands off to FillingPrint.tsx, a purpose-built
// A4-landscape sheet that is portaled into <body>, hidden on screen, and
// shown on its own when printing. This page only decides when printing is
// available (canPrint) and what the sheet is given, so it carries no print
// CSS of its own.
// ════════════════════════════════════════════════════════════════════════

// ─── Types ─────────────────────────────────────────────────────────────

interface FillingItemRow {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  days: (number | null)[]; // index 0 = day 1
  total: number;
}

interface GetMonthlyHistoryResponse {
  success: boolean;
  message?: string;
  data: {
    year: number;
    month: number; // 0-based
    daysInMonth: number;
    items: FillingItemRow[];
  };
}

type LoadState = 'loading' | 'loaded' | 'error';

// ─── API client — production-only, no demo fallback (same convention as Attendance.tsx) ───

const RAW_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;
const BASE_URL = (RAW_BASE_URL ?? '').replace(/\/+$/, '');

function hasApiBaseUrl(): boolean {
  return BASE_URL.length > 0;
}

function getApiBaseUrl(): string {
  return BASE_URL;
}

async function fetchMonthlyFilling(year: number, month0: number): Promise<GetMonthlyHistoryResponse['data']> {
  if (!BASE_URL) throw new Error('VITE_API_URL is not configured');
  const res = await fetch(`${BASE_URL}/filling/monthly-history?year=${year}&month=${month0}`);
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const json = (await res.json()) as GetMonthlyHistoryResponse;
  if (!json.success) throw new Error(json.message ?? 'Request failed');
  return json.data;
}

// ─── Month metadata (same table as Attendance.tsx) ────────────────────

const MONTHS = [
  { name: 'January' }, { name: 'February' }, { name: 'March' }, { name: 'April' },
  { name: 'May' }, { name: 'June' }, { name: 'July' }, { name: 'August' },
  { name: 'September' }, { name: 'October' }, { name: 'November' }, { name: 'December' },
];

function daysInMonthFallback(monthIdx0: number, year: number): number {
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];

// ─── Number formatting ──────────────────────────────────────────────────
// FILLING is a Decimal(18,3) server-side but is typically whole-ish
// production quantities. Trim trailing zeros so "12.000" reads as "12"
// but "12.500" still reads as "12.5" — avoids a grid full of fake precision.

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

// ─── Cell intensity scale ───────────────────────────────────────────────
// Unlike Attendance's binary P/A, filling amounts are continuous, so cells
// need a magnitude scale rather than a fixed two-color palette. Scale is
// computed per-load (relative to the current month's own max), not
// globally fixed, so a light day and a heavy day both use their own
// month's full color range rather than everything looking pale next to
// one outlier item.
const INTENSITY_STEPS = [
  { max: 0,    bg: '',                text: '' },              // handled separately (blank/null)
  { max: 0.15, bg: 'bg-emerald-50',   text: 'text-emerald-700' },
  { max: 0.35, bg: 'bg-emerald-100',  text: 'text-emerald-700' },
  { max: 0.6,  bg: 'bg-emerald-200',  text: 'text-emerald-800' },
  { max: 1.01, bg: 'bg-emerald-300',  text: 'text-emerald-900' },
];

function intensityClasses(value: number, rowMax: number): { bg: string; text: string } {
  if (rowMax <= 0) return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
  const ratio = value / rowMax;
  for (const step of INTENSITY_STEPS) {
    if (ratio <= step.max && step.bg) return { bg: step.bg, text: step.text };
  }
  return { bg: 'bg-emerald-300', text: 'text-emerald-900' };
}

// ─── Small presentational atoms (reused verbatim from Attendance.tsx) ──

function SelectField({
  label, value, onChange, children, width = 'w-36',
}: {
  label: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">{label}</span>
      <div className={`relative ${width}`}>
        <select
          value={value}
          onChange={onChange}
          className="w-full appearance-none bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 font-mono cursor-pointer focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all hover:border-zinc-400 pr-8"
        >
          {children}
        </select>
        <svg
          className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Search</span>
      <div className="relative w-56">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Item name or code"
          className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-8 text-sm text-zinc-800 placeholder:text-zinc-300 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900 hover:border-zinc-400"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-500"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// Present-only-style toggle, reworded for this page's own binary: hide
// items that had zero filling activity this month vs show every catalog
// item that appeared at all.
function FilledOnlyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Rows</span>
      <button
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-mono font-medium transition-colors ${
          checked
            ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
            : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-400 hover:text-zinc-600'
        }`}
      >
        <Layers size={13} strokeWidth={2.5} />
        Active only
      </button>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────

export default function FillingRegister() {
  const today = new Date();

  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(today.getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const [items, setItems] = useState<FillingItemRow[]>([]);
  const [daysInMonth, setDaysInMonth] = useState<number>(
    daysInMonthFallback(today.getMonth(), today.getFullYear()),
  );
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage('');

    if (!hasApiBaseUrl()) {
      setLoadState('error');
      setErrorMessage('VITE_API_URL is not configured');
      return;
    }

    try {
      const data = await fetchMonthlyFilling(selectedYear, selectedMonthIdx);
      setItems(Array.isArray(data.items) ? data.items : []);
      setDaysInMonth(data.daysInMonth ?? daysInMonthFallback(selectedMonthIdx, selectedYear));
      setLoadState('loaded');
    } catch (err) {
      setLoadState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [selectedMonthIdx, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  // Filter: search matches item name or code (case-insensitive); active-only
  // hides rows whose total is zero. Applied together, search first since
  // it's the more common narrowing action.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((row) => !q || row.itmnm.toLowerCase().includes(q) || row.itmcd.toLowerCase().includes(q))
      .filter((row) => !activeOnly || row.total > 0);
  }, [items, search, activeOnly]);

  // Grand total across every visible row's daily cells, per day — a
  // "plant-wide filling this day" footer row. Computed only from what's
  // currently filtered/visible, so the number always matches what's on
  // screen.
  const dayTotals = useMemo(() => {
    const totals = new Array(daysInMonth).fill(0);
    for (const row of filteredItems) {
      row.days.forEach((v, i) => {
        if (v !== null) totals[i] += v;
      });
    }
    return totals;
  }, [filteredItems, daysInMonth]);

  const grandTotal = useMemo(
    () => filteredItems.reduce((sum, row) => sum + row.total, 0),
    [filteredItems],
  );

  const isLoading = loadState === 'loading';
  const isError = loadState === 'error';
  const isEmpty = loadState === 'loaded' && filteredItems.length === 0;
  const isFilteredEmpty = isEmpty && items.length > 0;
  // Printing is offered once the grid has loaded and at least one row is
  // visible. FillingPrintSheet drops items with no filling in the month on
  // its own, so "Active only" doesn't change the printout; the search does.
  const canPrint = loadState === 'loaded' && filteredItems.length > 0;

  return (
    <div className="w-full p-8 bg-zinc-50 min-h-screen">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-7"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">
            Filling Register
          </span>
          <span className="h-px w-8 bg-zinc-300 block" />
          <span className="text-[10px] font-mono text-zinc-400">
            {MONTHS[selectedMonthIdx].name} {selectedYear}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Filling</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              disabled={!canPrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:text-zinc-600"
              aria-label="Print filling register"
              title={canPrint ? 'Print, or save as PDF to share' : 'Nothing to print yet'}
            >
              <Printer size={14} />
              Print
            </button>
            <button
              onClick={load}
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
              aria-label="Refresh" title="Refresh"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Error notice */}
      <AnimatePresence>
        {isError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm shadow-sm"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" />
            <div className="flex-1">
              <p className="font-medium text-zinc-800">
                {hasApiBaseUrl() ? `Couldn't reach ${getApiBaseUrl()}` : 'VITE_API_URL is not set'}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {hasApiBaseUrl() ? (
                  <>
                    {errorMessage}. Confirm the server is running, CORS allows this origin, and{' '}
                    <code className="font-mono">VITE_API_URL</code> in your .env is correct. This page also
                    needs the <code className="font-mono">/filling/monthly-history</code> endpoint —
                    confirm it's wired up server-side.
                  </>
                ) : (
                  <>
                    Add it to your .env file, e.g. <code className="font-mono">VITE_API_URL=http://localhost:4000/api</code>, then restart.
                  </>
                )}
              </p>
            </div>
            <button
              onClick={load}
              className="whitespace-nowrap font-mono text-[11px] font-medium uppercase text-zinc-600 underline"
            >
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-end gap-3 mb-5"
      >
        <SelectField
          label="Month"
          value={MONTHS[selectedMonthIdx].name}
          onChange={(e) => setSelectedMonthIdx(MONTHS.findIndex((m) => m.name === e.target.value))}
          width="w-36"
        >
          {MONTHS.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
        </SelectField>

        <SelectField
          label="Year"
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          width="w-24"
        >
          {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
        </SelectField>

        <SearchField value={search} onChange={setSearch} />

        <FilledOnlyToggle checked={activeOnly} onChange={setActiveOnly} />

        <AnimatePresence>
          {!isLoading && !isError && filteredItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-xs font-mono text-zinc-500 self-end"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {filteredItems.length} item{filteredItems.length === 1 ? '' : 's'}
              {(search || activeOnly) && items.length !== filteredItems.length && (
                <span className="text-zinc-300">/ {items.length}</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-zinc-200 bg-white overflow-auto max-h-[64vh] shadow-sm"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#e4e4e7 transparent' }}
      >
        <table className="border-collapse min-w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-zinc-50 border-b border-r border-zinc-100 text-left px-5 py-3 text-[10px] font-medium tracking-widest uppercase text-zinc-400 min-w-[220px] whitespace-nowrap">
                Item
              </th>

              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                <th
                  key={day}
                  className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 py-3 text-center text-[10px] font-mono font-normal text-zinc-400 min-w-[44px] w-11"
                >
                  {day}
                </th>
              ))}

              <th className="sticky right-0 top-0 z-20 bg-zinc-50 border-b border-l border-zinc-200 px-4 py-3 text-[10px] font-medium tracking-widest uppercase whitespace-nowrap text-center text-emerald-600 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.08)]">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            <AnimatePresence mode="wait">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <motion.tr
                    key={`sk-${i}`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-zinc-50"
                  >
                    <td className="sticky left-0 bg-white border-r border-zinc-50 px-5 py-3">
                      <div className="h-3 rounded bg-zinc-100 animate-pulse" style={{ width: 110 + (i % 3) * 30 }} />
                    </td>
                    {Array.from({ length: daysInMonth }).map((_, j) => (
                      <td key={j} className="py-3 px-0 text-center">
                        <div className="h-3 w-3 rounded bg-zinc-100 animate-pulse mx-auto" />
                      </td>
                    ))}
                    <td className="sticky right-0 bg-white px-4 py-3 border-l border-zinc-100">
                      <div className="h-3 w-8 rounded bg-zinc-100 animate-pulse mx-auto" />
                    </td>
                  </motion.tr>
                ))
              ) : isError ? null : (
                filteredItems.map((row, index) => {
                  const rowMax = Math.max(0, ...row.days.filter((v): v is number => v !== null));
                  return (
                    <motion.tr
                      key={row.itmcd}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.015, ease: [0.16, 1, 0.3, 1] }}
                      className="border-b border-zinc-50 hover:bg-zinc-50/80 transition-colors group"
                    >
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-zinc-50/80 border-r border-zinc-100 px-5 py-2.5 transition-colors">
                        <div className="font-medium text-zinc-800 text-[13px] whitespace-nowrap">
                          {row.itmnm}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 whitespace-nowrap">
                          <span className="font-mono">{row.itmcd}</span>
                          {row.itmsubcat && (
                            <>
                              <span className="text-zinc-200">·</span>
                              <span>{row.itmsubcat}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {row.days.map((value, dayIndex) => {
                        if (value === null) {
                          return (
                            <td key={dayIndex} className="py-2.5 px-0 text-center">
                              <span className="inline-flex items-center justify-center min-w-[34px] h-[22px] px-1 rounded text-[9px] font-mono font-medium mx-auto text-zinc-300">
                                —
                              </span>
                            </td>
                          );
                        }
                        const { bg, text } = intensityClasses(value, rowMax);
                        return (
                          <td key={dayIndex} className="py-2.5 px-0 text-center">
                            <span
                              title={`${row.itmnm} — day ${dayIndex + 1}: ${formatQty(value)}`}
                              className={`inline-flex min-w-[34px] h-[22px] items-center justify-center rounded px-1 mx-auto whitespace-nowrap text-[10px] font-mono font-medium ${bg} ${text}`}
                            >
                              {formatQty(value)}
                            </span>
                          </td>
                        );
                      })}

                      <td className="sticky right-0 z-10 px-4 py-2.5 text-center font-mono text-[13px] font-medium text-emerald-600 border-l border-zinc-200 bg-zinc-50/95 group-hover:bg-zinc-100/95 transition-colors shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.06)]">
                        {formatQty(row.total)}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </AnimatePresence>
          </tbody>

          {/* Footer — plant-wide total per day, pinned to the bottom the same
              way the header is pinned to the top, so it's visible whether
              you're scrolled to the top or bottom of a long item list.
              Its own leading/trailing cells are additionally pinned
              left/right, matching every body row, so all four corners of
              the grid (item↔day, item↔total, day-total↔day, day-total↔
              grand-total) stay put during scroll in either direction. */}
          {!isLoading && !isError && filteredItems.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-20 border-t-2 border-zinc-200 bg-zinc-100 shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.08)]">
                <td className="sticky left-0 z-30 bg-zinc-100 border-r border-zinc-200 px-5 py-2.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500 whitespace-nowrap">
                  Day total
                </td>
                {dayTotals.map((total, i) => (
                  <td key={i} className="py-2.5 px-0 text-center font-mono text-[10px] text-zinc-500">
                    {total > 0 ? formatQty(total) : '—'}
                  </td>
                ))}
                <td className="sticky right-0 z-30 px-4 py-2.5 text-center font-mono text-[13px] font-semibold text-zinc-800 border-l border-zinc-200 bg-zinc-100 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.08)]">
                  {formatQty(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* Empty state */}
        {isEmpty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 gap-2"
          >
            <svg className="text-zinc-300 mb-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="text-sm font-medium text-zinc-400">
              {isFilteredEmpty ? 'Nothing matches these filters' : 'No filling recorded this month'}
            </p>
            <p className="text-xs text-zinc-300">
              {isFilteredEmpty
                ? 'Clear the search or turn off "Active only" to see everything.'
                : 'No filling entries were found for this month.'}
            </p>
          </motion.div>
        )}
      </motion.div>

      {/* Legend */}
      <AnimatePresence>
        {!isLoading && !isError && filteredItems.length > 0 && (
          <motion.div
            key="legend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4"
          >
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span>Low</span>
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-50 border border-emerald-100" />
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100" />
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-200" />
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-300" />
              <span>High</span>
              <span className="ml-1">— relative to that item's busiest day this month</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-medium text-zinc-300">—</span>
              No entry that day
            </div>
            <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-zinc-400">
              Filling register · Connected to {getApiBaseUrl()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Print sheet — portaled into <body>, hidden on screen, and shown on
          its own when printing (see FillingPrint.tsx). Mounted only when
          there is something to print, the same gate as the Print button. */}
      {canPrint && (
        <FillingPrintSheet
          items={filteredItems}
          year={selectedYear}
          monthIdx0={selectedMonthIdx}
          daysInMonth={daysInMonth}
          search={search.trim()}
        />
      )}
    </div>
  );
}