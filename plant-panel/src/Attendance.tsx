import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, RefreshCw, AlertTriangle, X, ImageOff, Clock, UserCircle2 } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════
//
// This page is deliberately API-only: there is no demo/sample data mode.
// If VITE_API_URL is missing, or either request fails, the page shows a
// clear error state and nothing else — never silently substituted data.

type EmpType = 'INDIVIDUAL' | 'SUPERVISOR';
type Shift = 'DAY' | 'NIGHT';
type OtStatus = 'OT' | 'HALF_OT' | 'NO_OT';

interface Employee {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: EmpType;
}

interface AttendanceRecord {
  EMP_ID: string;
  CREATEDAT: string;
  STATUS: 'P' | 'A';
  SHIFT: Shift | null;
  MARKED_BY?: string | null;
  OT_STATUS?: OtStatus | null;
  // Relative path on disk, e.g. "attendance/EMP001_1782280311454.jpg".
  // Added for the photo modal — mirrors the field already on the Dashboard
  // page's AttendanceRecord type. The /attendance/month endpoint now
  // returns this (see the backend PHOTO-select patch applied alongside
  // the Dashboard's photo modal).
  PHOTO?: string | null;
}

interface GetAllEmployeesResponse {
  success: boolean;
  message?: string;
  data: Employee[];
}

interface GetMonthlyAttendanceResponse {
  data: AttendanceRecord[];
}

type LoadState = 'loading' | 'loaded' | 'error';

// ════════════════════════════════════════════════════════════════════════
// Time helpers — IST-anchored (same convention as the Dashboard page)
// ════════════════════════════════════════════════════════════════════════

const IST_TZ = 'Asia/Kolkata';

function getISTDateKey(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(d);
}

// function getTodayISTKey(): string {
//   return getISTDateKey(new Date());
// }

