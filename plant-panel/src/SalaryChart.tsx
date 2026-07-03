import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sun, Moon, RefreshCw, CalendarDays,
  Users, AlertTriangle, IndianRupee, ServerCrash,
} from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════
// Types — mirrors the shapes already used on the Attendance dashboard so
// both pages read the same API responses the same way.
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
  SALARY?: number | null;
}

interface AttendanceRecord {
  EMP_ID: string;
  CREATEDAT: string;
  STATUS: AttendanceStatus;
  SHIFT: Shift | null;
  MARKED_BY?: string | null;
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

interface ShiftBucket {
  day?: AttendanceRecord;
  night?: AttendanceRecord;
}

// 'unconfigured' (no VITE_API_URL — a deploy/build problem) is kept distinct
// from 'error' (URL is set but the request failed — a runtime/network
// problem). Collapsing these into one state was fine for a demo page; in
// production they need different operator instructions, so they get
// different copy in the notice banner below.
type ConnectionStatus = 'unconfigured' | 'connecting' | 'live' | 'error';

// ════════════════════════════════════════════════════════════════════════
// Date helpers — IST-anchored
// ════════════════════════════════════════════════════════════════════════

const IST_TZ = 'Asia/Kolkata';

function getTodayISTKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(new Date());
}

function getISTDateKey(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(d);
}

function formatISTDateShort(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
}

function formatISTDateLong(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function weekdayShort(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short' });
}

function addDaysToKey(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(dt);
}

function keysInRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let cursor = fromKey;
  // Defensive cap — a factory roster page has no business rendering years of
  // columns; this stops a fat-fingered date range from hanging the tab.
  let guard = 0;
  while (cursor <= toKey && guard < 366) {
    out.push(cursor);
    cursor = addDaysToKey(cursor, 1);
    guard += 1;
  }
  return out;
}

/** First and last day of the month containing `dateKey`, as ISO date keys. */
function monthBoundsOf(dateKey: string): { from: string; to: string } {
  const [y, m] = dateKey.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** Every distinct (year, month0) pair a date range touches, so we know which
 *  monthly attendance calls to fire. */
function monthsTouchedByRange(fromKey: string, toKey: string): Array<{ year: number; month0: number }> {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  const out: Array<{ year: number; month0: number }> = [];
  let y = fy, m = fm - 1; // month0
  const endY = ty, endM0 = tm - 1;
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM0)) && guard < 36) {
    out.push({ year: y, month0: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    guard += 1;
  }
  return out;
}

function initials(name: string = ''): string {
  return (
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
  );
}

function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(amount);
}

// ════════════════════════════════════════════════════════════════════════
// Salary calculation
// ════════════════════════════════════════════════════════════════════════
//
// CONFIRMED RULE — every case below was explicitly checked against direct
// answers in spec discussion (9 anchors total, all passing, including a
// symmetry check that day/night order doesn't matter, only which shift
// carries the higher OT tier):
//
//   Not worked at all (both shifts absent/no record)  → 0x
//   One shift worked, tier T                          → 1 + bonus(T)
//       No OT → 1x · Half OT → 1.5x · Full OT → 2x
//   Both shifts worked                                → 2 + 2 × bonus(higher tier)
//       No+No       → 2 + 0   = 2x
//       Half+No     → 2 + 1   = 3x   (bonus(Half)=0.5, doubled = 1)
//       Half+Half   → 2 + 1   = 3x   (same as Half+No — confirmed explicitly)
//       Full+No     → 2 + 2   = 4x   (bonus(Full)=1, doubled = 2)
//       Full+Half   → 2 + 2   = 4x   (DERIVED, not explicitly confirmed —
//                                     follows the same "higher tier wins,
//                                     doubled" pattern as every confirmed
//                                     case, but this exact combo was never
//                                     asked about directly. Flagging so it
//                                     isn't mistaken for equally verified.)
//       Full+Full   → 2 + 2   = 4x
//
// In plain terms: for a two-shift day, the OT bonus is set ONCE — by
// whichever shift has the higher tier — and that bonus is applied as if
// BOTH shifts earned it (hence "doubled"), rather than each shift
// contributing its own independent bonus. An absent shift's OT_STATUS is
// ignored even if the field happens to be populated — only STATUS === 'P'
// shifts count toward "which tier is higher."
//
// This deliberately differs from the OLDER `dailyOtMultiplier` product-model
// used elsewhere in this codebase (day × night), which under-pays several
// of these confirmed cases (e.g. gives 1×1=1x for No+No instead of 2x). If
// that older function is updated to match, this file and that one should be
// pointed at one shared implementation — see note at bottom of file.
//
// ⚠ PRODUCTION NOTE (added during the demo→production pass, not part of the
// originally confirmed rule set above): this file and the Attendance
// dashboard will show DIFFERENT pay figures for the same employee/day until
// someone reconciles the two formulas. That was flagged as a "confirm
// before editing shared calc logic" item and deliberately left alone here
// — but it should not go live on two pages disagreeing with each other.
// Track this as a blocker, not a nice-to-have.

