import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sun, Moon, Search, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, CalendarDays,
  CheckCircle2, XCircle, CircleDashed, Users, ShieldCheck,
  AlertTriangle, ExternalLink, MapPin, Building2, Zap,
} from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

type EmpType = 'INDIVIDUAL' | 'SUPERVISOR';
type ApprovalStatus = 'A' | 'NA';
type AttendanceStatus = 'P' | 'A';
type Shift = 'DAY' | 'NIGHT';
type OtStatus = 'OT' | 'HALF_OT' | 'NO_OT';

interface Employee {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: EmpType;
  STATUS: ApprovalStatus;
  EMPPROFILEPHOTO: string | null;
  DEVICEID?: string | null;
  SALARY?: number | null;
}

interface AttendanceRecord {
  EMP_ID: string;
  CREATEDAT: string;
  STATUS: AttendanceStatus;
  SHIFT: Shift | null;
  MARKED_BY?: string | null;
  LOCATION?: string | null;
  PHOTO?: string | null;
  LAT_VALUE?: string | null;
  LONG_VALUE?: string | null;
  OT_STATUS?: OtStatus | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

type GetAllEmployeesResponse = ApiEnvelope<Employee[]>;

interface GetMonthlyAttendanceResponse {
  data: AttendanceRecord[];
}

interface TodayAttendanceEmployee {
  EMP_ID: string;
  EMPNAME: string;
  EMPFNAME: string;
  EMPDESG: string;
  EMPTYPE: EmpType;
  EMPPROFILEPHOTO: string | null;
  SALARY?: number | null;
  dayAttendance: AttendanceRecord | null;
  nightAttendance: AttendanceRecord | null;
  currentShiftMarked: boolean;
  currentShift: Shift;
}

interface GetTodayAttendanceResponse {
  success: boolean;
  data: TodayAttendanceEmployee[];
  currentShift: Shift;
  selfAttendance: {
    dayRecord: AttendanceRecord | null;
    nightRecord: AttendanceRecord | null;
    activeRecord: AttendanceRecord | null;
    isCurrentShiftMarked: boolean;
  };
}

interface ShiftBucket {
  day?: AttendanceRecord;
  night?: AttendanceRecord;
}

interface AttendanceDesignationGroup {
  designation: string;
  employees: Employee[];
}

type ConnectionStatus = 'demo' | 'connecting' | 'live' | 'error';

// ════════════════════════════════════════════════════════════════════════
// Time helpers — IST-anchored
// ════════════════════════════════════════════════════════════════════════

const IST_TZ = 'Asia/Kolkata';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getTodayISTKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(new Date());
}

function getISTDateKey(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(d);
}