function formatISTTime(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleTimeString('en-IN', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatISTDateLong(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleDateString('en-IN', {
    timeZone: IST_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ════════════════════════════════════════════════════════════════════════
// Small utilities
// ════════════════════════════════════════════════════════════════════════

function initials(name: string = ''): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

// ════════════════════════════════════════════════════════════════════════
// API client — production-only, no demo fallback
// ════════════════════════════════════════════════════════════════════════

const RAW_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;
const BASE_URL = (RAW_BASE_URL ?? '').replace(/\/+$/, '');

function hasApiBaseUrl(): boolean {
  return BASE_URL.length > 0;
}

function getApiBaseUrl(): string {
  return BASE_URL;
}

async function getJson<T>(path: string): Promise<T> {
  if (!BASE_URL) throw new Error('VITE_API_URL is not configured');
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchAllEmployees(): Promise<Employee[]> {
  const json = await getJson<GetAllEmployeesResponse>('/employees');
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchMonthlyAttendance(year: number, month0: number): Promise<AttendanceRecord[]> {
  const json = await getJson<GetMonthlyAttendanceResponse>(`/attendance/month?month=${month0}&year=${year}`);
  return Array.isArray(json.data) ? json.data : [];
}

// Builds a full URL for anything stored under the server's /uploads root.
// Same join logic as the Dashboard page's buildFileUrl — the PHOTO field is
// a relative path like "attendance/EMP001_1782280311454.jpg", and the
// server serves everything under /uploads/<that path>.
function buildFileUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath || !BASE_URL) return null;
  const origin     = BASE_URL.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${origin}/uploads/${normalized}`;
}

// ════════════════════════════════════════════════════════════════════════
// Month metadata
// ════════════════════════════════════════════════════════════════════════

const MONTHS = [
  { name: 'January', days: 31 }, { name: 'February', days: 28 },
  { name: 'March', days: 31 },   { name: 'April', days: 30 },
  { name: 'May', days: 31 },     { name: 'June', days: 30 },
  { name: 'July', days: 31 },    { name: 'August', days: 31 },
  { name: 'September', days: 30 }, { name: 'October', days: 31 },
  { name: 'November', days: 30 }, { name: 'December', days: 31 },
];

function daysInMonth(monthIdx0: number, year: number): number {
  // Feb leap-year aware; the static table above is only used for display defaults.
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];

// ════════════════════════════════════════════════════════════════════════
// Per-employee, per-day shaped row for the grid
// ════════════════════════════════════════════════════════════════════════

interface DayCell {
  status: 'P' | 'A' | null; // null = no record for this shift this day (off/blank)
  otStatus: OtStatus | null;
  // Kept alongside the display fields so a cell click can open the modal
  // without having to re-look-up the record from date + emp + shift.
  record: AttendanceRecord | null;
}

interface EmployeeMonthRow {
  emp: Employee;
  cells: DayCell[];   // index 0 = day 1
  present: number;
  absent: number;
  daysMarked: number; // present + absent, i.e. days with an actual record
}

/**
 * Builds one row per employee for the given shift, deriving each day's cell
 * from that employee's attendance records filtered to the selected shift.
 * Missing days are left as `null` (off/blank) rather than counted absent,
 * matching the inspiration page's convention.
 */
function buildMonthRows(
  employees: Employee[],
  records: AttendanceRecord[],
  shift: Shift,
  monthIdx0: number,
  year: number
): EmployeeMonthRow[] {
  const totalDays = daysInMonth(monthIdx0, year);

  // Group shift-filtered records by EMP_ID → dateKey → record.
  // Two records can share EMP_ID on the same date (one DAY, one NIGHT); since
  // we filter by shift first, at most one should remain per employee per day.
  const byEmpThenDate = new Map<string, Map<string, AttendanceRecord>>();
  for (const r of records) {
    if (r.SHIFT !== shift) continue;
    const dateKey = getISTDateKey(r.CREATEDAT);
    if (!byEmpThenDate.has(r.EMP_ID)) byEmpThenDate.set(r.EMP_ID, new Map());
    byEmpThenDate.get(r.EMP_ID)!.set(dateKey, r);
  }

  return employees.map((emp) => {
    const byDate = byEmpThenDate.get(emp.EMP_ID);
    const cells: DayCell[] = [];
    let present = 0;
    let absent = 0;

    for (let day = 1; day <= totalDays; day++) {
      const dateKey = `${year}-${String(monthIdx0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const rec = byDate?.get(dateKey);
      if (!rec) {
        cells.push({ status: null, otStatus: null, record: null });
        continue;
      }
      if (rec.STATUS === 'P') present += 1;
      else absent += 1;
      cells.push({
        status: rec.STATUS,
        // OT only means anything on a present day; ignore it on absent days
        // even if a stray value were ever set.
        otStatus: rec.STATUS === 'P' ? rec.OT_STATUS ?? null : null,
        record: rec,
      });
    }

    return { emp, cells, present, absent, daysMarked: present + absent };
  });
}

// OT_STATUS → single-letter suffix shown next to P (Full / Half / No OT).
const OT_LETTER: Record<OtStatus, string> = { OT: 'F', HALF_OT: 'H', NO_OT: 'N' };

function cellDisplay(cell: DayCell): string {
  if (cell.status === null) return '—';
  if (cell.status === 'A') return 'A';
  return cell.otStatus ? `P·${OT_LETTER[cell.otStatus]}` : 'P';
}

function cellVariant(cell: DayCell): 'present' | 'absent' | 'off' {
  if (cell.status === 'P') return 'present';
  if (cell.status === 'A') return 'absent';
  return 'off';
}

// ════════════════════════════════════════════════════════════════════════
// Attendance photo modal
// ════════════════════════════════════════════════════════════════════════
//
// Opened by clicking a PRESENT day cell in the grid. Shows the attendance
// photo (AttendanceRecord.PHOTO, e.g. "attendance/EMP001_1782280311454.jpg")
// via the same buildFileUrl() join used elsewhere, plus the marked time and
// shift — the two other things that live on the same record and are the
// natural next things a supervisor wants to see next to the photo.
//
// This page has no EMPPROFILEPHOTO on its Employee type (unlike the
// Dashboard's), so the header falls back to initials only — there's no
// profile-photo avatar to show here.

interface PhotoModalState {
  employee: Employee;
  record: AttendanceRecord;
  shiftLabel: 'Day' | 'Night';
  dateKey: string; // the specific calendar day this cell belongs to
}

const SHIFT_MODAL_ACCENT: Record<'Day' | 'Night', { icon: typeof Sun; text: string; bg: string; border: string }> = {
  Day:   { icon: Sun,  text: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100'  },
  Night: { icon: Moon, text: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
};

function PhotoModal({
  state,
  onClose,
}: {
  state: PhotoModalState | null;
  onClose: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Reset the broken-image flag whenever a different record is opened,
  // otherwise a previous failure would stick around for the next photo.
  useEffect(() => {
    setImgFailed(false);
  }, [state?.record.PHOTO]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, onClose]);

  if (!state) return null;

  const { employee, record, shiftLabel, dateKey } = state;
  const photoUrl = buildFileUrl(record.PHOTO);
  const { icon: ShiftIcon, text: shiftText, bg: shiftBg, border: shiftBorder } = SHIFT_MODAL_ACCENT[shiftLabel];
  const isSelfMarked = !record.MARKED_BY || record.MARKED_BY === record.EMP_ID;

  return (
    <AnimatePresence>
      <motion.div
        key="photo-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label={`Attendance photo for ${employee.EMPNAME} ${employee.EMPFNAME}, ${shiftLabel.toLowerCase()} shift`}
      >
        <motion.div
          key="photo-modal-panel"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-[11px] font-semibold text-zinc-600">
                {initials(`${employee.EMPNAME} ${employee.EMPFNAME}`)}
              </div>
              <div>
                <div className="text-[13px] font-medium leading-tight text-zinc-800">
                  {employee.EMPNAME} {employee.EMPFNAME}
                </div>
                <div className="text-[11px] leading-tight text-zinc-400">{employee.EMPDESG}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Date row — the grid spans a whole month, so the header alone
              doesn't tell you which day this photo is from */}
          <div className="border-b border-zinc-100 bg-zinc-50/60 px-5 py-2">
            <span className="font-mono text-[11px] text-zinc-500">{formatISTDateLong(dateKey)}</span>
          </div>

          {/* Photo */}
          <div className="flex aspect-square items-center justify-center bg-zinc-50">
            {photoUrl && !imgFailed ? (
              <img
                src={photoUrl}
                alt={`${employee.EMPNAME} ${employee.EMPFNAME} — ${shiftLabel} shift attendance photo`}
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 text-center">
                <ImageOff size={22} className="text-zinc-300" />
                <p className="text-[11px] text-zinc-400">
                  {!record.PHOTO
                    ? 'No photo was captured for this attendance mark.'
                    : "Photo couldn't be loaded."}
                </p>
              </div>
            )}
          </div>

          {/* Details — shift + time */}
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${shiftBg} ${shiftText} ${shiftBorder}`}>
              <ShiftIcon size={12} strokeWidth={2.5} />
              {shiftLabel} shift
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-zinc-500">
              <Clock size={12} className="text-zinc-400" />
              {formatISTTime(record.CREATEDAT)} IST
            </span>
          </div>

          {/* Marked-by footer — only worth showing when it's not a self-mark.
              This page doesn't have an employeesById map to resolve
              MARKED_BY into a name (unlike the Dashboard), so it shows the
              raw ID — still useful context, just less pretty. */}
          {!isSelfMarked && (
            <div className="flex items-center gap-1.5 border-t border-zinc-100 px-5 py-2.5 text-[11px] text-zinc-400">
              <UserCircle2 size={12} />
              Marked by {record.MARKED_BY}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Small presentational atoms
// ════════════════════════════════════════════════════════════════════════

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

function ShiftToggle({ shift, onChange }: { shift: Shift; onChange: (s: Shift) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Shift</span>
      <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
        <button
          onClick={() => onChange('DAY')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-mono font-medium transition-colors ${
            shift === 'DAY' ? 'bg-amber-50 text-amber-600' : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          <Sun size={13} /> Day
        </button>
        <button
          onClick={() => onChange('NIGHT')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-mono font-medium transition-colors ${
            shift === 'NIGHT' ? 'bg-indigo-50 text-indigo-600' : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          <Moon size={13} /> Night
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════

export default function Attendance() {
  const today = new Date();

  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(today.getMonth()); // 0-11
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [shift, setShift] = useState<Shift>('DAY');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // Which attendance photo (if any) is currently open in the modal.
  const [photoModal, setPhotoModal] = useState<PhotoModalState | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage('');

    if (!hasApiBaseUrl()) {
      setLoadState('error');
      setErrorMessage('VITE_API_URL is not configured');
      return;
    }

    try {
      const [empList, monthRecords] = await Promise.all([
        fetchAllEmployees(),
        fetchMonthlyAttendance(selectedYear, selectedMonthIdx),
      ]);
      setEmployees(empList);
      setRecords(monthRecords);
      setLoadState('loaded');
    } catch (err) {
      setLoadState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [selectedMonthIdx, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  const totalDays = useMemo(
    () => daysInMonth(selectedMonthIdx, selectedYear),
    [selectedMonthIdx, selectedYear]
  );

  const rows = useMemo(
    () => buildMonthRows(employees, records, shift, selectedMonthIdx, selectedYear),
    [employees, records, shift, selectedMonthIdx, selectedYear]
  );

  const isLoading = loadState === 'loading';
  const isError = loadState === 'error';
  const isEmpty = loadState === 'loaded' && rows.length === 0;

  const shiftLabel: 'Day' | 'Night' = shift === 'DAY' ? 'Day' : 'Night';

  const openPhotoModal = useCallback(
    (emp: Employee, cell: DayCell, dayIndex: number) => {
      if (!cell.record) return; // nothing to show for off/blank cells
      const dateKey = `${selectedYear}-${String(selectedMonthIdx + 1).padStart(2, '0')}-${String(dayIndex + 1).padStart(2, '0')}`;
      setPhotoModal({ employee: emp, record: cell.record, shiftLabel, dateKey });
    },
    [selectedYear, selectedMonthIdx, shiftLabel]
  );
  const closePhotoModal = useCallback(() => setPhotoModal(null), []);

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
            Attendance Register
          </span>
          <span className="h-px w-8 bg-zinc-300 block" />
          <span className="text-[10px] font-mono text-zinc-400">
            {MONTHS[selectedMonthIdx].name} {selectedYear}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Attendance</h1>
          <button
            onClick={load}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
            aria-label="Refresh" title="Refresh"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </motion.div>

      {/* Error notice — no demo-data fallback offered, this page is API-only */}
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
                    <code className="font-mono">VITE_API_URL</code> in your .env is correct.
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

        <ShiftToggle shift={shift} onChange={setShift} />

        <AnimatePresence>
          {!isLoading && !isError && rows.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-xs font-mono text-zinc-500 self-end"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {rows.length} employees
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-zinc-200 bg-white overflow-auto max-h-[56vh] shadow-sm"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#e4e4e7 transparent' }}
      >
        <table className="border-collapse min-w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-zinc-50 border-b border-r border-zinc-100 text-left px-5 py-3 text-[10px] font-medium tracking-widest uppercase text-zinc-400 min-w-[180px] whitespace-nowrap">
                Employee
              </th>

              {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => (
                <th
                  key={day}
                  className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 py-3 min-w-[36px] w-9 text-center text-[10px] font-mono font-normal text-zinc-400"
                >
                  {day}
                </th>
              ))}

              {[
                { label: 'Present', color: 'text-emerald-600' },
                { label: 'Days', color: 'text-zinc-500' },
                { label: 'Absent', color: 'text-rose-500' },
              ].map(({ label, color }) => (
                <th
                  key={label}
                  className={`sticky top-0 z-10 bg-zinc-50 border-b border-l border-zinc-100 px-4 py-3 text-[10px] font-medium tracking-widest uppercase whitespace-nowrap text-center ${color}`}
                >
                  {label}
                </th>
              ))}
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
                      <div className="h-3 rounded bg-zinc-100 animate-pulse" style={{ width: 90 + (i % 3) * 24 }} />
                    </td>
                    {Array.from({ length: totalDays }).map((_, j) => (
                      <td key={j} className="py-3 px-0 text-center">
                        <div className="h-3 w-3 rounded bg-zinc-100 animate-pulse mx-auto" />
                      </td>
                    ))}
                    {[0, 1, 2].map((k) => (
                      <td key={k} className="px-4 py-3 border-l border-zinc-50">
                        <div className="h-3 w-5 rounded bg-zinc-100 animate-pulse mx-auto" />
                      </td>
                    ))}
                  </motion.tr>
                ))
              ) : isError ? null : (
                rows.map((row, index) => (
                  <motion.tr
                    key={row.emp.EMP_ID}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: index * 0.015, ease: [0.16, 1, 0.3, 1] }}
                    className="border-b border-zinc-50 hover:bg-zinc-50/80 transition-colors group"
                  >
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-zinc-50/80 border-r border-zinc-100 px-5 py-2.5 transition-colors">
                      <div className="font-medium text-zinc-800 text-[13px] whitespace-nowrap">
                        {row.emp.EMPNAME} {row.emp.EMPFNAME}
                      </div>
                      <div className="text-[10px] text-zinc-400 whitespace-nowrap">{row.emp.EMPDESG}</div>
                    </td>

                    {row.cells.map((cell, dayIndex) => {
                      const variant = cellVariant(cell);
                      // Only present cells have a photo worth viewing.
                      const clickable = variant === 'present';
                      return (
                        <td key={dayIndex} className="py-2.5 px-0 text-center">
                          {clickable ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPhotoModal(row.emp, cell, dayIndex);
                              }}
                              title="View attendance photo"
                              className="inline-flex min-w-[26px] h-[22px] items-center justify-center rounded px-1 mx-auto whitespace-nowrap text-[9px] font-mono font-medium bg-emerald-50 text-emerald-600 transition-transform hover:scale-110 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1"
                            >
                              {cellDisplay(cell)}
                            </button>
                          ) : (
                            <span
                              className={`inline-flex items-center justify-center min-w-[26px] h-[22px] px-1 rounded text-[9px] font-mono font-medium mx-auto whitespace-nowrap
                                ${variant === 'absent' ? 'bg-rose-50 text-rose-500' : ''}
                                ${variant === 'off'    ? 'text-zinc-300' : ''}
                              `}
                            >
                              {cellDisplay(cell)}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-4 py-2.5 text-center font-mono text-[13px] font-medium text-emerald-600 border-l border-zinc-100 bg-zinc-50/50">
                      {row.present}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-[13px] text-zinc-400 bg-zinc-50/50">
                      {row.daysMarked}
                    </td>
                    <td className={`px-4 py-2.5 text-center font-mono text-[13px] border-l border-zinc-100 bg-zinc-50/50 ${row.absent > 0 ? 'text-rose-500 font-medium' : 'text-zinc-300'}`}>
                      {row.absent}
                    </td>
                  </motion.tr>
                ))
              )}
            </AnimatePresence>
          </tbody>
        </table>

        {/* Empty state — only when the load succeeded but returned nothing */}
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
            <p className="text-sm font-medium text-zinc-400">No records found</p>
            <p className="text-xs text-zinc-300">No employees returned for this month</p>
          </motion.div>
        )}
      </motion.div>

      {/* Legend */}
      <AnimatePresence>
        {!isLoading && !isError && rows.length > 0 && (
          <motion.div
            key="legend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-x-5 gap-y-2 mt-4"
          >
            {[
              { label: 'Present · tap to view photo', badge: 'P', bg: 'bg-emerald-50', text: 'text-emerald-600' },
              { label: 'Absent', badge: 'A', bg: 'bg-rose-50', text: 'text-rose-500' },
              { label: 'Off / no record', badge: '—', bg: 'bg-zinc-50', text: 'text-zinc-300' },
            ].map(({ label, badge, bg, text }) => (
              <div key={label} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-mono font-medium ${bg} ${text}`}>
                  {badge}
                </span>
                {label}
              </div>
            ))}
            <span className="mx-1 h-4 w-px bg-zinc-200 self-center" />
            {[
              { letter: 'F', label: 'Full OT' },
              { letter: 'H', label: 'Half OT' },
              { letter: 'N', label: 'No OT' },
            ].map(({ letter, label }) => (
              <div key={letter} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-50 text-amber-600 text-[9px] font-mono font-medium">
                  P·{letter}
                </span>
                {label}
              </div>
            ))}
            <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-zinc-400">
              {shift === 'DAY' ? 'Day shift' : 'Night shift'} · Connected to {getApiBaseUrl()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attendance photo modal */}
      <PhotoModal state={photoModal} onClose={closePhotoModal} />

    </div>
  );
}