import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, AlertTriangle, X, DoorOpen, CalendarDays, User, Phone, Car, Printer } from 'lucide-react';
import { apiUrl, API_BASE_URL } from './Auth/apiconfig';
import GateReportPrint from './GateReportPrint';

// ════════════════════════════════════════════════════════════════════════
// Gate Register — who is inside the factory right now, plus the full gate
// log for any date range.
//
// Sibling to FillingRegister.tsx: same page chrome (zinc palette, font-mono
// for data, sticky table header, motion timing, error banner), but one row
// per gate entry instead of per item/day.
//
// Two views share one table:
//   • Inside now — GET /gate/active: entries with no exit marked yet.
//   • Entry log  — GET /gate/history?from=YYYY-MM-DD&to=YYYY-MM-DD: every
//     entry in the range, exited or not. The server reads the range as IST
//     calendar days, so the pickers and every time shown here are IST too.
//
// The Entry log can be printed as a formal A4 statement (Print report button
// or Ctrl+P) — see GateReportPrint.tsx. "Inside now" is a live snapshot, so
// it is deliberately not printable.
//
// Photos are loaded from <API base>/uploads/<PHOTO> — the same path the
// mobile gate screen uses. See photoUrl() if your server serves them
// somewhere else.
// ════════════════════════════════════════════════════════════════════════

// ─── Types ─────────────────────────────────────────────────────────────

type Mode = 'inside' | 'log';
type LoadState = 'loading' | 'loaded' | 'error';

interface GateRecord {
  LOG_ID: string;
  // EMPLOYEE | VISITOR. Rows logged before that change may still say PERSON | VEHICLE.
  ENTRY_TYPE: string;
  NAME: string;
  PERSON_TO_MEET: string | null;
  MOBILE: string | null;
  VEHICLE_NO: string | null;
  PURPOSE: string;
  PHOTO: string | null;
  ENTRY_AT: string;
  EXIT_AT: string | null;
  LOGGED_BY: string;
  loggedBy?: { EMPNAME: string } | null;
  exitLoggedBy?: { EMPNAME: string } | null; // only on /gate/history
}

interface GateListResponse {
  success: boolean;
  message?: string;
  data?: GateRecord[];
}

// ─── API client ────────────────────────────────────────────────────────

async function fetchGateRecords(path: string): Promise<GateRecord[]> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path));
  } catch {
    throw new Error('Could not reach the server');
  }
  // Read the body even on a non-2xx so the server's own message (e.g. the
  // date-range limit) reaches the banner instead of a bare status code.
  const json = (await res.json().catch(() => null)) as GateListResponse | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.message ?? `Server responded ${res.status}`);
  }
  return Array.isArray(json.data) ? json.data : [];
}

// PHOTO is stored as a path under the uploads folder, e.g. "visitors/abc.jpg"
// (with backslashes if the server runs on Windows). Served at
// <API base>/uploads/<PHOTO>, like the mobile gate screen. If your server
// exposes uploads somewhere else, this is the one place to change.
function photoUrl(photo: string | null | undefined): string | null {
  if (!photo) return null;

  const origin = API_BASE_URL.replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  const normalized = photo.replace(/\\/g, "/").replace(/^\/+/, "");

  return `${origin}/uploads/${normalized}`;
}

// ─── Dates & formatting ─────────────────────────────────────────────────

const PAGE_SIZE = 100;
const MIN_DATE = '2000-01-01';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// The server draws every day boundary in IST, so the pickers do too — a
// browser in another timezone can't end up asking for a different "today".
const todayIst = (): string => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
});
const dayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
});
const pickerDayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
});

const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
const fmtDay = (iso: string) => dayFmt.format(new Date(iso));

// 'YYYY-MM-DD' (from a date input) → "05 Oct 2026". Falls back to the raw
// string while the input is half-typed.
function fmtPickerDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : pickerDayFmt.format(d);
}

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

// ─── Small presentational atoms ─────────────────────────────────────────

const MODES: { id: Mode; label: string; icon: typeof DoorOpen }[] = [
  { id: 'inside', label: 'Inside now', icon: DoorOpen },
  { id: 'log', label: 'Entry log', icon: CalendarDays },
];