function getISTHourMinute(date: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

function getCurrentShiftIST(date: Date = new Date()): 'DAY' | 'NIGHT' {
  return getISTHourMinute(date).hour >= 20 ? 'NIGHT' : 'DAY';
}

function formatISTTime(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleTimeString('en-IN', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatISTDateLong(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function addDaysToKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(dt);
}

function istWallClockToISO(dateKey: string, hh: number, mm: number): string {
  return new Date(`${dateKey}T${pad2(hh)}:${pad2(mm)}:00+05:30`).toISOString();
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

function resolveMarkedBy(
  record: AttendanceRecord | null | undefined,
  employeesById: Record<string, Employee>
): string {
  if (!record) return '';
  if (!record.MARKED_BY || record.MARKED_BY === record.EMP_ID) return 'Self';
  return employeesById[record.MARKED_BY]?.EMPNAME || `ID ${record.MARKED_BY}`;
}

function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// ════════════════════════════════════════════════════════════════════════
// OT pay calculation
// ════════════════════════════════════════════════════════════════════════
//
// NOTE ON THIS MODEL — read before changing the numbers below.
//
// Monthly SALARY is divided by 30 to get a flat "per-day rate." That per-day
// rate is what gets multiplied by the OT tier(s) below to produce the extra
// amount shown in the OT column for the currently-selected date. This never
// touches or overwrites the employee's monthly SALARY value — it's a
// read-only, per-date derived figure.
//
// TIER RULE (per shift worked that day):
//   OT_STATUS = 'OT'      → 2x   that shift's contribution
//   OT_STATUS = 'HALF_OT' → 1.5x that shift's contribution
//   OT_STATUS = 'NO_OT' / not yet set → 1x (no bonus, but shift was worked)
//   no record for that shift at all  → excluded entirely (not a 1x factor)
//
// DAY TOTAL = product of the tier(s) of every shift actually worked that day.
//   e.g. only day worked, OT      → 2x
//        only day worked, Half OT → 1.5x
//        day + night both worked, OT + OT → 2 × 2 = 4x
//
// This was the one interpretation that stayed internally consistent across
// every single-shift case confirmed during spec discussion. One two-shift
// example (Half OT + No OT) was given as 3x by the requester, which a plain
// product model puts at 1.5x instead — that one case could not be reconciled
// with the OT+OT=4x example under any single consistent rule, so this
// implementation deliberately takes the more conservative (lower) number in
// that specific ambiguous case rather than risk overpaying. If the intended
// rule turns out to include an extra "worked both shifts" bonus factor,
// change ONLY the `dailyOtMultiplier` function below — everything that calls
// it (row cell, expanded detail, group subtotal) will pick up the fix
// automatically since they all go through this one function.

const OT_TIER_MULTIPLIER: Record<OtStatus, number> = {
  OT: 2,
  HALF_OT: 1.5,
  NO_OT: 1,
};

/** Multiplier contributed by a single shift record, or null if the shift wasn't worked. */
function shiftOtMultiplier(record: AttendanceRecord | null | undefined): number | null {
  if (!record) return null; // shift not worked — excluded, not a 1x factor
  if (record.STATUS !== 'P') return null; // marked absent — no OT contribution
  if (!record.OT_STATUS) return 1; // present, OT tier not chosen yet — neutral
  return OT_TIER_MULTIPLIER[record.OT_STATUS] ?? 1;
}

/**
 * Combined OT multiplier for one employee on one date, given their day and
 * night attendance records for that date. Returns 1 (no bonus) if neither
 * shift carries an OT tier above baseline, and null if the employee didn't
 * work at all that date (both shifts absent/missing).
 */
function dailyOtMultiplier(bucket: ShiftBucket): number | null {
  const dayMult = shiftOtMultiplier(bucket.day);
  const nightMult = shiftOtMultiplier(bucket.night);
  if (dayMult === null && nightMult === null) return null; // didn't work this date
  return (dayMult ?? 1) * (nightMult ?? 1);
}

/** Employee's flat per-day rate, derived from their monthly salary. Null if salary isn't set. */
function dailyRate(salary: number | null | undefined): number | null {
  if (salary === null || salary === undefined) return null;
  return salary / 30;
}

/**
 * Extra pay (above the normal daily rate) an employee has earned for the
 * given date, based on OT tiers. Returns null when there's nothing to show
 * (no salary on file, or the employee didn't work / has no OT bonus that day).
 */
function extraOtPay(salary: number | null | undefined, bucket: ShiftBucket): number | null {
  const rate = dailyRate(salary);
  if (rate === null) return null;
  const multiplier = dailyOtMultiplier(bucket);
  if (multiplier === null || multiplier <= 1) return null; // nothing extra to show
  return rate * (multiplier - 1); // only the "extra" portion above the normal 1x day
}

// ════════════════════════════════════════════════════════════════════════
// Demo data
// ════════════════════════════════════════════════════════════════════════

const DEMO_EMPLOYEES: Employee[] = [
  { EMP_ID: 'EMP001', EMPNAME: 'Ramesh',   EMPFNAME: 'Kumar',   EMPDESG: 'Filling Operator',       EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 14500 },
  { EMP_ID: 'EMP002', EMPNAME: 'Suresh',   EMPFNAME: 'Yadav',   EMPDESG: 'Filling Operator',       EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 14000 },
  { EMP_ID: 'EMP003', EMPNAME: 'Priya',    EMPFNAME: 'Sharma',  EMPDESG: 'Quality Checker',        EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 16200 },
  { EMP_ID: 'EMP004', EMPNAME: 'Anil',     EMPFNAME: 'Verma',   EMPDESG: 'Packing Helper',         EMPTYPE: 'INDIVIDUAL', STATUS: 'NA', EMPPROFILEPHOTO: null, SALARY: null  },
  { EMP_ID: 'EMP005', EMPNAME: 'Sunita',   EMPFNAME: 'Devi',    EMPDESG: 'Packing Helper',         EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 12000 },
  { EMP_ID: 'EMP006', EMPNAME: 'Rajesh',   EMPFNAME: 'Singh',   EMPDESG: 'Line Supervisor',        EMPTYPE: 'SUPERVISOR', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 28500 },
  { EMP_ID: 'EMP007', EMPNAME: 'Geeta',    EMPFNAME: 'Pandey',  EMPDESG: 'Wastage Checker',        EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 13800 },
  { EMP_ID: 'EMP008', EMPNAME: 'Vikram',   EMPFNAME: 'Chauhan', EMPDESG: 'Loader',                 EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 11500 },
  { EMP_ID: 'EMP009', EMPNAME: 'Naveen',   EMPFNAME: 'Gupta',   EMPDESG: 'Dispatch Incharge',      EMPTYPE: 'SUPERVISOR', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 26000 },
  { EMP_ID: 'EMP010', EMPNAME: 'Pooja',    EMPFNAME: 'Mishra',  EMPDESG: 'Machine Operator',       EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 15500 },
  { EMP_ID: 'EMP011', EMPNAME: 'Arjun',    EMPFNAME: 'Tiwari',  EMPDESG: 'Security Guard',         EMPTYPE: 'INDIVIDUAL', STATUS: 'A',  EMPPROFILEPHOTO: null, SALARY: 12500 },
  { EMP_ID: 'EMP012', EMPNAME: 'Mohammed', EMPFNAME: 'Aslam',   EMPDESG: 'Maintenance Technician', EMPTYPE: 'INDIVIDUAL', STATUS: 'NA', EMPPROFILEPHOTO: null, SALARY: null  },
];

function buildDemoAttendance(): AttendanceRecord[] {
  const today = getTodayISTKey();
  const yest  = addDaysToKey(today, -1);
  const rows: AttendanceRecord[] = [];

  const add = (
    empId: string,
    dateKey: string,
    shift: 'DAY' | 'NIGHT',
    status: 'P' | 'A',
    hh: number,
    mm: number,
    opts: { markedBy?: string; ot?: 'OT' | 'HALF_OT' | 'NO_OT' } = {}
  ) => {
    rows.push({
      EMP_ID:    empId,
      CREATEDAT: istWallClockToISO(dateKey, hh, mm),
      STATUS:    status,
      SHIFT:     shift,
      MARKED_BY: opts.markedBy || empId,
      OT_STATUS: opts.ot || null,
    });
  };

  add('EMP001', today, 'DAY',   'P', 9,  4,  { ot: 'NO_OT' });
  add('EMP001', today, 'NIGHT', 'P', 20, 6,  {});
  add('EMP002', today, 'DAY',   'P', 9,  12, { ot: 'OT' });
  add('EMP003', today, 'DAY',   'A', 9,  0,  {});
  add('EMP004', today, 'DAY',   'P', 9,  20, { markedBy: 'EMP006' });
  add('EMP005', today, 'DAY',   'P', 8,  58, { ot: 'HALF_OT' });
  add('EMP005', today, 'NIGHT', 'A', 20, 10, {});
  add('EMP006', today, 'DAY',   'P', 8,  45, {});
  add('EMP007', today, 'DAY',   'P', 9,  30, { markedBy: 'EMP006' });
  add('EMP008', today, 'DAY',   'A', 9,  0,  {});
  add('EMP009', today, 'DAY',   'P', 8,  50, {});
  add('EMP010', today, 'DAY',   'P', 9,  15, { ot: 'NO_OT' });
  add('EMP010', today, 'NIGHT', 'P', 20, 2,  {});
  add('EMP011', today, 'NIGHT', 'P', 20, 20, { markedBy: 'EMP006' });

  add('EMP001', yest,  'DAY',   'P', 9,  10, { ot: 'NO_OT' });
  add('EMP001', yest,  'NIGHT', 'P', 20, 5,  { ot: 'NO_OT' });
  add('EMP002', yest,  'DAY',   'A', 9,  0,  {});
  add('EMP003', yest,  'DAY',   'P', 9,  2,  {});
  add('EMP004', yest,  'DAY',   'P', 9,  25, { markedBy: 'EMP006' });
  add('EMP005', yest,  'DAY',   'P', 9,  0,  {});
  add('EMP005', yest,  'NIGHT', 'P', 20, 12, { ot: 'HALF_OT' });
  add('EMP006', yest,  'DAY',   'P', 8,  40, {});
  add('EMP009', yest,  'DAY',   'P', 8,  55, {});
  add('EMP010', yest,  'DAY',   'A', 9,  0,  {});

  return rows;
}

// ════════════════════════════════════════════════════════════════════════
// API client
// ════════════════════════════════════════════════════════════════════════

const RAW_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;

if (!RAW_BASE_URL) {
  console.warn(
    '[attendance] VITE_API_URL is not set. Add it to your .env file, e.g.\nVITE_API_URL=http://localhost:4000/api'
  );
}

const BASE_URL = (RAW_BASE_URL ?? '').replace(/\/+$/, '');

function hasApiBaseUrl(): boolean { return BASE_URL.length > 0; }
function getApiBaseUrl(): string  { return BASE_URL; }

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

async function fetchTodayAttendance(supervisorId: string): Promise<GetTodayAttendanceResponse> {
  return getJson<GetTodayAttendanceResponse>(`/attendance/today?supervisorId=${encodeURIComponent(supervisorId)}`);
}

function todayEmployeeToEmployee(e: TodayAttendanceEmployee): Employee {
  return {
    EMP_ID:          e.EMP_ID,
    EMPNAME:         e.EMPNAME,
    EMPFNAME:        e.EMPFNAME,
    EMPDESG:         e.EMPDESG,
    EMPTYPE:         e.EMPTYPE,
    STATUS:          'A',
    EMPPROFILEPHOTO: e.EMPPROFILEPHOTO,
    SALARY:          e.SALARY,
  };
}

function todayEmployeeToRecords(e: TodayAttendanceEmployee): AttendanceRecord[] {
  const out: AttendanceRecord[] = [];
  if (e.dayAttendance)   out.push(e.dayAttendance);
  if (e.nightAttendance) out.push(e.nightAttendance);
  return out;
}

function buildFileUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath || !BASE_URL) return null;
  const origin     = BASE_URL.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${origin}/uploads/${normalized}`;
}

// ════════════════════════════════════════════════════════════════════════
// Presentational atoms
// ════════════════════════════════════════════════════════════════════════

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [errored, setErrored] = useState(false);
  if (photoUrl && !errored) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setErrored(true)}
        className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-[11px] font-semibold text-zinc-600">
      {initials(name)}
    </div>
  );
}

type PillValue = 'PRESENT' | 'ABSENT' | 'NOT_MARKED';

const PILL_MAP: Record<PillValue, { label: string; Icon: typeof CheckCircle2; bg: string; text: string }> = {
  PRESENT:    { label: 'Present',    Icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-600' },
  ABSENT:     { label: 'Absent',     Icon: XCircle,      bg: 'bg-rose-50',    text: 'text-rose-500'    },
  NOT_MARKED: { label: 'Not marked', Icon: CircleDashed,  bg: 'bg-zinc-100',  text: 'text-zinc-400'    },
};

function StatusPill({ value }: { value: PillValue }) {
  const { label, Icon, bg, text } = PILL_MAP[value];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${bg} ${text}`}>
      <Icon size={12} strokeWidth={2.5} />
      {label}
    </span>
  );
}

