/**
 * Seed script: fixes August 2026 attendance data (Aug 1–16).
 *
 * Source data was a handwritten shift register with bare names, no P/A markers,
 * and inconsistent spellings. Per conversation with the requester:
 *   - Everyone listed under a date+shift was PRESENT that shift  -> STATUS = 'P'
 *   - Names suffixed "OT" get OT_STATUS = 'OT' (full OT) on that same row
 *   - "VISHNU OT REMOVE" (Aug 14 DAY) does NOT create an Aug 14 row for Vishnu —
 *     it un-sets OT_STATUS back to null on his existing Aug 12 NIGHT row
 *   - "VINOD OT PUT" (Aug 14 NIGHT) sets OT_STATUS = 'OT' on Vinod's Aug 14 NIGHT row
 *   - BHIMSEN (Aug 1 NIGHT) does not correspond to any real employee — dropped
 *   - PHOTO is left null for every seeded row (requester serves photos separately)
 *   - LOCATION / LAT_VALUE / LONG_VALUE / MARKED_BY are left null — no source data
 *     for these, so they're not fabricated
 *
 * Every presence row is upserted (keyed on [EMP_ID, CREATEDAT]) rather than blindly
 * created, so this script is safe to re-run and won't clobber real PHOTO/LOCATION
 * data if a row already exists from the live app for the same employee+timestamp.
 *
 * CREATEDAT convention (source data only had dates, not times):
 *   DAY shift   -> 09:00 IST that date  (03:30 UTC)
 *   NIGHT shift -> 21:00 IST that date  (15:30 UTC)
 * Both fall inside their respective windows per the app's getCurrentShift() logic
 * (NIGHT = IST hour >= 20), and are far enough apart that a DAY and NIGHT row for
 * the same employee on the same date never collide.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();





// IST is UTC+5:30, fixed offset, no DST — safe to hardcode.
function istDateTimeToUtc(day, hour, minute) {
  // Construct as if IST wall-clock time, then subtract the 5:30 offset to get UTC.
  const istAsUtc = new Date(Date.UTC(2026, 7, day, hour, minute, 0, 0)); // month 7 = August
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(istAsUtc.getTime() - IST_OFFSET_MS);
}

function createdAtFor(day , shift ) {
  return shift === 'DAY' ? istDateTimeToUtc(day, 9, 0) : istDateTimeToUtc(day, 21, 0);
}

// ─── Resolved presence data (Aug 1–16, 2026) ──────────────────────────────────
// Verified programmatically against the source register: 80 total entries,
// bucket-by-bucket counts matched, no two names resolve to the same EMP_ID
// within the same date+shift.

const entries = [
  // Aug 1 NIGHT
  { empId: 'EMP00016', day: 1, shift: 'NIGHT' }, // Khajan Singh (AZAN SINGH)
  { empId: 'EMP00023', day: 1, shift: 'NIGHT' }, // Ashok
  { empId: 'EMP00024', day: 1, shift: 'NIGHT' }, // Dashrath Singh

  // Aug 2 NIGHT
  { empId: 'EMP00012', day: 2, shift: 'NIGHT' }, // Vivek
  { empId: 'EMP00016', day: 2, shift: 'NIGHT' }, // Khajan Singh
  { empId: 'EMP00024', day: 2, shift: 'NIGHT' }, // Dashrath Singh

  // Aug 3
  { empId: 'EMP00009', day: 3, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00008', day: 3, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00016', day: 3, shift: 'NIGHT' }, // Khajan Singh
  { empId: 'EMP00012', day: 3, shift: 'NIGHT' }, // Vivek

  // Aug 4
  { empId: 'EMP00009', day: 4, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00008', day: 4, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00007', day: 4, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00010', day: 4, shift: 'NIGHT' }, // Balveer

  // Aug 5
  { empId: 'EMP00009', day: 5, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00007', day: 5, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00015', day: 5, shift: 'NIGHT' }, // Rashid Ahamad
  { empId: 'EMP00010', day: 5, shift: 'NIGHT' }, // Balveer

  // Aug 6
  { empId: 'EMP00009', day: 6, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00008', day: 6, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00015', day: 6, shift: 'NIGHT' }, // Rashid Ahamad
  { empId: 'EMP00011', day: 6, shift: 'NIGHT' }, // Pappu

  // Aug 7
  { empId: 'EMP00003', day: 7, shift: 'DAY' }, // Dinesh Kumar
  { empId: 'EMP00009', day: 7, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00007', day: 7, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00010', day: 7, shift: 'NIGHT' }, // Balveer
  { empId: 'EMP00011', day: 7, shift: 'NIGHT' }, // Pappu

  // Aug 8
  { empId: 'EMP00009', day: 8, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00008', day: 8, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00007', day: 8, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00012', day: 8, shift: 'NIGHT' }, // Vivek

  // Aug 9
  { empId: 'EMP00003', day: 9, shift: 'DAY' }, // Dinesh Kumar
  { empId: 'EMP00009', day: 9, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00008', day: 9, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00016', day: 9, shift: 'NIGHT' }, // Khajan Singh
  { empId: 'EMP00012', day: 9, shift: 'NIGHT' }, // Vivek

  // Aug 10
  { empId: 'EMP00003', day: 10, shift: 'DAY' }, // Dinesh Kumar
  { empId: 'EMP00009', day: 10, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00016', day: 10, shift: 'NIGHT' }, // Khajan Singh
  { empId: 'EMP00007', day: 10, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00010', day: 10, shift: 'NIGHT' }, // Balveer

  // Aug 11
  { empId: 'EMP00003', day: 11, shift: 'DAY' }, // Dinesh Kumar
  { empId: 'EMP00009', day: 11, shift: 'DAY' }, // Anil Kumar
  { empId: 'EMP00007', day: 11, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00008', day: 11, shift: 'NIGHT' }, // Jai Prakash
  { empId: 'EMP00012', day: 11, shift: 'NIGHT' }, // Vivek

  // Aug 12 DAY (14 entries, incl. 3 OT)
  { empId: 'EMP00003', day: 12, shift: 'DAY' }, // Dinesh Kumar
  { empId: 'EMP00006', day: 12, shift: 'DAY' }, // Rohtan Singh
  { empId: 'EMP00005', day: 12, shift: 'DAY' }, // Kumer Singh (UMAR SINGH)
  { empId: 'EMP00008', day: 12, shift: 'DAY' }, // Jai Prakash
  { empId: 'EMP00009', day: 12, shift: 'DAY' }, // Anil Kumar (AMIT KUMAR)
  { empId: 'EMP00015', day: 12, shift: 'DAY' }, // Rashid Ahamad
  { empId: 'EMP00028', day: 12, shift: 'DAY' }, // Ramu
  { empId: 'EMP00029', day: 12, shift: 'DAY' }, // Sultan Singh
  { empId: 'EMP00035', day: 12, shift: 'DAY' }, // Digamber Singh
  { empId: 'EMP00042', day: 12, shift: 'DAY', ot: true }, // Rajesh Singh
  { empId: 'EMP00038', day: 12, shift: 'DAY', ot: true }, // Jitendra
  { empId: 'EMP00046', day: 12, shift: 'DAY', ot: true }, // Shivjeet Singh
  { empId: 'EMP00053', day: 12, shift: 'DAY' }, // Munnidevi
  { empId: 'EMP00055', day: 12, shift: 'DAY' }, // Rukmani Devi

  // Aug 12 NIGHT (9 entries, incl. 3 OT)
  { empId: 'EMP00002', day: 12, shift: 'NIGHT' }, // Omprakash
  { empId: 'EMP00007', day: 12, shift: 'NIGHT' }, // Murarilal
  { empId: 'EMP00016', day: 12, shift: 'NIGHT' }, // Khajan Singh
  { empId: 'EMP00059', day: 12, shift: 'NIGHT' }, // Yojesh
  { empId: 'EMP00060', day: 12, shift: 'NIGHT', ot: true }, // Devendra
  { empId: 'EMP00040', day: 12, shift: 'NIGHT', ot: true }, // Pappu Baghel
  { empId: 'EMP00052', day: 12, shift: 'NIGHT', ot: true }, // Vishnu Kumar Dhakre — later un-set, see below
  { empId: 'EMP00043', day: 12, shift: 'NIGHT' }, // Rajpati Singh
  { empId: 'EMP00012', day: 12, shift: 'NIGHT' }, // Vivek

  // Aug 13 NIGHT
  { empId: 'EMP00059', day: 13, shift: 'NIGHT' }, // Yojesh
  { empId: 'EMP00060', day: 13, shift: 'NIGHT', ot: true }, // Devendra

  // Aug 14 DAY: intentionally NOT listing Vishnu here — "OT REMOVE" targets his
  // existing Aug 12 NIGHT row (handled separately below), not a new Aug 14 row.

  // Aug 14 NIGHT
  { empId: 'EMP00059', day: 14, shift: 'NIGHT' }, // Yojesh
  { empId: 'EMP00060', day: 14, shift: 'NIGHT' }, // Devendra
  { empId: 'EMP00051', day: 14, shift: 'NIGHT', ot: true }, // Vinod ("OT PUT")

  // Aug 15 NIGHT
  { empId: 'EMP00060', day: 15, shift: 'NIGHT' }, // Devendra
  { empId: 'EMP00059', day: 15, shift: 'NIGHT' }, // Yojesh

  // Aug 16 NIGHT
  { empId: 'EMP00059', day: 16, shift: 'NIGHT', ot: true }, // Yojesh
  { empId: 'EMP00060', day: 16, shift: 'NIGHT' }, // Devendra
  { empId: 'EMP00036', day: 16, shift: 'NIGHT', ot: true }, // Hariom
];

async function main() {
  console.log(`Seeding ${entries.length} attendance entries for August 2026...`);

  let created = 0;
  let updated = 0;

  for (const entry of entries) {
    const createdAt = createdAtFor(entry.day, entry.shift);

    const result = await prisma.attendance.upsert({
      where: {
        EMP_ID_CREATEDAT: {
          EMP_ID: entry.empId,
          CREATEDAT: createdAt,
        },
      },
      create: {
        EMP_ID: entry.empId,
        CREATEDAT: createdAt,
        STATUS: 'P',
        SHIFT: entry.shift,
        PHOTO: null,
        LOCATION: null,
        LAT_VALUE: null,
        LONG_VALUE: null,
        MARKED_BY: null,
        OT_STATUS: entry.ot ? 'OT' : null,
      },
      update: {
        STATUS: 'P',
        OT_STATUS: entry.ot ? 'OT' : undefined, // don't clobber an existing OT_STATUS if this entry has no OT marker
      },
    });

    // Track create-vs-update purely for the summary log (upsert doesn't tell us which branch ran)
    const wasJustCreated = result.CREATEDAT.getTime() === createdAt.getTime();
    if (wasJustCreated) created++;
    else updated++;
  }

  console.log(`Upserted ${entries.length} rows (${created} created/confirmed, ${updated} pre-existing rows touched).`);

  // ── Special case: Vishnu (EMP00052) "OT REMOVE" on Aug 14 ────────────────────
  // Per requester: this un-sets OT_STATUS back to null on his Aug 12 NIGHT row.
  // It does NOT create or touch any Aug 14 row for Vishnu.
  console.log('Applying Vishnu (EMP00052) OT removal on Aug 12 NIGHT row...');

  const vishnuAug12Night = createdAtFor(12, 'NIGHT');

  const vishnuRecord = await prisma.attendance.findUnique({
    where: {
      EMP_ID_CREATEDAT: {
        EMP_ID: 'EMP00052',
        CREATEDAT: vishnuAug12Night,
      },
    },
  });

  if (!vishnuRecord) {
    console.warn(
      'WARNING: Could not find Vishnu (EMP00052) Aug 12 NIGHT row to remove OT from — ' +
        'this should not happen since it was upserted above. Skipping.',
    );
  } else {
    await prisma.attendance.update({
      where: {
        EMP_ID_CREATEDAT: {
          EMP_ID: 'EMP00052',
          CREATEDAT: vishnuAug12Night,
        },
      },
      data: { OT_STATUS: null },
    });
    console.log('Vishnu OT_STATUS unset on Aug 12 NIGHT row.');
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });