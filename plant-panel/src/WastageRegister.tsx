import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, AlertTriangle, Search, X, Layers, Printer, Package, Boxes, Droplet } from 'lucide-react';
import WastagePrintSheet from './WastagePrint';

// ════════════════════════════════════════════════════════════════════════
// Wastage Register — item × day-of-month grid, with a party-wise summary
// table underneath it.
//
// Sibling page to FillingRegister.tsx (same loading states, same table
// chrome, same four-edge sticky totals, same print approach). The real
// difference: wastage has THREE parallel metrics per item per day —
// carton wastage, pcs wastage, and loose oil — instead of filling's single
// FILLING number. So this page adds a metric switcher on top of the same
// grid skeleton, and every per-cell/per-total computation is done once per
// selected metric rather than assuming there's only one number to show.
//
// Backend contract: GET /wastage/monthly-history?year=YYYY&month=M (month
// 0-based). See wastage.controller.monthly-addition.ts — it returns three
// parallel { days, total } series per item (cartonWastage, pcsWastage,
// looseOil) rather than one, precisely because submitWastageEntries lets a
// row exist with some metrics recorded and others still at their default
// (0 for cartons/pcs, null for loose oil) — see that endpoint's comments
// for exactly which "no value" cases map to null vs a real 0.
//
// The same response also carries `parties`: one row per packing party with
// that party's month totals for the same three metrics, plus a last row with
// no party for entries saved without one. It feeds the party-wise table under
// the grid. That table always covers every item, so the item search above
// the grid does not narrow it.
//
// Printing: the Print button hands off to WastagePrint.tsx, a purpose-built
// A4-landscape report (the month-wise register plus the party-wise summary)
// that is portaled into <body>, hidden on screen, and shown on its own when
// printing. This page only decides when printing is available (canPrint) and
// what the sheet is given, so it carries no print CSS of its own.
//
// Like FillingRegister.tsx, this page is API-only: no VITE_API_URL means a
// clear configuration error, never a silent fallback to sample data.
// ════════════════════════════════════════════════════════════════════════

// ─── Types ─────────────────────────────────────────────────────────────

type MetricKey = 'cartonWastage' | 'pcsWastage' | 'looseOil' | 'all';
// The three real, fetchable metrics — 'all' is a display mode built from
// these three, not a fourth series from the backend.
type RealMetricKey = Exclude<MetricKey, 'all'>;

interface MetricSeries {
  days: (number | null)[]; // index 0 = day 1
  total: number;
}

interface WastageItemRow {
  itmcd: string;
  itmnm: string;
  itmsubcat: string | null;
  cartonWastage: MetricSeries;
  pcsWastage: MetricSeries;
  looseOil: MetricSeries;
}

// One packing party's totals for the month. partyCd and partyNm both null
// means "entries saved without a party" (always the last row, when present).
interface PartyWastageRow {
  partyCd: string | null;
  partyNm: string | null;
  cartonWastage: number;
  pcsWastage: number;
  looseOil: number;
}

interface GetMonthlyHistoryResponse {
  success: boolean;
  message?: string;
  data: {
    year: number;
    month: number; // 0-based
    daysInMonth: number;
    items: WastageItemRow[];
    parties: PartyWastageRow[];
  };
}

type LoadState = 'loading' | 'loaded' | 'error';

// ─── Metric metadata ────────────────────────────────────────────────────
// One place describing each metric's label, unit, icon, and color role —
// everything else (grid rendering, totals, legend, print heading) reads
// from this rather than re-deciding per metric inline.

const METRICS: Record<RealMetricKey, {
  label: string;
  shortLabel: string; // used in the compact "all 3" stacked cell
  unit: string;
  icon: typeof Package;
  colorClass: string; // tailwind color stem, e.g. 'amber' — used to build bg-*/text-* classes
}> = {
  cartonWastage: { label: 'Carton Wastage', shortLabel: 'CTN', unit: 'cartons', icon: Package, colorClass: 'rose' },
  pcsWastage:    { label: 'Pcs Wastage',    shortLabel: 'PCS', unit: 'pcs',      icon: Boxes,   colorClass: 'amber' },
  looseOil:      { label: 'Loose Oil',      shortLabel: 'OIL', unit: 'kg/L',     icon: Droplet, colorClass: 'sky' },
};
const METRIC_ORDER: RealMetricKey[] = ['cartonWastage', 'pcsWastage', 'looseOil'];