function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">View</span>
      <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
        {MODES.map(({ id, label, icon: Icon }) => {
          const active = value === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-[7px] text-[12px] font-medium transition-colors ${
                active ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateField({
  label, value, min, max, onChange,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="w-40 cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-800 transition-all hover:border-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900"
      />
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  const visitor = type === 'VISITOR';
  return (
    <span
      className={`mt-1 inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider ${
        visitor
          ? 'border-indigo-100 bg-indigo-50 text-indigo-600'
          : 'border-zinc-200 bg-zinc-100 text-zinc-500'
      }`}
    >
      {type}
    </span>
  );
}

function PhotoThumb({
  photo, name, onOpen,
}: {
  photo: string | null;
  name: string;
  onOpen: (src: string) => void;
}) {
  // A wrong uploads path or a deleted file shouldn't leave a broken-image icon.
  const [failed, setFailed] = useState(false);

  if (!photo || failed) {
    return (
      <div
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-300"
        title={photo ? 'Photo unavailable' : 'No photo'}
      >
        <User size={16} />
      </div>
    );
  }

  const src = photoUrl(photo);
  return (
    <button
      type="button"
      onClick={() => onOpen(src!)}
      aria-label={`View photo of ${name}`}
      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
    >
      <img
        src={src!}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-11 w-11 rounded-lg border border-zinc-200 bg-zinc-100 object-cover transition-opacity hover:opacity-80"
      />
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────

export default function GateRegister() {
  const [mode, setMode] = useState<Mode>('inside');
  const [from, setFrom] = useState<string>(todayIst);
  const [to, setTo] = useState<string>(todayIst);

  const [records, setRecords] = useState<GateRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);

  // Ticks once a minute so durations keep counting while the page sits open.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Why the log can't be fetched yet (null = it can). Checked here instead of
  // clamping inside the change handlers, so typing a date by keyboard is never
  // overwritten halfway through.
  const rangeProblem: string | null =
    mode !== 'log'
      ? null
      : !from || !to || from < MIN_DATE || to < MIN_DATE
        ? 'Pick both a From and a To date.'
        : from > to
          ? 'The From date is after the To date.'
          : null;

  const path = mode === 'inside' ? '/gate/active' : `/gate/history?from=${from}&to=${to}`;

  // Responses can land out of order when the dates change quickly; only the
  // most recent request is allowed to write state.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (rangeProblem) return;
    const id = ++requestId.current;
    setLoadState('loading');
    setErrorMessage('');
    try {
      const data = await fetchGateRecords(path);
      if (id !== requestId.current) return;
      setRecords(data);
      setVisibleCount(PAGE_SIZE);
      setNow(Date.now());
      setLoadState('loaded');
    } catch (err) {
      if (id !== requestId.current) return;
      setLoadState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [path, rangeProblem]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes the photo preview.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const isLoading = !rangeProblem && loadState === 'loading';
  const isError = !rangeProblem && loadState === 'error';
  const isEmpty = !rangeProblem && loadState === 'loaded' && records.length === 0;
  const hasRows = !rangeProblem && loadState === 'loaded' && records.length > 0;
  const showExit = mode === 'log';
  // Only the entry log prints. The statement is mounted just while there is a
  // loaded log to print, so Ctrl+P on any other screen (inside now, loading,
  // error, invalid or empty range) prints the normal page instead.
  const canPrint = mode === 'log' && hasRows;

  const visibleRecords = records.slice(0, visibleCount);
  const maxDate = todayIst();
  const rangeLabel =
    from === to ? fmtPickerDay(from) : `${fmtPickerDay(from)} – ${fmtPickerDay(to)}`;

  const columns = useMemo(
    () => [
      { key: 'photo', label: 'Photo' },
      { key: 'name', label: 'Name' },
      { key: 'meet', label: 'To meet' },
      { key: 'purpose', label: 'Purpose' },
      { key: 'contact', label: 'Contact' },
      { key: 'entered', label: 'Entered' },
      ...(mode === 'log' ? [{ key: 'exited', label: 'Exited' }] : []),
      { key: 'duration', label: mode === 'inside' ? 'Inside for' : 'Duration' },
      { key: 'guard', label: 'Logged by' },
    ],
    [mode],
  );

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
            Gate Register
          </span>
          <span className="h-px w-8 bg-zinc-300 block" />
          <span className="text-[10px] font-mono text-zinc-400">
            {mode === 'inside' ? 'Inside now' : rangeProblem ? 'Select a range' : rangeLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Gate Log</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
              aria-label="Refresh" title="Refresh"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
            {/* Entry log only: "Inside now" is a live snapshot, not a record of a period. */}
            {mode === 'log' && (
              <button
                onClick={() => window.print()}
                disabled={!canPrint}
                title={canPrint ? 'Print this entry log' : 'Nothing to print yet'}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer size={14} />
                Print report
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Error notice */}
      <AnimatePresence>
        {isError && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm shadow-sm"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" />
            <div className="flex-1">
              <p className="font-medium text-zinc-800">Couldn't load the gate log</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {errorMessage}. If this keeps happening, confirm the server is running and CORS allows
                this origin.
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
        <ModeSwitch value={mode} onChange={setMode} />

        {mode === 'log' && (
          <>
            <DateField label="From" value={from} min={MIN_DATE} max={to || maxDate} onChange={setFrom} />
            <DateField label="To" value={to} min={from || MIN_DATE} max={maxDate} onChange={setTo} />
          </>
        )}

        <AnimatePresence>
          {hasRows && (
            <motion.div
              key="count"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-xs font-mono text-zinc-500 self-end"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {mode === 'inside'
                ? `${records.length} inside`
                : `${records.length} ${records.length === 1 ? 'entry' : 'entries'}`}
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
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 py-3 pr-4 text-left text-[10px] font-medium tracking-widest uppercase text-zinc-400 whitespace-nowrap ${
                    i === 0 ? 'pl-5' : 'pl-4'
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <motion.tr
                  key={`sk-${i}`}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-zinc-50"
                >
                  {columns.map((c, j) => (
                    <td key={c.key} className={j === 0 ? 'pl-5 pr-4 py-2.5' : 'px-4 py-2.5'}>
                      {c.key === 'photo' ? (
                        <div className="h-11 w-11 rounded-lg bg-zinc-100 animate-pulse" />
                      ) : (
                        <div
                          className="h-3 rounded bg-zinc-100 animate-pulse"
                          style={{ width: 56 + ((i + j) % 4) * 20 }}
                        />
                      )}
                    </td>
                  ))}
                </motion.tr>
              ))
            ) : hasRows ? (
              visibleRecords.map((row, index) => {
                const endMs = row.EXIT_AT ? new Date(row.EXIT_AT).getTime() : now;
                const durationMs = endMs - new Date(row.ENTRY_AT).getTime();
                return (
                  <motion.tr
                    key={row.LOG_ID}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.015, ease: [0.16, 1, 0.3, 1] }}
                    className="border-b border-zinc-50 hover:bg-zinc-50/80 transition-colors"
                  >
                    <td className="pl-5 pr-4 py-2.5">
                      <PhotoThumb
                        photo={row.PHOTO}
                        name={row.NAME}
                        onOpen={(src) => setPreview({ src, name: row.NAME })}
                      />
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="whitespace-nowrap text-[13px] font-medium text-zinc-800">{row.NAME}</div>
                      <TypeChip type={row.ENTRY_TYPE} />
                    </td>

                    <td className="px-4 py-2.5 whitespace-nowrap text-[13px] text-zinc-700">
                      {row.PERSON_TO_MEET || <span className="text-zinc-300">—</span>}
                    </td>

                    <td className="px-4 py-2.5 min-w-[180px] max-w-[280px] break-words text-[12px] text-zinc-600">
                      {row.PURPOSE}
                    </td>

                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {row.MOBILE || row.VEHICLE_NO ? (
                        <div className="flex flex-col gap-0.5 font-mono text-[11px] text-zinc-600">
                          {row.MOBILE && (
                            <span className="inline-flex items-center gap-1.5">
                              <Phone size={11} className="text-zinc-300" />
                              {row.MOBILE}
                            </span>
                          )}
                          {row.VEHICLE_NO && (
                            <span className="inline-flex items-center gap-1.5">
                              <Car size={11} className="text-zinc-300" />
                              {row.VEHICLE_NO}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-mono text-[13px] text-zinc-800">{fmtTime(row.ENTRY_AT)}</div>
                      <div className="text-[10px] text-zinc-400">{fmtDay(row.ENTRY_AT)}</div>
                    </td>

                    {showExit && (
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {row.EXIT_AT ? (
                          <>
                            <div className="font-mono text-[13px] text-zinc-800">{fmtTime(row.EXIT_AT)}</div>
                            <div className="text-[10px] text-zinc-400">{fmtDay(row.EXIT_AT)}</div>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-600">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Inside
                          </span>
                        )}
                      </td>
                    )}

                    <td
                      className={`px-4 py-2.5 whitespace-nowrap font-mono text-[12px] ${
                        row.EXIT_AT ? 'text-zinc-600' : 'text-emerald-600'
                      }`}
                    >
                      {formatDuration(durationMs)}
                    </td>

                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="text-[12px] text-zinc-700">{row.loggedBy?.EMPNAME ?? '—'}</div>
                      {showExit && row.exitLoggedBy?.EMPNAME && (
                        <div className="text-[10px] text-zinc-400">Exit: {row.exitLoggedBy.EMPNAME}</div>
                      )}
                    </td>
                  </motion.tr>
                );
              })
            ) : null}
          </tbody>
        </table>

        {/* Empty / invalid-range state */}
        {(isEmpty || rangeProblem) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 gap-2"
          >
            {rangeProblem ? (
              <CalendarDays size={24} strokeWidth={1.5} className="mb-2 text-zinc-300" />
            ) : (
              <DoorOpen size={24} strokeWidth={1.5} className="mb-2 text-zinc-300" />
            )}
            <p className="text-sm font-medium text-zinc-400">
              {rangeProblem
                ? rangeProblem
                : mode === 'inside'
                  ? 'No one is inside right now'
                  : 'No entries in this date range'}
            </p>
            <p className="text-xs text-zinc-300">
              {rangeProblem
                ? 'Entries load as soon as the range is valid.'
                : mode === 'inside'
                  ? 'Everyone who came in has been marked as exited.'
                  : 'Try a different range.'}
            </p>
          </motion.div>
        )}

        {/* Long logs render in chunks so a wide range doesn't mean thousands of rows at once */}
        {hasRows && records.length > visibleCount && (
          <div className="flex items-center justify-center gap-3 border-t border-zinc-100 px-4 py-3">
            <span className="font-mono text-[11px] text-zinc-400">
              Showing {visibleCount} of {records.length}
            </span>
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900"
            >
              Show {Math.min(PAGE_SIZE, records.length - visibleCount)} more
            </button>
          </div>
        )}
      </motion.div>

      {/* Footer */}
      <AnimatePresence>
        {hasRows && (
          <motion.div
            key="footer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-4 flex justify-end"
          >
            <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">
              Gate register · times in IST · Connected to {API_BASE_URL}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo preview — portaled so no transformed ancestor can offset the overlay */}
      {createPortal(
        <AnimatePresence>
          {preview && (
            <motion.div
              key="photo-preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setPreview(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/70 p-6 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={`Photo of ${preview.name}`}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl"
              >
                <img
                  src={preview.src}
                  alt={`Photo of ${preview.name}`}
                  className="max-h-[75vh] w-full bg-zinc-100 object-contain"
                />
                <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2.5">
                  <span className="truncate text-[13px] font-medium text-zinc-800">{preview.name}</span>
                  <button
                    onClick={() => setPreview(null)}
                    className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="Close photo"
                  >
                    <X size={15} />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Print-only statement (Entry log only). Gets every record, not just the
          visible page of rows, and mounts only while there is a log to print. */}
      {canPrint && <GateReportPrint fromKey={from} toKey={to} records={records} />}
    </div>
  );
}