const FULL_DAY_DENOMINATOR = 30; // salary ÷ 30 = flat per-day rate

/** OT bonus for a single shift's tier: 0 / 0.5 / 1 for No/Half/Full OT.
 *  Returns null if the shift wasn't worked (absent or no record) — an
 *  absent shift cannot contribute to "which tier is higher" even if
 *  OT_STATUS happens to be set on the record. */
function shiftTierBonus(record: AttendanceRecord | null | undefined): number | null {
  if (!record) return null;
  if (record.STATUS !== 'P') return null;
  if (record.OT_STATUS === 'OT') return 1;
  if (record.OT_STATUS === 'HALF_OT') return 0.5;
  return 0; // 'NO_OT' or not yet chosen — worked, no bonus
}

/** Combined day+night multiplier for one employee on one date, per the
 *  confirmed rule above. 0 if neither shift was worked. */
function dayMultiplier(bucket: ShiftBucket): number {
  const dayBonus = shiftTierBonus(bucket.day);
  const nightBonus = shiftTierBonus(bucket.night);
  const dayWorked = dayBonus !== null;
  const nightWorked = nightBonus !== null;

  if (!dayWorked && !nightWorked) return 0;
  if (dayWorked && !nightWorked) return 1 + (dayBonus as number);
  if (!dayWorked && nightWorked) return 1 + (nightBonus as number);

  // Both shifts worked — base 2x plus double the higher tier's bonus.
  const higherBonus = Math.max(dayBonus as number, nightBonus as number);
  return 2 + 2 * higherBonus;
}

/** Employee's flat per-day rate, derived from monthly salary. Null if salary isn't on file. */
function dailyRate(salary: number | null | undefined): number | null {
  if (salary === null || salary === undefined) return null;
  return salary / FULL_DAY_DENOMINATOR;
}

/** One employee's full salary for one date (not just the OT bonus — the whole day's pay). */
function dailySalary(salary: number | null | undefined, bucket: ShiftBucket): number | null {
  const rate = dailyRate(salary);
  if (rate === null) return null;
  return rate * dayMultiplier(bucket);
}

// ════════════════════════════════════════════════════════════════════════
// API client
// ════════════════════════════════════════════════════════════════════════

const RAW_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;
const BASE_URL = (RAW_BASE_URL ?? '').replace(/\/+$/, '');

function hasApiBaseUrl(): boolean { return BASE_URL.length > 0; }
function getApiBaseUrl(): string { return BASE_URL; }

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

/** Fetches every month touched by [fromKey, toKey] and merges, de-duped by
 *  EMP_ID+CREATEDAT. The backend's /attendance/month endpoint is month-bound,
 *  so a range spanning a month boundary needs more than one call. */