// Fixed pixel width used for each of the three stacked sticky total
// columns in "All 3" mode — needs to be a concrete number (not a Tailwind
// class) because it's used to compute explicit `right` offsets so the
// three columns sit side by side instead of collapsing onto each other.
// See the header/body/footer total-column rendering below for why this
// can't just be three `right-0` classes with conditional inline overrides.
const ALL_METRIC_COL_WIDTH = 60;

// ─── API client — production-only, no demo fallback (same convention as FillingRegister.tsx) ───

const RAW_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;
const BASE_URL = (RAW_BASE_URL ?? '').replace(/\/+$/, '');

function hasApiBaseUrl(): boolean {
  return BASE_URL.length > 0;
}

function getApiBaseUrl(): string {
  return BASE_URL;
}

async function fetchMonthlyWastage(year: number, month0: number): Promise<GetMonthlyHistoryResponse['data']> {
  if (!BASE_URL) throw new Error('VITE_API_URL is not configured');
  const res = await fetch(`${BASE_URL}/wastage/monthly-history?year=${year}&month=${month0}`);
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const json = (await res.json()) as GetMonthlyHistoryResponse;
  if (!json.success) throw new Error(json.message ?? 'Request failed');
  return json.data;
}

// ─── Month metadata (same table as FillingRegister.tsx) ────────────────

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
// Same trailing-zero trim as filling. CARTON_WASTAGE/PCS_WASTAGE are
// typically whole numbers; LOOSE_OIL is the one metric likely to carry
// real decimals (kg/L), so the trim matters more here than it did for
// filling's mostly-integer quantities.

function formatQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

// ─── Cell intensity scale ───────────────────────────────────────────────
// Same relative-to-row-max approach as filling, but parameterized by
// color stem so each metric gets its own hue rather than all three
// competing for the same green. Tailwind needs full class names at build
// time (no dynamic string construction), so this returns from an explicit
// per-color lookup table rather than interpolating `bg-${color}-100`.

const INTENSITY_RATIO_STEPS = [0.15, 0.35, 0.6, 1.01];

const COLOR_SCALES: Record<string, { bg: string; text: string }[]> = {
  rose: [
    { bg: 'bg-rose-50',  text: 'text-rose-700' },
    { bg: 'bg-rose-100', text: 'text-rose-700' },
    { bg: 'bg-rose-200', text: 'text-rose-800' },
    { bg: 'bg-rose-300', text: 'text-rose-900' },
  ],
  amber: [
    { bg: 'bg-amber-50',  text: 'text-amber-700' },
    { bg: 'bg-amber-100', text: 'text-amber-700' },
    { bg: 'bg-amber-200', text: 'text-amber-800' },
    { bg: 'bg-amber-300', text: 'text-amber-900' },
  ],
  sky: [
    { bg: 'bg-sky-50',  text: 'text-sky-700' },
    { bg: 'bg-sky-100', text: 'text-sky-700' },
    { bg: 'bg-sky-200', text: 'text-sky-800' },
    { bg: 'bg-sky-300', text: 'text-sky-900' },
  ],
};

function intensityClasses(value: number, rowMax: number, colorClass: string): { bg: string; text: string } {
  const scale = COLOR_SCALES[colorClass] ?? COLOR_SCALES.rose;
  if (rowMax <= 0) return scale[0];
  const ratio = value / rowMax;
  for (let i = 0; i < INTENSITY_RATIO_STEPS.length; i++) {
    if (ratio <= INTENSITY_RATIO_STEPS[i]) return scale[i];
  }
  return scale[scale.length - 1];
}