const OT_MAP: Record<string, { label: string; cls: string }> = {
  OT:      { label: 'OT',      cls: 'text-amber-600 border-amber-200 bg-amber-50' },
  HALF_OT: { label: 'Half OT', cls: 'text-amber-600 border-amber-200 bg-amber-50' },
  NO_OT:   { label: 'No OT',   cls: 'text-zinc-400 border-zinc-200 bg-zinc-50'   },
};

function OtBadge({ ot }: { ot: string | null | undefined }) {
  if (!ot) return null;
  const m = OT_MAP[ot];
  if (!m) return null;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ApprovalTag({ status }: { status: 'A' | 'NA' }) {
  if (status === 'A') return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-500">
      Pending approval
    </span>
  );
}

const CONNECTION_MAP: Record<ConnectionStatus, { bg: string; text: string; dot: string; label: string }> = {
  demo:       { label: 'Demo data',         bg: 'bg-zinc-100',   text: 'text-zinc-500',   dot: 'bg-zinc-400'   },
  connecting: { label: 'Connecting…',       bg: 'bg-amber-50',   text: 'text-amber-600',  dot: 'bg-amber-400'  },
  live:       { label: 'Live',              bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  error:      { label: 'Connection failed', bg: 'bg-rose-50',    text: 'text-rose-500',   dot: 'bg-rose-500'   },
};

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const { label, bg, text, dot } = CONNECTION_MAP[status];
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-xs font-mono ${bg} ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} inline-block`} />
      {label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Stat blocks + shift gauge
// ════════════════════════════════════════════════════════════════════════

interface StatItem {
  label: string;
  value: number;
  display?: string;
}

interface StatBlockProps {
  icon?: typeof Sun;
  label: string;
  accent: 'zinc' | 'amber' | 'indigo';
  items: StatItem[];
}

const ACCENT_TEXT: Record<StatBlockProps['accent'], string> = {
  zinc:   'text-zinc-700',
  amber:  'text-amber-500',
  indigo: 'text-indigo-500',
};

function StatBlock({ icon: Icon, label, accent, items }: StatBlockProps) {
  return (
    <div className="flex-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon size={14} className={ACCENT_TEXT[accent]} />}
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">{label}</span>
      </div>
      <div className="flex items-end gap-5">
        {items.map((it) => (
          <div key={it.label}>
            <div className="font-mono text-xl font-semibold leading-none text-zinc-900">{it.display ?? it.value}</div>
            <div className="mt-1 text-[11px] text-zinc-400">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftGauge({ now }: { now: Date }) {
  const { hour, minute } = getISTHourMinute(now);
  const width  = 600;
  const x      = ((hour + minute / 60) / 24) * width;
  const splitX = (20 / 24) * width;
  const isDay  = hour < 20;

  return (
    <div className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex shrink-0 items-center gap-1.5">
        {isDay ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} className="text-indigo-500" />}
        <span className={`whitespace-nowrap font-mono text-[11px] font-semibold tracking-wide ${isDay ? 'text-amber-600' : 'text-indigo-600'}`}>
          {isDay ? 'DAY' : 'NIGHT'} SHIFT ACTIVE
        </span>
      </div>
      <svg viewBox={`0 0 ${width} 28`} className="h-5 flex-1" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0"      y="11" width={splitX}          height="6" rx="3" className="fill-amber-50"  />
        <rect x={splitX} y="11" width={width - splitX}  height="6" rx="3" className="fill-indigo-50" />
        <line x1={splitX} y1="4" x2={splitX} y2="24" className="stroke-zinc-200" strokeWidth="1" />
        <circle cx={x} cy="14" r="6" className={isDay ? 'fill-amber-400' : 'fill-indigo-400'} stroke="#ffffff" strokeWidth="2" />
      </svg>
      <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-zinc-400">{formatISTTime(now)} IST</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Shift cell, detail pane, expanded detail
// ════════════════════════════════════════════════════════════════════════

function ShiftCell({
  record,
  employeesById,
}: {
  record: AttendanceRecord | null | undefined;
  employeesById: Record<string, Employee>;
}) {
  if (!record) return <StatusPill value="NOT_MARKED" />;
  const value = record.STATUS === 'P' ? 'PRESENT' : 'ABSENT';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill value={value} />
        <OtBadge ot={record.OT_STATUS} />
      </div>
      <div className="font-mono text-[10px] text-zinc-400">
        {formatISTTime(record.CREATEDAT)} · {resolveMarkedBy(record, employeesById)}
      </div>
    </div>
  );
}

/**
 * Renders the extra-OT-pay amount for one employee on the selected date, or a
 * neutral dash when there's nothing extra to show (no salary, no OT bonus,
 * or the employee didn't work that day).
 */
function OtPayCell({ salary, bucket }: { salary: number | null | undefined; bucket: ShiftBucket }) {
  const extra = extraOtPay(salary, bucket);
  const multiplier = dailyOtMultiplier(bucket);

  if (extra === null) {
    return <span className="font-mono text-[12px] italic text-zinc-300">—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-amber-600">
        <Zap size={11} className="shrink-0" />+{formatINR(Math.round(extra))}
      </span>
      {multiplier !== null && multiplier > 1 && (
        <span className="font-mono text-[9px] uppercase tracking-wide text-zinc-400">{multiplier}× today</span>
      )}
    </div>
  );
}

interface DetailPaneProps {
  label: string;
  icon: typeof Sun;
  accent: 'day' | 'night';
  record: AttendanceRecord | null | undefined;
  employeesById: Record<string, Employee>;
}

const DETAIL_ACCENT: Record<'day' | 'night', string> = { day: 'text-amber-500', night: 'text-indigo-500' };

function DetailPane({ label, icon: Icon, accent, record, employeesById }: DetailPaneProps) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={13} className={DETAIL_ACCENT[accent]} />
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">{label}</span>
      </div>
      {!record ? (
        <p className="text-[11px] text-zinc-400">No record for this shift yet.</p>
      ) : (
        <dl className="space-y-1.5 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Status</dt>
            <dd className="font-medium text-zinc-700">{record.STATUS === 'P' ? 'Present' : 'Absent'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Marked at</dt>
            <dd className="font-mono text-zinc-700">{formatISTTime(record.CREATEDAT)} IST</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Marked by</dt>
            <dd className="text-zinc-700">{resolveMarkedBy(record, employeesById)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">OT status</dt>
            <dd className="text-zinc-700">{record.OT_STATUS ? record.OT_STATUS.replace('_', ' ') : 'Not set yet'}</dd>
          </div>
          {record.LOCATION && (
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-400">Location</dt>
              <dd className="text-right text-zinc-700">{record.LOCATION}</dd>
            </div>
          )}
          {record.LAT_VALUE && record.LONG_VALUE && (
            <div className="pt-1">
              <a
                href={`https://www.google.com/maps?q=${record.LAT_VALUE},${record.LONG_VALUE}`}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 font-medium ${DETAIL_ACCENT[accent]}`}
              >
                <MapPin size={12} /> View on map <ExternalLink size={11} />
              </a>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ExpandedDetail({
  emp,
  dayRecord,
  nightRecord,
  employeesById,
}: {
  emp: Employee;
  dayRecord: AttendanceRecord | null | undefined;
  nightRecord: AttendanceRecord | null | undefined;
  employeesById: Record<string, Employee>;
}) {
  const bucket: ShiftBucket = { day: dayRecord ?? undefined, night: nightRecord ?? undefined };
  const extra = extraOtPay(emp.SALARY, bucket);
  const multiplier = dailyOtMultiplier(bucket);
  const rate = dailyRate(emp.SALARY);

  return (
    <div className="space-y-3 pt-1">
      {/* Salary row inside the expanded panel */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5">
        <span className="text-[11px] text-zinc-400">Monthly salary</span>
        <span className={`font-mono text-[12px] font-semibold ${emp.SALARY == null ? 'italic text-zinc-300' : 'text-zinc-800'}`}>
          {emp.SALARY == null ? 'Not set' : formatINR(emp.SALARY)}
        </span>
      </div>

      {/* OT pay row — only shown when there's an actual bonus to explain */}
      {extra !== null && rate !== null && (
        <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
            <Zap size={12} />
            <span>OT bonus today{multiplier ? ` (${multiplier}×)` : ''}</span>
          </div>
          <span className="font-mono text-[12px] font-semibold text-amber-700">
            +{formatINR(Math.round(extra))}
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <DetailPane label="Day shift"   icon={Sun}  accent="day"   record={dayRecord}   employeesById={employeesById} />
        <DetailPane label="Night shift" icon={Moon} accent="night" record={nightRecord} employeesById={employeesById} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Date nav + filters bar
// ════════════════════════════════════════════════════════════════════════

interface DateNavProps {
  dateKey: string;
  onPrev:   () => void;
  onNext:   () => void;
  onToday:  () => void;
  onPick:   (dateKey: string) => void;
  isToday:  boolean;
}

function DateNav({ dateKey, onPrev, onNext, onToday, onPick, isToday }: DateNavProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Date</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPrev}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
            aria-label="Previous day"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="relative flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 transition-colors hover:border-zinc-400">
            <CalendarDays size={14} className="text-zinc-400" />
            <span className="select-none whitespace-nowrap font-mono text-sm text-zinc-800">{formatISTDateLong(dateKey)}</span>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => e.target.value && onPick(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Pick a date"
            />
          </div>
          <button
            onClick={onNext}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
            aria-label="Next day"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      {!isToday && (
        <button
          onClick={onToday}
          className="whitespace-nowrap rounded-full border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-600 transition-colors hover:border-zinc-400"
        >
          Jump to today
        </button>
      )}
    </div>
  );
}

interface FiltersBarProps {
  search:                    string;
  onSearch:                  (v: string) => void;
  typeFilter:                EmpType | 'ALL';
  onTypeFilter:              (v: EmpType | 'ALL') => void;
  onlyPending?:              boolean;
  onTogglePending?:          () => void;
  groupByDesignation?:       boolean;
  onToggleGroupByDesignation?: () => void;
}

function FiltersBar({
  search, onSearch, typeFilter, onTypeFilter,
  onlyPending, onTogglePending,
  groupByDesignation, onToggleGroupByDesignation,
}: FiltersBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Search</span>
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Name or designation…"
            className="w-64 rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-800 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-zinc-900"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">Role</span>
        <div className="relative w-36">
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilter(e.target.value as EmpType | 'ALL')}
            className="w-full appearance-none rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-8 font-mono text-sm text-zinc-800 outline-none transition-all hover:border-zinc-400 focus:border-transparent focus:ring-2 focus:ring-zinc-900"
          >
            <option value="ALL">All roles</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="SUPERVISOR">Supervisor</option>
          </select>
          <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
      {onTogglePending && (
        <button
          onClick={onTogglePending}
          className={`whitespace-nowrap rounded-full border px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wide transition-colors ${
            onlyPending ? 'border-rose-200 bg-rose-50 text-rose-500' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
          }`}
        >
          Pending this shift only
        </button>
      )}
      {onToggleGroupByDesignation && (
        <button
          onClick={onToggleGroupByDesignation}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wide transition-colors ${
            groupByDesignation ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
          }`}
        >
          <Building2 size={12} />
          Group by designation
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Loading skeleton
// ════════════════════════════════════════════════════════════════════════

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.tr
          key={`sk-${i}`}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ delay: i * 0.03 }}
          className="border-b border-zinc-50"
        >
          <td className="px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-zinc-100 animate-pulse" />
              <div className="flex flex-col gap-1.5">
                <div className="h-3 rounded bg-zinc-100 animate-pulse" style={{ width: 96 + (i % 3) * 24 }} />
                <div className="h-2.5 w-20 rounded bg-zinc-100 animate-pulse" />
              </div>
            </div>
          </td>
          <td className="px-4 py-3"><div className="h-5 w-16 rounded bg-zinc-100 animate-pulse" /></td>
          <td className="px-4 py-3"><div className="h-5 w-16 rounded bg-zinc-100 animate-pulse" /></td>
          <td className="px-4 py-3"><div className="h-6 w-20 rounded-full bg-zinc-100 animate-pulse" /></td>
          <td className="px-4 py-3"><div className="h-6 w-20 rounded-full bg-zinc-100 animate-pulse" /></td>
        </motion.tr>
      ))}
    </>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 gap-2">
      <svg className="text-zinc-300 mb-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
      <p className="text-sm font-medium text-zinc-400">No employees match these filters</p>
      <p className="text-xs text-zinc-300">{label}</p>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Employee row  — has both a Salary column and an OT (extra pay) column
// ════════════════════════════════════════════════════════════════════════

function EmployeeRow({
  emp, index, shiftBucket, employeesById, isExpanded, onToggle,
}: {
  emp:            Employee;
  index:          number;
  shiftBucket:    ShiftBucket;
  employeesById:  Record<string, Employee>;
  isExpanded:     boolean;
  onToggle:       () => void;
}) {
  return (
    <Fragment>
      <motion.tr
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: index * 0.015, ease: [0.16, 1, 0.3, 1] }}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
        className={`cursor-pointer hover:bg-zinc-50/80 transition-colors group ${isExpanded ? '' : 'border-b border-zinc-50'}`}
      >
        {/* Employee */}
        <td className="px-5 py-3 align-top">
          <div className="flex items-start gap-3">
            <Avatar name={`${emp.EMPNAME} ${emp.EMPFNAME}`} photoUrl={buildFileUrl(emp.EMPPROFILEPHOTO)} />
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="whitespace-nowrap font-medium text-zinc-800 text-[13px]">
                  {emp.EMPNAME} {emp.EMPFNAME}
                </span>
                {emp.EMPTYPE === 'SUPERVISOR' && (
                  <span title="Supervisor"><ShieldCheck size={12} className="text-indigo-400" /></span>
                )}
              </div>
              <div className="text-[11px] text-zinc-400">{emp.EMPDESG}</div>
              <ApprovalTag status={emp.STATUS} />
            </div>
          </div>
        </td>

        {/* Salary */}
        <td className="px-4 py-3 align-top">
          <span className={`font-mono text-[12px] ${emp.SALARY == null ? 'italic text-zinc-300' : 'text-zinc-700'}`}>
            {emp.SALARY == null ? '—' : formatINR(emp.SALARY)}
          </span>
        </td>

        {/* OT / extra pay for the selected date */}
        <td className="px-4 py-3 align-top">
          <OtPayCell salary={emp.SALARY} bucket={shiftBucket} />
        </td>

        {/* Day shift */}
        <td className="px-4 py-3 align-top">
          <ShiftCell record={shiftBucket.day} employeesById={employeesById} />
        </td>

        {/* Night shift */}
        <td className="px-4 py-3 align-top">
          <ShiftCell record={shiftBucket.night} employeesById={employeesById} />
        </td>
      </motion.tr>

      {isExpanded && (
        <tr className="border-b border-zinc-50 bg-zinc-50/40">
          <td colSpan={5} className="px-5 pb-4 pt-0">
            <ExpandedDetail
              emp={emp}
              dayRecord={shiftBucket.day}
              nightRecord={shiftBucket.night}
              employeesById={employeesById}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function DesignationGroupHeaderRow({
  designation, employees, attendanceByEmp, isCollapsed, onToggle,
}: {
  designation:    string;
  employees:      Employee[];
  attendanceByEmp: Record<string, ShiftBucket>;
  isCollapsed:    boolean;
  onToggle:       () => void;
}) {
  const dayPresent   = employees.filter((e) => attendanceByEmp[e.EMP_ID]?.day?.STATUS   === 'P').length;
  const nightPresent = employees.filter((e) => attendanceByEmp[e.EMP_ID]?.night?.STATUS === 'P').length;
  const groupTotal   = employees.reduce((sum, e) => sum + (e.SALARY ?? 0), 0);

  // Sum of extra OT pay across the group for the currently-selected date.
  const groupOtTotal = employees.reduce((sum, e) => {
    const extra = extraOtPay(e.SALARY, attendanceByEmp[e.EMP_ID] || {});
    return sum + (extra ?? 0);
  }, 0);

  return (
    <tr className="border-b border-zinc-100 bg-zinc-50">
      <td colSpan={5} className="p-0">
        <button
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-zinc-100"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Building2 size={13} className="text-zinc-400" />
            <span className="text-[12px] font-semibold text-zinc-700">{designation}</span>
            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-500">
              {employees.length} {employees.length === 1 ? 'employee' : 'employees'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {groupTotal > 0 && (
              <span className="font-mono text-[10px] text-zinc-500">{formatINR(groupTotal)}/mo</span>
            )}
            {groupOtTotal > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-amber-600">
                <Zap size={10} /> +{formatINR(Math.round(groupOtTotal))} OT today
              </span>
            )}
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-amber-600">
              <Sun size={11} /> {dayPresent}/{employees.length}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-indigo-600">
              <Moon size={11} /> {nightPresent}/{employees.length}
            </span>
            <ChevronDown size={13} className={`text-zinc-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
          </div>
        </button>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main component — no internal sidebar or mobile tabs
// Navigation is now owned by Layout + Sidebar (react-router)
// ════════════════════════════════════════════════════════════════════════

interface AttendanceDashboardProps {
  supervisorId?: string;
}

export default function AttendanceDashboard({ supervisorId }: AttendanceDashboardProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(hasApiBaseUrl() ? 'connecting' : 'demo');
  const [errorMessage, setErrorMessage] = useState('');

  const [employees, setEmployees] = useState<Employee[]>(DEMO_EMPLOYEES);
  const [records,   setRecords]   = useState<AttendanceRecord[]>(() => buildDemoAttendance());

  const [selectedDateKey, setSelectedDateKey] = useState(getTodayISTKey());
  const [now, setNow] = useState(new Date());

  const [search,                  setSearch]                  = useState('');
  const [typeFilter,              setTypeFilter]              = useState<EmpType | 'ALL'>('ALL');
  const [onlyPending,             setOnlyPending]             = useState(false);
  const [expandedId,              setExpandedId]              = useState<string | null>(null);
  const [groupByDesignation,      setGroupByDesignation]      = useState(false);
  const [collapsedDesignations,   setCollapsedDesignations]   = useState<Record<string, boolean>>({});

  const isToday = selectedDateKey === getTodayISTKey();

  const toggleDesignationGroup = (designation: string) =>
    setCollapsedDesignations((c) => ({ ...c, [designation]: !c[designation] }));

  const loadToday = useCallback(async () => {
    setConnectionStatus('connecting');
    setErrorMessage('');
    try {
      if (supervisorId) {
        const todayJson = await fetchTodayAttendance(supervisorId);
        setEmployees(todayJson.data.map(todayEmployeeToEmployee));
        setRecords(todayJson.data.flatMap(todayEmployeeToRecords));
      } else {
        const [empList, monthRecords] = await Promise.all([
          fetchAllEmployees(),
          fetchMonthlyAttendance(new Date().getFullYear(), new Date().getMonth()),
        ]);
        setEmployees(empList);
        setRecords(monthRecords);
      }
      setConnectionStatus('live');
    } catch (err) {
      setConnectionStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [supervisorId]);

  const loadMonthFor = useCallback(async (dateKey: string) => {
    const [y, m] = dateKey.split('-').map(Number);
    try {
      const monthRecords = await fetchMonthlyAttendance(y, m - 1);
      setRecords(monthRecords);
      setConnectionStatus('live');
      if (!employees.length || employees === DEMO_EMPLOYEES) {
        setEmployees(await fetchAllEmployees());
      }
    } catch (err) {
      setConnectionStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (hasApiBaseUrl()) loadToday(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!hasApiBaseUrl()) return;
    if (isToday) loadToday(); else loadMonthFor(selectedDateKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const currentShift = useMemo(() => getCurrentShiftIST(now), [now]);

  const handleUseDemo = () => {
    setConnectionStatus('demo');
    setErrorMessage('');
    setEmployees(DEMO_EMPLOYEES);
    setRecords(buildDemoAttendance());
  };

  const handleRefresh = () => {
    if (!hasApiBaseUrl()) { setRecords(buildDemoAttendance()); return; }
    if (isToday) loadToday(); else loadMonthFor(selectedDateKey);
  };

  const employeesById = useMemo(() => {
    const map: Record<string, Employee> = {};
    employees.forEach((e) => { map[e.EMP_ID] = e; });
    return map;
  }, [employees]);

  const recordsForDate = useMemo(
    () => records.filter((r) => getISTDateKey(r.CREATEDAT) === selectedDateKey),
    [records, selectedDateKey]
  );

  const attendanceByEmp = useMemo(() => {
    const map: Record<string, ShiftBucket> = {};
    recordsForDate.forEach((r) => {
      if (!map[r.EMP_ID]) map[r.EMP_ID] = {};
      if (r.SHIFT === 'DAY')   map[r.EMP_ID].day   = r;
      if (r.SHIFT === 'NIGHT') map[r.EMP_ID].night = r;
    });
    return map;
  }, [recordsForDate]);

  const stats = useMemo(() => {
    const day   = { present: 0, absent: 0, notMarked: 0 };
    const night = { present: 0, absent: 0, notMarked: 0 };
    employees.forEach((e) => {
      const a = attendanceByEmp[e.EMP_ID] || {};
      if (!a.day)               day.notMarked   += 1;
      else if (a.day.STATUS   === 'P') day.present  += 1;
      else                      day.absent      += 1;
      if (!a.night)             night.notMarked += 1;
      else if (a.night.STATUS === 'P') night.present += 1;
      else                      night.absent    += 1;
    });
    return { day, night, total: employees.length };
  }, [employees, attendanceByEmp]);

  // Total OT pay owed across everyone currently in view, for the selected date.
  const totalOtToday = useMemo(() => {
    return employees.reduce((sum, e) => {
      const extra = extraOtPay(e.SALARY, attendanceByEmp[e.EMP_ID] || {});
      return sum + (extra ?? 0);
    }, 0);
  }, [employees, attendanceByEmp]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (typeFilter !== 'ALL' && e.EMPTYPE !== typeFilter) return false;
      if (q) {
        const hay = `${e.EMPNAME} ${e.EMPFNAME} ${e.EMPDESG}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (onlyPending) {
        const a = attendanceByEmp[e.EMP_ID] || {};
        if (currentShift === 'DAY' ? a.day : a.night) return false;
      }
      return true;
    });
  }, [employees, typeFilter, search, onlyPending, attendanceByEmp, currentShift]);

  const groupedFilteredEmployees = useMemo<AttendanceDesignationGroup[]>(() => {
    const byDesg = new Map<string, Employee[]>();
    filteredEmployees.forEach((e) => {
      const key = e.EMPDESG?.trim() || 'Unspecified';
      if (!byDesg.has(key)) byDesg.set(key, []);
      byDesg.get(key)!.push(e);
    });
    return Array.from(byDesg.entries())
      .map(([designation, emps]) => ({ designation, employees: emps }))
      .sort((a, b) => a.designation.localeCompare(b.designation));
  }, [filteredEmployees]);

  const isLoadingTable = connectionStatus === 'connecting' && employees === DEMO_EMPLOYEES;

  return (
    <div className="min-w-0 flex-1 p-8">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-7"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">Attendance Register</span>
          <span className="h-px w-8 bg-zinc-300 block" />
          <span className="text-[10px] font-mono text-zinc-400">{formatISTDateLong(selectedDateKey)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Plant Attendance</h1>
          <div className="flex items-center gap-2">
            <ConnectionBadge status={connectionStatus} />
            <button
              onClick={handleRefresh}
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
              aria-label="Refresh" title="Refresh"
            >
              <RefreshCw size={15} className={connectionStatus === 'connecting' ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Connection notice ── */}
      <AnimatePresence>
        {connectionStatus !== 'live' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${
              connectionStatus === 'error' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${connectionStatus === 'error' ? 'text-rose-500' : 'text-amber-500'}`} />
            <div className="flex-1">
              {connectionStatus === 'error' ? (
                <>
                  <p className="font-medium text-zinc-800">Couldn&rsquo;t reach {getApiBaseUrl() || '(no API URL configured)'}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {errorMessage}. Confirm the server is running, CORS allows this origin, and{' '}
                    <code className="font-mono">VITE_API_URL</code> in your .env is correct.
                  </p>
                </>
              ) : !hasApiBaseUrl() ? (
                <>
                  <p className="font-medium text-zinc-800">VITE_API_URL is not set</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Add it to your .env file, e.g. <code className="font-mono">VITE_API_URL=http://localhost:4000/api</code>, then restart.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-zinc-800">Connecting…</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">Loading attendance from {getApiBaseUrl()}.</p>
                </>
              )}
            </div>
            {connectionStatus !== 'connecting' && (
              <button onClick={handleUseDemo} className="whitespace-nowrap font-mono text-[11px] font-medium uppercase text-zinc-600 underline">
                Use demo data
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Shift gauge + date nav ── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col gap-4 mb-5"
      >
        <ShiftGauge now={now} />
        <DateNav
          dateKey={selectedDateKey}
          onPrev={() => setSelectedDateKey((k) => addDaysToKey(k, -1))}
          onNext={() => setSelectedDateKey((k) => addDaysToKey(k, 1))}
          onToday={() => setSelectedDateKey(getTodayISTKey())}
          onPick={setSelectedDateKey}
          isToday={isToday}
        />
      </motion.div>

      {/* ── Stat blocks ── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col gap-3 sm:flex-row mb-5"
      >
        <StatBlock icon={Users} label="Roster"      accent="zinc"   items={[{ label: 'Employees', value: stats.total }]} />
        <StatBlock icon={Sun}   label="Day shift"   accent="amber"  items={[
          { label: 'Present',    value: stats.day.present    },
          { label: 'Absent',     value: stats.day.absent     },
          { label: 'Not marked', value: stats.day.notMarked  },
        ]} />
        <StatBlock icon={Moon}  label="Night shift" accent="indigo" items={[
          { label: 'Present',    value: stats.night.present   },
          { label: 'Absent',     value: stats.night.absent    },
          { label: 'Not marked', value: stats.night.notMarked },
        ]} />
        <StatBlock icon={Zap} label="OT payout" accent="amber" items={[
          { label: 'Extra today', value: totalOtToday, display: formatINR(Math.round(totalOtToday)) },
        ]} />
      </motion.div>

      {/* ── Filters ── */}
      <div className="mb-5">
        <FiltersBar
          search={search}
          onSearch={setSearch}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          onlyPending={onlyPending}
          onTogglePending={() => setOnlyPending((v) => !v)}
          groupByDesignation={groupByDesignation}
          onToggleGroupByDesignation={() => setGroupByDesignation((v) => !v)}
        />
      </div>

      {/* ── Table ── */}
      <div
        className="rounded-xl border border-zinc-200 bg-white overflow-auto max-h-[60vh] shadow-sm"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#e4e4e7 transparent' }}
      >
        <table className="border-collapse min-w-full text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 text-left px-5 py-3 text-[10px] font-medium tracking-widest uppercase text-zinc-400 min-w-[220px] whitespace-nowrap">
                Employee
              </th>
              <th className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 text-left px-4 py-3 text-[10px] font-medium tracking-widest uppercase text-zinc-400 min-w-[110px] whitespace-nowrap">
                Salary / mo
              </th>
              <th className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 text-left px-4 py-3 text-[10px] font-medium tracking-widest uppercase text-amber-500 min-w-[110px] whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5"><Zap size={11} /> OT extra</span>
              </th>
              <th className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 text-left px-4 py-3 text-[10px] font-medium tracking-widest uppercase text-amber-500 min-w-[200px] whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5"><Sun size={11} /> Day shift</span>
              </th>
              <th className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-100 text-left px-4 py-3 text-[10px] font-medium tracking-widest uppercase text-indigo-500 min-w-[200px] whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5"><Moon size={11} /> Night shift</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="wait">
              {isLoadingTable ? (
                <SkeletonRows key="sk" />
              ) : groupByDesignation ? (
                groupedFilteredEmployees.map((group) => {
                  const isCollapsed = !!collapsedDesignations[group.designation];
                  return (
                    <Fragment key={group.designation}>
                      <DesignationGroupHeaderRow
                        designation={group.designation}
                        employees={group.employees}
                        attendanceByEmp={attendanceByEmp}
                        isCollapsed={isCollapsed}
                        onToggle={() => toggleDesignationGroup(group.designation)}
                      />
                      {!isCollapsed &&
                        group.employees.map((emp, i) => (
                          <EmployeeRow
                            key={emp.EMP_ID}
                            emp={emp}
                            index={i}
                            shiftBucket={attendanceByEmp[emp.EMP_ID] || {}}
                            employeesById={employeesById}
                            isExpanded={expandedId === emp.EMP_ID}
                            onToggle={() => setExpandedId(expandedId === emp.EMP_ID ? null : emp.EMP_ID)}
                          />
                        ))}
                    </Fragment>
                  );
                })
              ) : (
                filteredEmployees.map((emp, i) => (
                  <EmployeeRow
                    key={emp.EMP_ID}
                    emp={emp}
                    index={i}
                    shiftBucket={attendanceByEmp[emp.EMP_ID] || {}}
                    employeesById={employeesById}
                    isExpanded={expandedId === emp.EMP_ID}
                    onToggle={() => setExpandedId(expandedId === emp.EMP_ID ? null : emp.EMP_ID)}
                  />
                ))
              )}
            </AnimatePresence>
          </tbody>
        </table>
        {!isLoadingTable && filteredEmployees.length === 0 && (
          <EmptyState label="Try adjusting search, role, or the pending toggle" />
        )}
      </div>

      {/* ── Legend ── */}
      <AnimatePresence>
        {!isLoadingTable && filteredEmployees.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.2 }}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-xs text-zinc-400"
          >
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-500" /> Present</span>
            <span className="inline-flex items-center gap-1.5"><XCircle      size={12} className="text-rose-400"    /> Absent</span>
            <span className="inline-flex items-center gap-1.5"><CircleDashed size={12} /> Not marked</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck  size={12} className="text-indigo-400" /> Supervisor</span>
            <span className="inline-flex items-center gap-1.5"><Zap size={12} className="text-amber-500" /> OT extra (today's rate)</span>
            <span className="ml-auto whitespace-nowrap font-mono text-[10px]">
              {connectionStatus === 'live' ? `Connected to ${getApiBaseUrl()}` : 'Sample data shown'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}