async function fetchAttendanceForRange(fromKey: string, toKey: string): Promise<AttendanceRecord[]> {
  const months = monthsTouchedByRange(fromKey, toKey);
  const chunks = await Promise.all(months.map((m) => fetchMonthlyAttendance(m.year, m.month0)));
  const merged = chunks.flat();
  const seen = new Set<string>();
  const out: AttendanceRecord[] = [];
  for (const r of merged) {
    const key = `${r.EMP_ID}__${r.CREATEDAT}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Presentational atoms
// ════════════════════════════════════════════════════════════════════════

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-[12px] font-semibold text-zinc-600">
      {initials(name)}
    </div>
  );
}

const CONNECTION_MAP: Record<ConnectionStatus, { bg: string; text: string; dot: string; label: string }> = {
  unconfigured: { label: 'Not configured',    bg: 'bg-zinc-100',   text: 'text-zinc-500',    dot: 'bg-zinc-400'    },
  connecting:   { label: 'Connecting…',       bg: 'bg-amber-50',   text: 'text-amber-600',   dot: 'bg-amber-400'   },
  live:         { label: 'Live',              bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  error:        { label: 'Connection failed', bg: 'bg-rose-50',    text: 'text-rose-500',    dot: 'bg-rose-500'    },
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

interface StatItem { label: string; value: number; display?: string }
interface StatBlockProps { icon?: typeof Sun; label: string; accent: 'zinc' | 'amber'; items: StatItem[] }

const ACCENT_TEXT: Record<StatBlockProps['accent'], string> = { zinc: 'text-zinc-700', amber: 'text-amber-500' };

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

// ════════════════════════════════════════════════════════════════════════
// Compact per-day cell
// ════════════════════════════════════════════════════════════════════════

const SHIFT_GLYPH: Record<AttendanceStatus, { char: string; cls: string }> = {
  P: { char: 'P', cls: 'text-emerald-600' },
  A: { char: 'A', cls: 'text-rose-400' },
};

const OT_SUFFIX: Record<OtStatus, string> = { OT: '· Full', HALF_OT: '· Half', NO_OT: '' };

/** Renders one shift's status: "P · Full" (present, full OT), "P · Half"
 *  (present, half OT), "P" (present, no OT), "A" (absent — OT suffix
 *  intentionally omitted, since an absent shift cannot carry OT), or "–"
 *  (no record at all for this shift on this date). */
function ShiftGlyph({ record }: { record: AttendanceRecord | null | undefined }) {
  if (!record) return <span className="text-zinc-300">–</span>;
  const { char, cls } = SHIFT_GLYPH[record.STATUS];
  const suffix = record.STATUS === 'P' && record.OT_STATUS ? OT_SUFFIX[record.OT_STATUS] : '';
  return (
    <span className={cls}>
      {char}
      {suffix && <span className="text-amber-600">{suffix}</span>}
    </span>
  );
}

function DayCell({
  bucket, salary, isWeekendLike,
}: {
  bucket: ShiftBucket;
  salary: number | null | undefined;
  isWeekendLike: boolean;
}) {
  const salaryForDay = dailySalary(salary, bucket);
  const noSalaryOnFile = salary === null || salary === undefined;

  return (
    <div className={`flex min-w-[132px] flex-col items-center gap-1.5 rounded-lg px-3 py-3 ${isWeekendLike ? 'bg-zinc-50/60' : ''}`}>
      <div className="flex items-center gap-1.5 font-mono text-[15px] leading-none">
        <Sun size={14} className="text-amber-400" />
        <ShiftGlyph record={bucket.day} />
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[15px] leading-none">
        <Moon size={14} className="text-indigo-400" />
        <ShiftGlyph record={bucket.night} />
      </div>
      <div className={`mt-1 whitespace-nowrap border-t border-zinc-100 pt-1.5 font-mono text-[14px] font-semibold leading-none ${noSalaryOnFile ? 'italic text-zinc-300' : 'text-zinc-800'}`}>
        {noSalaryOnFile ? '—' : formatINR(Math.round(salaryForDay ?? 0))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Date range controls
// ════════════════════════════════════════════════════════════════════════

interface RangeControlsProps {
  fromKey: string;
  toKey: string;
  onFrom: (k: string) => void;
  onTo: (k: string) => void;
}

// Matches a full, well-formed YYYY-MM-DD date key with a plausible month
// (01-12) and day (01-31). This is intentionally loose about days-per-month
// (e.g. lets 02-31 through) — the calendar-correctness check right below
// catches genuinely invalid calendar dates, this regex just gatekeeps
// "is this even shaped like a date" first.
const DATE_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isValidDateKey(s: string): boolean {
  if (!DATE_KEY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A date field that's both typable (free-text YYYY-MM-DD entry, committed
 *  on blur or Enter) and pickable (calendar icon still opens the native
 *  date picker). Typing something invalid or incomplete never calls back
 *  out to the parent — on blur it just reverts to the last committed
 *  value, so `onChange` only ever fires with a real date key. */
function DateField({
  label, value, bound, boundType, onChange,
}: {
  label: string;
  value: string;
  bound: string;
  boundType: 'min' | 'max';
  onChange: (k: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Keep the typed draft in sync when the committed value changes from
  // outside (e.g. the other field's edit clamps this one, or a parent
  // resets the range).
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (isValidDateKey(trimmed)) {
      onChange(trimmed);
      setDraft(trimmed);
    } else {
      setDraft(value); // invalid/partial entry — revert, don't propagate
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-widest uppercase text-zinc-400">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 transition-colors focus-within:border-zinc-400 hover:border-zinc-400">
        <input
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
          }}
          className="w-[92px] border-0 bg-transparent p-0 font-mono text-sm text-zinc-800 outline-none placeholder:text-zinc-300"
          aria-label={`${label} date (type as YYYY-MM-DD)`}
        />
        {/* Visible calendar icon that opens the native date picker,
            kept alongside the typed field rather than hidden. Its value
            mirrors the committed value unless the current draft is
            itself a complete valid date, so the two controls never show
            conflicting dates mid-edit. */}
        <label className="relative flex shrink-0 cursor-pointer items-center">
          <CalendarDays size={13} className="pointer-events-none text-zinc-400" />
          <input
            type="date"
            value={isValidDateKey(draft) ? draft : value}
            {...(boundType === 'min' ? { min: bound } : { max: bound })}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(e.target.value);
              setDraft(e.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${label} date (pick from calendar)`}
          />
        </label>
      </div>
    </div>
  );
}