// Full, literal class-name lookups for anywhere a metric's accent color is
// needed as plain text/background/chip color (as opposed to the 4-step
// intensity scale above). Tailwind's compiler scans source files for class
// names as literal strings — a template-string-built class like
// `text-${colorClass}-600` never appears as that literal substring
// anywhere in the file, so Tailwind won't generate the CSS for it and the
// element silently renders unstyled. Every class actually used below is
// spelled out here so it exists in the source verbatim.
const TEXT_600: Record<string, string> = {
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  sky: 'text-sky-600',
};
const CHIP_BG_100: Record<string, string> = {
  rose: 'bg-rose-100',
  amber: 'bg-amber-100',
  sky: 'bg-sky-100',
};
const CHIP_TEXT_700: Record<string, string> = {
  rose: 'text-rose-700',
  amber: 'text-amber-700',
  sky: 'text-sky-700',
};

// ─── Small presentational atoms (reused from FillingRegister.tsx) ──────

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

function ActiveOnlyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Rows</span>
      <button
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-mono font-medium transition-colors ${
          checked
            ? 'border-rose-200 bg-rose-50 text-rose-600'
            : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-400 hover:text-zinc-600'
        }`}
      >
        <Layers size={13} strokeWidth={2.5} />
        Active only
      </button>
    </div>
  );
}

// Metric switcher — the one control filling's page didn't need. Segmented
// control matching Attendance's ShiftToggle visual language: a small
// group of mutually-exclusive pill buttons, each metric getting its own
// accent color so switching metrics is visually obvious at a glance, plus
// a 4th "All 3" option that stacks compact sub-values per cell instead of
// picking one series.
function MetricToggle({ metric, onChange }: { metric: MetricKey; onChange: (m: MetricKey) => void }) {
  const activeClasses: Record<MetricKey, string> = {
    cartonWastage: 'bg-rose-50 text-rose-600',
    pcsWastage: 'bg-amber-50 text-amber-600',
    looseOil: 'bg-sky-50 text-sky-600',
    all: 'bg-violet-50 text-violet-600',
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Metric</span>
      <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
        {METRIC_ORDER.map((key) => {
          const { shortLabel, icon: Icon } = METRICS[key];
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-mono font-medium transition-colors ${
                metric === key ? activeClasses[key] : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              <Icon size={13} /> {shortLabel}
            </button>
          );
        })}
        <button
          onClick={() => onChange('all')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-mono font-medium transition-colors ${
            metric === 'all' ? activeClasses.all : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          All 3
        </button>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────

export default function WastageRegister() {
  const today = new Date();

  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(today.getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [metric, setMetric] = useState<MetricKey>('cartonWastage');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const [items, setItems] = useState<WastageItemRow[]>([]);
  const [parties, setParties] = useState<PartyWastageRow[]>([]);
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
      const data = await fetchMonthlyWastage(selectedYear, selectedMonthIdx);
      setItems(Array.isArray(data.items) ? data.items : []);
      // `parties` arrived with the party-wise summary; a server that hasn't
      // been updated yet simply sends none, and the summary stays hidden.
      setParties(Array.isArray(data.parties) ? data.parties : []);
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

  // "Active" for the row filter means non-zero total on ANY of the three
  // metrics, not just the currently-selected one — switching metrics
  // shouldn't silently change which rows the active-only filter admits,
  // since the underlying row didn't stop being active just because you're
  // looking at a different column of its data right now.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((row) => !q || row.itmnm.toLowerCase().includes(q) || row.itmcd.toLowerCase().includes(q))
      .filter((row) => !activeOnly || row.cartonWastage.total > 0 || row.pcsWastage.total > 0 || row.looseOil.total > 0);
  }, [items, search, activeOnly]);

  // Day totals and grand total are computed per real metric (never for
  // 'all', which has no single number to sum) so the footer/legend can
  // read whichever one(s) it needs without recomputing.
  const dayTotalsByMetric = useMemo(() => {
    const result: Record<RealMetricKey, number[]> = {
      cartonWastage: new Array(daysInMonth).fill(0),
      pcsWastage: new Array(daysInMonth).fill(0),
      looseOil: new Array(daysInMonth).fill(0),
    };
    for (const row of filteredItems) {
      for (const key of METRIC_ORDER) {
        row[key].days.forEach((v, i) => {
          if (v !== null) result[key][i] += v;
        });
      }
    }
    return result;
  }, [filteredItems, daysInMonth]);

  const grandTotalsByMetric = useMemo(() => {
    const result: Record<RealMetricKey, number> = { cartonWastage: 0, pcsWastage: 0, looseOil: 0 };
    for (const row of filteredItems) {
      for (const key of METRIC_ORDER) result[key] += row[key].total;
    }
    return result;
  }, [filteredItems]);

  // Party-wise summary figures. Summed from every party row the server sent,
  // never from filteredItems, so the footer always matches the rows above it.
  const partyTotals = useMemo(() => {
    const result: Record<RealMetricKey, number> = { cartonWastage: 0, pcsWastage: 0, looseOil: 0 };
    for (const p of parties) {
      for (const key of METRIC_ORDER) result[key] += p[key];
    }
    return result;
  }, [parties]);

  // Real parties only — the "no party recorded" row is not a party.
  const namedPartyCount = useMemo(
    () => parties.filter((p) => p.partyCd !== null || p.partyNm !== null).length,
    [parties],
  );

  const isLoading = loadState === 'loading';
  const isError = loadState === 'error';
  const isEmpty = loadState === 'loaded' && filteredItems.length === 0;
  const isFilteredEmpty = isEmpty && items.length > 0;
  const isAllMetrics = metric === 'all';
  // Printing is offered once the grid has loaded and at least one row is
  // visible. WastagePrintSheet drops lines with no wastage in the month on
  // its own, so "Active only" doesn't change the printout; the search and
  // the metric switch do.
  const canPrint = loadState === 'loaded' && filteredItems.length > 0;
  const showPartyTable = !isError && (isLoading || parties.length > 0);

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
            Wastage Register
          </span>
          <span className="h-px w-8 bg-zinc-300 block" />
          <span className="text-[10px] font-mono text-zinc-400">
            {MONTHS[selectedMonthIdx].name} {selectedYear}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Wastage</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              disabled={!canPrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:text-zinc-600"
              aria-label="Print wastage register"
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
                    needs the <code className="font-mono">/wastage/monthly-history</code> endpoint —
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

        <MetricToggle metric={metric} onChange={setMetric} />

        <SearchField value={search} onChange={setSearch} />

        <ActiveOnlyToggle checked={activeOnly} onChange={setActiveOnly} />

        <AnimatePresence>
          {!isLoading && !isError && filteredItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-xs font-mono text-zinc-500 self-end"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
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
                  className={`sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 py-3 text-center text-[10px] font-mono font-normal text-zinc-400 ${
                    isAllMetrics ? 'min-w-[70px] w-[70px]' : 'min-w-[44px] w-11'
                  }`}
                >
                  {day}
                </th>
              ))}

              {isAllMetrics ? (
                METRIC_ORDER.map((key) => {
                  const { shortLabel, colorClass } = METRICS[key];
                  const position = METRIC_ORDER.indexOf(key as RealMetricKey);
                  const isOutermost = position === METRIC_ORDER.length - 1;
                  // Three sticky columns stack side by side at the right
                  // edge. Only the true outermost column can use the
                  // right-0 utility class — Tailwind's right-0 sets
                  // `right: 0px` via the stylesheet, and an inline
                  // `style={{ right: undefined }}` does NOT cancel an
                  // active class rule (it just omits that inline
                  // property), so giving every column the same right-0
                  // class and only conditionally setting an inline
                  // override left all three stacked on top of each other.
                  // Every non-outermost column instead gets an explicit
                  // pixel offset — position 0 sits ALL_METRIC_COL_WIDTH*2
                  // out from the edge, position 1 sits *1 out, position 2
                  // (outermost) uses the class and sits flush at 0.
                  const offsetPx = (METRIC_ORDER.length - 1 - position) * ALL_METRIC_COL_WIDTH;
                  return (
                    <th
                      key={key}
                      className={`sticky top-0 z-20 bg-zinc-50 border-b border-l border-zinc-200 px-3 py-3 text-[10px] font-medium tracking-widest uppercase whitespace-nowrap text-center ${TEXT_600[colorClass]} ${isOutermost ? 'right-0' : ''}`}
                      style={isOutermost ? undefined : { right: offsetPx }}
                    >
                      {shortLabel}
                    </th>
                  );
                })
              ) : (
                <th className={`sticky right-0 top-0 z-20 bg-zinc-50 border-b border-l border-zinc-200 px-4 py-3 text-[10px] font-medium tracking-widest uppercase whitespace-nowrap text-center ${TEXT_600[METRICS[metric as RealMetricKey].colorClass]} shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.08)]`}>
                  Total
                </th>
              )}
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
                    {(isAllMetrics ? METRIC_ORDER : [metric]).map((k) => (
                      <td key={k} className="sticky right-0 bg-white px-3 py-3 border-l border-zinc-100">
                        <div className="h-3 w-8 rounded bg-zinc-100 animate-pulse mx-auto" />
                      </td>
                    ))}
                  </motion.tr>
                ))
              ) : isError ? null : (
                filteredItems.map((row, index) => {
                  // rowMax is computed per metric being shown, since each
                  // metric has its own scale — a rose intensity computed
                  // from cartons has no relationship to the oil column's
                  // own busiest day.
                  const rowMaxFor = (key: RealMetricKey) =>
                    Math.max(0, ...row[key].days.filter((v): v is number => v !== null));

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

                      {Array.from({ length: daysInMonth }, (_, dayIndex) => {
                        if (isAllMetrics) {
                          // Stacked compact cell: one short line per metric,
                          // each in its own color, "—" for metrics with no
                          // value that day. This is deliberately terser
                          // than the single-metric cell (no colored pill
                          // background per line) since three of them have
                          // to fit in one grid cell without the row
                          // exploding in height.
                          return (
                            <td key={dayIndex} className="py-2 px-1 text-center">
                              <div className="flex flex-col items-center gap-0.5 leading-none">
                                {METRIC_ORDER.map((key) => {
                                  const value = row[key].days[dayIndex];
                                  const { colorClass, shortLabel } = METRICS[key];
                                  return (
                                    <span
                                      key={key}
                                      title={`${row.itmnm} — ${METRICS[key].label}, day ${dayIndex + 1}: ${value === null ? 'no entry' : formatQty(value)}`}
                                      className={`font-mono text-[9px] whitespace-nowrap ${
                                        value === null ? 'text-zinc-300' : `${TEXT_600[colorClass]} font-medium`
                                      }`}
                                    >
                                      {shortLabel[0]}·{value === null ? '—' : formatQty(value)}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        }

                        const value = row[metric as RealMetricKey].days[dayIndex];
                        if (value === null) {
                          return (
                            <td key={dayIndex} className="py-2.5 px-0 text-center">
                              <span className="inline-flex items-center justify-center min-w-[34px] h-[22px] px-1 rounded text-[9px] font-mono font-medium mx-auto text-zinc-300">
                                —
                              </span>
                            </td>
                          );
                        }
                        const { bg, text } = intensityClasses(value, rowMaxFor(metric as RealMetricKey), METRICS[metric as RealMetricKey].colorClass);
                        return (
                          <td key={dayIndex} className="py-2.5 px-0 text-center">
                            <span
                              title={`${row.itmnm} — day ${dayIndex + 1}: ${formatQty(value)} ${METRICS[metric as RealMetricKey].unit}`}
                              className={`inline-flex min-w-[34px] h-[22px] items-center justify-center rounded px-1 mx-auto whitespace-nowrap text-[10px] font-mono font-medium ${bg} ${text}`}
                            >
                              {formatQty(value)}
                            </span>
                          </td>
                        );
                      })}

                      {isAllMetrics ? (
                        METRIC_ORDER.map((key) => {
                          const { colorClass } = METRICS[key];
                          const position = METRIC_ORDER.indexOf(key);
                          const isOutermost = position === METRIC_ORDER.length - 1;
                          const offsetPx = (METRIC_ORDER.length - 1 - position) * ALL_METRIC_COL_WIDTH;
                          return (
                            <td
                              key={key}
                              className={`sticky z-10 px-3 py-2.5 text-center font-mono text-[12px] font-medium ${TEXT_600[colorClass]} border-l border-zinc-200 bg-zinc-50/95 group-hover:bg-zinc-100/95 transition-colors ${isOutermost ? 'right-0' : ''}`}
                              style={isOutermost ? undefined : { right: offsetPx }}
                            >
                              {formatQty(row[key].total)}
                            </td>
                          );
                        })
                      ) : (
                        <td className={`sticky right-0 z-10 px-4 py-2.5 text-center font-mono text-[13px] font-medium ${TEXT_600[METRICS[metric as RealMetricKey].colorClass]} border-l border-zinc-200 bg-zinc-50/95 group-hover:bg-zinc-100/95 transition-colors shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.06)]`}>
                          {formatQty(row[metric as RealMetricKey].total)}
                        </td>
                      )}
                    </motion.tr>
                  );
                })
              )}
            </AnimatePresence>
          </tbody>

          {/* Footer — plant-wide total per day, pinned to the bottom same
              as FillingRegister.tsx. In "All 3" mode this becomes three
              stacked mini-rows worth of totals per day instead of one
              number, following the same stacking approach as the body
              cells above it. */}
          {!isLoading && !isError && filteredItems.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-20 border-t-2 border-zinc-200 bg-zinc-100 shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.08)]">
                <td className="sticky left-0 z-30 bg-zinc-100 border-r border-zinc-200 px-5 py-2.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500 whitespace-nowrap">
                  Day total
                </td>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <td key={i} className="py-2 px-1 text-center">
                    {isAllMetrics ? (
                      <div className="flex flex-col items-center gap-0.5 leading-none">
                        {METRIC_ORDER.map((key) => {
                          const total = dayTotalsByMetric[key][i];
                          return (
                            <span key={key} className="font-mono text-[9px] text-zinc-500 whitespace-nowrap">
                              {METRICS[key].shortLabel[0]}·{total > 0 ? formatQty(total) : '—'}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] text-zinc-500">
                        {dayTotalsByMetric[metric as RealMetricKey][i] > 0
                          ? formatQty(dayTotalsByMetric[metric as RealMetricKey][i])
                          : '—'}
                      </span>
                    )}
                  </td>
                ))}
                {isAllMetrics ? (
                  METRIC_ORDER.map((key) => {
                    const position = METRIC_ORDER.indexOf(key);
                    const isOutermost = position === METRIC_ORDER.length - 1;
                    const offsetPx = (METRIC_ORDER.length - 1 - position) * ALL_METRIC_COL_WIDTH;
                    return (
                      <td
                        key={key}
                        className={`sticky z-30 px-3 py-2.5 text-center font-mono text-[12px] font-semibold text-zinc-800 border-l border-zinc-200 bg-zinc-100 ${isOutermost ? 'right-0' : ''}`}
                        style={isOutermost ? undefined : { right: offsetPx }}
                      >
                        {formatQty(grandTotalsByMetric[key])}
                      </td>
                    );
                  })
                ) : (
                  <td className="sticky right-0 z-30 px-4 py-2.5 text-center font-mono text-[13px] font-semibold text-zinc-800 border-l border-zinc-200 bg-zinc-100 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.08)]">
                    {formatQty(grandTotalsByMetric[metric as RealMetricKey])}
                  </td>
                )}
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
              {isFilteredEmpty ? 'Nothing matches these filters' : 'No wastage recorded this month'}
            </p>
            <p className="text-xs text-zinc-300">
              {isFilteredEmpty
                ? 'Clear the search or turn off "Active only" to see everything.'
                : 'No wastage entries were found for this month.'}
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
            {isAllMetrics ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                {METRIC_ORDER.map((key) => {
                  const { label, shortLabel, unit, colorClass } = METRICS[key];
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${CHIP_BG_100[colorClass]} text-[8px] font-mono font-semibold ${CHIP_TEXT_700[colorClass]}`}>
                        {shortLabel[0]}
                      </span>
                      {label} ({unit})
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span>Low</span>
                {COLOR_SCALES[METRICS[metric as RealMetricKey].colorClass].map((step, i) => (
                  <span key={i} className={`inline-block h-3 w-3 rounded-sm ${step.bg}`} />
                ))}
                <span>High</span>
                <span className="ml-1">— relative to that item's busiest day this month, in {METRICS[metric as RealMetricKey].unit}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-medium text-zinc-300">—</span>
              No entry that day
            </div>
            <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-zinc-400">
              Wastage register · Connected to {getApiBaseUrl()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Party-wise summary — each packing party's wastage for the month, all
          three metrics side by side. It comes from the same response as the
          grid but is not narrowed by it: the search above filters items, not
          the parties' month totals. Entries saved without a party sit in the
          last row so the footer still adds up to everything recorded. */}
      {showPartyTable && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 w-full max-w-4xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900">Party-wise wastage</h2>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                {MONTHS[selectedMonthIdx].name} {selectedYear} · all items
                {search.trim() && ' · the search above does not apply here'}
              </p>
            </div>
            {!isLoading && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-mono text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                {namedPartyCount} part{namedPartyCount === 1 ? 'y' : 'ies'}
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50">
                  <th className="border-b border-zinc-100 px-5 py-3 text-left text-[10px] font-medium tracking-widest uppercase text-zinc-400">
                    Party
                  </th>
                  {METRIC_ORDER.map((key) => (
                    <th
                      key={key}
                      className={`border-b border-l border-zinc-100 px-5 py-3 text-right text-[10px] font-medium tracking-widest uppercase whitespace-nowrap ${TEXT_600[METRICS[key].colorClass]}`}
                    >
                      {METRICS[key].label}
                      <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-normal text-zinc-300">
                        {METRICS[key].unit}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`psk-${i}`} className="border-b border-zinc-50">
                        <td className="px-5 py-3">
                          <div className="h-3 rounded bg-zinc-100 animate-pulse" style={{ width: 120 + (i % 3) * 36 }} />
                        </td>
                        {METRIC_ORDER.map((key) => (
                          <td key={key} className="border-l border-zinc-50 px-5 py-3">
                            <div className="ml-auto h-3 w-10 rounded bg-zinc-100 animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : parties.map((p, index) => {
                      const noParty = p.partyCd === null && p.partyNm === null;
                      return (
                        <motion.tr
                          key={`${p.partyCd ?? ''}|${p.partyNm ?? ''}`}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25, delay: index * 0.015, ease: [0.16, 1, 0.3, 1] }}
                          className="border-b border-zinc-50 hover:bg-zinc-50/80 transition-colors"
                        >
                          <td className="px-5 py-2.5">
                            {noParty ? (
                              <div className="text-[13px] italic text-zinc-400">No party recorded</div>
                            ) : (
                              <>
                                <div className="text-[13px] font-medium text-zinc-800">{p.partyNm ?? p.partyCd}</div>
                                {p.partyNm && p.partyCd && (
                                  <div className="font-mono text-[10px] text-zinc-400">{p.partyCd}</div>
                                )}
                              </>
                            )}
                          </td>
                          {METRIC_ORDER.map((key) => {
                            const value = p[key];
                            return (
                              <td
                                key={key}
                                className={`border-l border-zinc-50 px-5 py-2.5 text-right font-mono text-[13px] ${
                                  value > 0 ? `${TEXT_600[METRICS[key].colorClass]} font-medium` : 'text-zinc-300'
                                }`}
                              >
                                {value > 0 ? formatQty(value) : '—'}
                              </td>
                            );
                          })}
                        </motion.tr>
                      );
                    })}
              </tbody>

              {!isLoading && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-200 bg-zinc-100">
                    <td className="px-5 py-2.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      Total
                    </td>
                    {METRIC_ORDER.map((key) => (
                      <td
                        key={key}
                        className="border-l border-zinc-200 px-5 py-2.5 text-right font-mono text-[13px] font-semibold text-zinc-800"
                      >
                        {formatQty(partyTotals[key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </motion.section>
      )}

      {/* Print sheet — portaled into <body>, hidden on screen, and shown on
          its own when printing (see WastagePrint.tsx). It prints the grid for
          the metric chosen above plus the party-wise summary. Mounted only
          when there is something to print, the same gate as the Print button. */}
      {canPrint && (
        <WastagePrintSheet
          items={filteredItems}
          parties={parties}
          metric={metric}
          year={selectedYear}
          monthIdx0={selectedMonthIdx}
          daysInMonth={daysInMonth}
          search={search.trim()}
        />
      )}
    </div>
  );
}