function RangeControls({ fromKey, toKey, onFrom, onTo }: RangeControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <DateField label="From" value={fromKey} bound={toKey} boundType="max" onChange={onFrom} />
      <DateField label="To" value={toKey} bound={fromKey} boundType="min" onChange={onTo} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Loading / empty / error states
// ════════════════════════════════════════════════════════════════════════

function SkeletonRows({ dayCount }: { dayCount: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <motion.tr key={`sk-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }} className="border-b border-zinc-50">
          <td className="sticky left-0 z-[1] bg-white px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-100 animate-pulse" />
              <div className="h-3 w-24 rounded bg-zinc-100 animate-pulse" />
            </div>
          </td>
          {Array.from({ length: Math.min(dayCount, 10) }).map((_, j) => (
            <td key={j} className="px-1.5 py-3"><div className="mx-auto h-12 w-16 rounded-md bg-zinc-100 animate-pulse" /></td>
          ))}
          <td className="sticky right-0 z-[1] bg-white px-4 py-3"><div className="h-4 w-16 rounded bg-zinc-100 animate-pulse" /></td>
        </motion.tr>
      ))}
    </>
  );
}

/** Shown when the request succeeded but returned zero employees for this
 *  range — a genuinely empty result, distinct from EmptyStateError below. */
function EmptyState() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center gap-2 py-16">
      <Users size={22} className="mb-1 text-zinc-300" />
      <p className="text-sm font-medium text-zinc-400">No employees to show for this range</p>
    </motion.div>
  );
}

/** Shown when data could not be loaded at all (misconfigured or
 *  unreachable API) — no rows to render, no salary figures to guess at.
 *  Replaces the old "fall back to demo data" behavior: on a production
 *  payroll page, showing a blank state is safer than showing numbers that
 *  aren't real. */
function EmptyStateError({ status, errorMessage, onRetry }: { status: ConnectionStatus; errorMessage: string; onRetry: () => void }) {
  const isUnconfigured = status === 'unconfigured';
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <ServerCrash size={22} className="mb-1 text-zinc-300" />
      <p className="text-sm font-medium text-zinc-600">
        {isUnconfigured ? 'Salary data source is not configured' : 'Could not load salary data'}
      </p>
      <p className="max-w-sm text-[12px] text-zinc-400">
        {isUnconfigured
          ? 'VITE_API_URL is not set for this deployment. Contact whoever manages the build config.'
          : `${errorMessage || 'The server did not respond.'} Confirm the API is running and reachable, then try again.`}
      </p>
      {!isUnconfigured && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-800"
        >
          Retry
        </button>
      )}
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Employee row
// ════════════════════════════════════════════════════════════════════════

function EmployeeSalaryRow({
  emp, index, days, attendanceByEmpByDay,
}: {
  emp: Employee;
  index: number;
  days: string[];
  attendanceByEmpByDay: Record<string, Record<string, ShiftBucket>>;
}) {
  const empBuckets = attendanceByEmpByDay[emp.EMP_ID] || {};
  const noSalaryOnFile = emp.SALARY === null || emp.SALARY === undefined;

  const rowTotal = useMemo(() => {
    if (noSalaryOnFile) return null;
    return days.reduce((sum, day) => sum + (dailySalary(emp.SALARY, empBuckets[day] || {}) ?? 0), 0);
  }, [days, empBuckets, emp.SALARY, noSalaryOnFile]);

  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.015, 0.3), ease: [0.16, 1, 0.3, 1] }}
      className="border-b border-zinc-50 hover:bg-zinc-50/60"
    >
      <td className="sticky left-0 z-[1] bg-white px-5 py-3 align-top">
        <div className="flex items-center gap-3">
          <Avatar name={`${emp.EMPNAME} ${emp.EMPFNAME}`} />
          <div>
            <div className="whitespace-nowrap text-[15px] font-medium text-zinc-800">{emp.EMPNAME} {emp.EMPFNAME}</div>
            <div className="whitespace-nowrap text-[13px] text-zinc-400">{emp.EMPDESG}</div>
          </div>
        </div>
      </td>

      {days.map((day) => (
        <td key={day} className="px-1.5 py-3 align-top">
          <DayCell bucket={empBuckets[day] || {}} salary={emp.SALARY} isWeekendLike={false} />
        </td>
      ))}

      <td className="sticky right-0 z-[1] bg-white px-4 py-3 align-top">
        <span className={`whitespace-nowrap font-mono text-[16px] font-semibold ${noSalaryOnFile ? 'italic text-zinc-300' : 'text-zinc-900'}`}>
          {noSalaryOnFile ? '—' : formatINR(Math.round(rowTotal ?? 0))}
        </span>
      </td>
    </motion.tr>
  );
}

/** A sticky-left group header row spanning the full table width, marking
 *  the start of one designation's block of rows. Shows the designation
 *  label, member count, and that group's pay subtotal for the current
 *  range — the day columns are left blank (a per-day breakdown at the
 *  group level would just repeat what's already visible per-employee
 *  below it). */
function DesignationGroupHeader({
  designation, memberCount, subtotal, dayCount,
}: {
  designation: string;
  memberCount: number;
  subtotal: number;
  dayCount: number;
}) {
  return (
    <tr className="border-b border-zinc-100 bg-zinc-100/70">
      <td className="sticky left-0 z-[1] bg-zinc-100/70 px-5 py-2 align-middle">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">{designation}</span>
        <span className="ml-2 text-[11px] font-normal text-zinc-400">
          {memberCount} {memberCount === 1 ? 'employee' : 'employees'}
        </span>
      </td>
      <td colSpan={dayCount} className="bg-zinc-100/70" />
      <td className="sticky right-0 z-[1] bg-zinc-100/70 px-4 py-2 align-middle">
        <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-zinc-600">
          {formatINR(Math.round(subtotal))}
        </span>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════

export default function SalaryChart() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(hasApiBaseUrl() ? 'connecting' : 'unconfigured');
  const [errorMessage, setErrorMessage] = useState('');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  const initialBounds = monthBoundsOf(getTodayISTKey());
  const [fromKey, setFromKey] = useState(initialBounds.from);
  const [toKey, setToKey] = useState(initialBounds.to);

  const load = useCallback(async (from: string, to: string) => {
    if (!hasApiBaseUrl()) {
      // No fallback to sample data here on purpose — an unconfigured API
      // URL on a production build should surface as a blocking state, not
      // quietly render numbers that look real but aren't.
      setConnectionStatus('unconfigured');
      setEmployees([]);
      setRecords([]);
      return;
    }
    setConnectionStatus('connecting');
    setErrorMessage('');
    try {
      const [empList, rangeRecords] = await Promise.all([
        fetchAllEmployees(),
        fetchAttendanceForRange(from, to),
      ]);
      setEmployees(empList);
      setRecords(rangeRecords);
      setConnectionStatus('live');
    } catch (err) {
      setConnectionStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not reach the server');
      setEmployees([]);
      setRecords([]);
    }
  }, []);

  useEffect(() => { load(fromKey, toKey); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fromKey, toKey]);

  const days = useMemo(() => keysInRange(fromKey, toKey), [fromKey, toKey]);
  const rangeTruncated = useMemo(() => {
    const raw = (() => {
      const [y1, m1, d1] = fromKey.split('-').map(Number);
      const [y2, m2, d2] = toKey.split('-').map(Number);
      const a = Date.UTC(y1, m1 - 1, d1), b = Date.UTC(y2, m2 - 1, d2);
      return Math.round((b - a) / 86400000) + 1;
    })();
    return raw > 366;
  }, [fromKey, toKey]);

  const attendanceByEmpByDay = useMemo(() => {
    const map: Record<string, Record<string, ShiftBucket>> = {};
    records.forEach((r) => {
      const dayKey = getISTDateKey(r.CREATEDAT);
      if (!map[r.EMP_ID]) map[r.EMP_ID] = {};
      if (!map[r.EMP_ID][dayKey]) map[r.EMP_ID][dayKey] = {};
      if (r.SHIFT === 'DAY') map[r.EMP_ID][dayKey].day = r;
      if (r.SHIFT === 'NIGHT') map[r.EMP_ID][dayKey].night = r;
    });
    return map;
  }, [records]);

  // Per-employee total, computed once and reused for both the row totals
  // and the sortable header — this is the same figure that used to live in
  // the standalone EmployeeWiseSummary widget; folding it in here means the
  // sort control and the row values can never drift apart, since they're
  // reading the same map instead of two separate calculations.
  const employeeTotals = useMemo(() => {
    const map = new Map<string, number | null>();
    employees.forEach((emp) => {
      const noSalaryOnFile = emp.SALARY === null || emp.SALARY === undefined;
      if (noSalaryOnFile) { map.set(emp.EMP_ID, null); return; }
      const empBuckets = attendanceByEmpByDay[emp.EMP_ID] || {};
      const total = days.reduce((sum, day) => sum + (dailySalary(emp.SALARY, empBuckets[day] || {}) ?? 0), 0);
      map.set(emp.EMP_ID, total);
    });
    return map;
  }, [employees, days, attendanceByEmpByDay]);

  // Employees are always grouped by designation (EMPDESG) — there's no
  // toggle for this, it's the only mode. Within each group, employees sort
  // by name; groups themselves sort alphabetically by designation label.
  // An empty/missing EMPDESG (shouldn't normally happen, but the field
  // isn't guaranteed non-empty by the type) is bucketed under
  // "Unspecified" rather than silently merged into another group or
  // dropped, and that bucket always sorts last regardless of where
  // "Unspecified" would fall alphabetically.
  const UNSPECIFIED_DESG = 'Unspecified';

  const groupedEmployees = useMemo(() => {
    const groups = new Map<string, Employee[]>();
    employees.forEach((emp) => {
      const desg = emp.EMPDESG?.trim() || UNSPECIFIED_DESG;
      if (!groups.has(desg)) groups.set(desg, []);
      groups.get(desg)!.push(emp);
    });
    groups.forEach((list) => list.sort((a, b) => a.EMPNAME.localeCompare(b.EMPNAME)));
    const designations = Array.from(groups.keys()).sort((a, b) => {
      if (a === UNSPECIFIED_DESG && b === UNSPECIFIED_DESG) return 0;
      if (a === UNSPECIFIED_DESG) return 1;
      if (b === UNSPECIFIED_DESG) return -1;
      return a.localeCompare(b);
    });
    return designations.map((designation) => ({ designation, members: groups.get(designation)! }));
  }, [employees]);

  // Flat list in group order — used for the empty-state check and anywhere
  // that just needs "all employees, grouped order" without caring about
  // the group boundaries themselves.
  const sortedEmployees = useMemo(
    () => groupedEmployees.flatMap((g) => g.members),
    [groupedEmployees]
  );

  // Per-designation subtotal, reusing the same employeeTotals map so a
  // group's subtotal and its members' individual totals can never drift
  // apart. Employees with no salary on file are excluded from the sum
  // (same "no data isn't zero" rule as grandTotal), but still counted
  // toward the group's headcount.
  const groupSubtotals = useMemo(() => {
    const map = new Map<string, number>();
    groupedEmployees.forEach(({ designation, members }) => {
      const sum = members.reduce((acc, emp) => acc + (employeeTotals.get(emp.EMP_ID) ?? 0), 0);
      map.set(designation, sum);
    });
    return map;
  }, [groupedEmployees, employeeTotals]);

  const grandTotal = useMemo(() => {
    let sum = 0;
    employeeTotals.forEach((v) => { if (v !== null) sum += v; });
    return sum;
  }, [employeeTotals]);

  const employeesWithPay = useMemo(
    () => employees.filter((e) => e.SALARY !== null && e.SALARY !== undefined).length,
    [employees]
  );

  // Per-day headcount — folded into each date column header instead of a
  // separate strip. Headcount, not payroll: an employee with no salary on
  // file still counts here, since presence and pay are separate facts.
  const dayWiseCounts = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((day) => {
      const presentCount = employees.reduce((count, emp) => {
        const bucket = attendanceByEmpByDay[emp.EMP_ID]?.[day];
        const wasPresent = bucket?.day?.STATUS === 'P' || bucket?.night?.STATUS === 'P';
        return wasPresent ? count + 1 : count;
      }, 0);
      map.set(day, presentCount);
    });
    return map;
  }, [days, employees, attendanceByEmpByDay]);

  const peakDay = useMemo(() => {
    let bestDay: string | null = null;
    let bestCount = -1;
    dayWiseCounts.forEach((count, day) => {
      if (count > bestCount) { bestDay = day; bestCount = count; }
    });
    return bestDay !== null ? { day: bestDay as string, count: bestCount } : null;
  }, [dayWiseCounts]);

  const isLoadingTable = connectionStatus === 'connecting' && records.length === 0 && employees.length === 0;
  const hasBlockingError = connectionStatus === 'unconfigured' || connectionStatus === 'error';
  const showTableContent = !isLoadingTable && !hasBlockingError;

  return (
    <div className="min-w-0 flex-1 p-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="mb-7">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Salary Chart</span>
          <span className="block h-px w-8 bg-zinc-300" />
          <span className="whitespace-nowrap text-[10px] font-mono text-zinc-400">
            {formatISTDateLong(fromKey)} – {formatISTDateLong(toKey)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Salary Distribution</h1>
          <div className="flex items-center gap-2">
            <ConnectionBadge status={connectionStatus} />
            <button onClick={() => load(fromKey, toKey)} className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700" aria-label="Refresh" title="Refresh">
              <RefreshCw size={15} className={connectionStatus === 'connecting' ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Connection notice — only shown for the live-but-degraded case now;
          unconfigured/error render as a full blocking state below instead
          of a banner-plus-fake-data combination. */}
      <AnimatePresence>
        {connectionStatus === 'connecting' && records.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}
            className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm shadow-sm"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-medium text-zinc-800">Refreshing…</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Loading salary data from {getApiBaseUrl()}.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {rangeTruncated && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>That date range is very large — showing the first 366 days only. Narrow the range for a complete view.</span>
        </div>
      )}

      {/* Range controls */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }} className="mb-5">
        <RangeControls
          fromKey={fromKey}
          toKey={toKey}
          onFrom={setFromKey}
          onTo={setToKey}
        />
      </motion.div>

      {/* Stat blocks — now also carries the busiest-day figure that used to
          live in the standalone DayWiseSummary widget's header. */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }} className="mb-5 flex flex-col gap-3 sm:flex-row">
        <StatBlock icon={Users} label="Roster" accent="zinc" items={[
          { label: 'On payroll', value: employeesWithPay },
          { label: 'Total staff', value: employees.length },
        ]} />
        <StatBlock icon={CalendarDays} label="Range" accent="zinc" items={[
          { label: 'Days covered', value: days.length },
          ...(peakDay ? [{ label: `Busiest (${formatISTDateShort(peakDay.day)})`, value: peakDay.count }] : []),
        ]} />
        <StatBlock icon={IndianRupee} label="Payout" accent="amber" items={[
          { label: 'Total for range', value: grandTotal, display: formatINR(Math.round(grandTotal)) },
        ]} />
      </motion.div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm" style={{ maxHeight: '65vh', scrollbarWidth: 'thin', scrollbarColor: '#e4e4e7 transparent' }}>
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-[220px] whitespace-nowrap border-b border-zinc-100 bg-zinc-50 px-5 py-4 text-left text-[11px] font-medium uppercase tracking-widest text-zinc-400">
                Employee
              </th>
              {days.map((day) => {
                const count = dayWiseCounts.get(day) ?? 0;
                const isFull = employees.length > 0 && count === employees.length;
                return (
                  <th key={day} className="sticky top-0 z-10 whitespace-nowrap border-b border-zinc-100 bg-zinc-50 px-3 py-3 text-center text-[11px] font-medium uppercase tracking-widest text-zinc-400">
                    <div className="text-[13px] normal-case text-zinc-600">{formatISTDateShort(day)}</div>
                    <div className="mt-0.5 font-normal text-[11px] normal-case text-zinc-400">{weekdayShort(day)}</div>
                    <div
                      className={`mt-1 whitespace-nowrap font-mono text-[10px] font-normal normal-case ${isFull ? 'text-emerald-600' : 'text-zinc-300'}`}
                      title={`${count} of ${employees.length} present`}
                    >
                      {count}/{employees.length} in
                    </div>
                  </th>
                );
              })}
              <th className="sticky right-0 top-0 z-20 min-w-[130px] whitespace-nowrap border-b border-zinc-100 bg-zinc-50 px-4 py-4 text-left text-[11px] font-medium uppercase tracking-widest text-zinc-400">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="wait">
              {isLoadingTable ? (
                <SkeletonRows key="sk" dayCount={days.length} />
              ) : showTableContent ? (
                groupedEmployees.flatMap(({ designation, members }) => [
                  <DesignationGroupHeader
                    key={`group-${designation}`}
                    designation={designation}
                    memberCount={members.length}
                    subtotal={groupSubtotals.get(designation) ?? 0}
                    dayCount={days.length}
                  />,
                  ...members.map((emp, i) => (
                    <EmployeeSalaryRow key={emp.EMP_ID} emp={emp} index={i} days={days} attendanceByEmpByDay={attendanceByEmpByDay} />
                  )),
                ])
              ) : null}
            </AnimatePresence>
          </tbody>
          {showTableContent && sortedEmployees.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50/80">
                <td className="sticky left-0 z-[1] bg-zinc-50/80 px-5 py-4 text-[14px] font-semibold uppercase tracking-wide text-zinc-600">
                  Total
                </td>
                <td colSpan={days.length} />
                <td className="sticky right-0 z-[1] bg-zinc-50/80 px-4 py-4">
                  <span className="whitespace-nowrap font-mono text-[18px] font-bold text-zinc-900">{formatINR(Math.round(grandTotal))}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        {hasBlockingError && (
          <EmptyStateError status={connectionStatus} errorMessage={errorMessage} onRetry={() => load(fromKey, toKey)} />
        )}
        {showTableContent && sortedEmployees.length === 0 && <EmptyState />}
      </div>

      {/* Legend */}
      {showTableContent && sortedEmployees.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><span className="font-mono text-emerald-600">P</span> Present</span>
          <span className="inline-flex items-center gap-1.5"><span className="font-mono text-rose-400">A</span> Absent</span>
          <span className="inline-flex items-center gap-1.5"><span className="font-mono text-amber-600">·H</span> Half OT</span>
          <span className="inline-flex items-center gap-1.5"><span className="font-mono text-amber-600">·F</span> Full OT</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-zinc-300">–</span> No record for that shift</span>
          <span className="inline-flex items-center gap-1.5"><span className="italic text-zinc-300">—</span> No salary on file</span>
          <span className="ml-auto whitespace-nowrap font-mono text-[10px]">Connected to {getApiBaseUrl()}</span>
        </motion.div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// NOTE for whoever wires this in:
//
// This file's `shiftTierBonus` / `dayMultiplier` / `dailySalary` implement
// the confirmed OT rule: single shift = 1 + bonus; both shifts worked =
// 2 + 2×(higher tier's bonus). The Attendance dashboard (AttendanceDashboard
// component) currently has its OWN older calculation — `shiftOtMultiplier` /
// `dailyOtMultiplier` / `extraOtPay` — which uses a PRODUCT model
// (day × night) instead, and only surfaces the "extra" bonus above baseline
// rather than the full day's salary. That older model gives wrong numbers
// for every two-shift case now confirmed here (e.g. No+No product = 1×1=1x,
// vs. the confirmed 2x).
//
// Left untouched here on purpose, since the OT formula was still being
// worked out mid-conversation and I didn't want to change the dashboard's
// existing numbers without a separate go-ahead. But the two pages will show
// DIFFERENT pay figures for the same employee/day until dashboard's OT math
// is updated to match this file (confirm before editing shared calc logic —
// straightforward to extract into one shared module once both sides agree).
//
// DEMO DATA REMOVED (this pass): DEMO_EMPLOYEES / buildDemoAttendance / the
// 'demo' connection state and its fallback branch in `load()` were deleted
// entirely. If VITE_API_URL is unset or a request fails, the page now shows
// a blocking empty/error state instead of rendering sample payroll numbers.
// If a staging or QA environment still wants seed data to click through,
// that's a job for the backend's seed script, not a client-side fallback
// baked into a page that also runs in production.
// ════════════════════════════════════════════════════════════════════════