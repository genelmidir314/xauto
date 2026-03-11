// bulk-queue-window.js
// Amaç: Draft'ları sadece belirli saat aralığında (06:00-01:00) queue'ya dizmek.
// Örnek:
// node bulk-queue-window.js --status=pending --count=20 --gapMin=57 --start=06:00 --end=01:00 --tz=Europe/Istanbul
//
// Notlar:
// - end=01:00 demek: aktif pencere gece yarısını aşar (06:00 -> 01:00 ertesi gün)
// - queue tablosundaki en son scheduled_at'i dikkate alır, üstüne ekler.
// - Seçilen draft'ları queue tablosuna ekler; draft status'u ayni kalir.

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ----------------- utils -----------------
function getArg(name, fallback) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseHHMM(s, fallback) {
  if (!s) return fallback;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return { hh, mm };
}

function toLocalParts(date, timeZone) {
  // Returns {year,month,day,hour,minute,second} in given TZ
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function makeDateInTZ(parts, hh, mm, timeZone) {
  // Create a UTC Date corresponding to the local date (parts.year-month-day) at hh:mm in timeZone.
  // Approach: build an ISO-like string and let Date parse as UTC offset? Can't.
  // We'll approximate by taking a UTC date at that local wall time by shifting via Intl.
  // Safe method: start with UTC date at same Y-M-D hh:mm, then adjust until its local parts match desired.
  let d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0));
  // Iterate small adjustments to match local hh:mm (DST safe enough for Istanbul; still works generally)
  for (let i = 0; i < 6; i++) {
    const lp = toLocalParts(d, timeZone);
    const deltaMin = (lp.hour - hh) * 60 + (lp.minute - mm);
    if (deltaMin === 0) break;
    d = new Date(d.getTime() - deltaMin * 60 * 1000);
  }
  return d;
}

function isInActiveWindow(dateUTC, start, end, timeZone) {
  const lp = toLocalParts(dateUTC, timeZone);
  const cur = lp.hour * 60 + lp.minute;
  const s = start.hh * 60 + start.mm;
  const e = end.hh * 60 + end.mm;

  if (s === e) return true; // 24h open
  if (s < e) {
    // normal window same day (e.g., 08:00-22:00)
    return cur >= s && cur < e;
  }
  // crosses midnight (e.g., 06:00-01:00)
  return cur >= s || cur < e;
}

function nextAllowedTime(dateUTC, start, end, timeZone) {
  // If dateUTC already in window => return dateUTC
  if (isInActiveWindow(dateUTC, start, end, timeZone)) return dateUTC;

  // Otherwise move to next start time in TZ.
  const lp = toLocalParts(dateUTC, timeZone);
  const curMin = lp.hour * 60 + lp.minute;
  const sMin = start.hh * 60 + start.mm;
  const eMin = end.hh * 60 + end.mm;

  // Determine whether next start is today or tomorrow in local date
  // For crossing-midnight window (06:00-01:00), inactive is [01:00,06:00)
  // For normal window, inactive is [end,start) across day boundaries.
  let targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };

  if (sMin < eMin) {
    // normal window
    if (curMin < sMin) {
      // before start today -> start today
      targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };
    } else {
      // after end -> start tomorrow
      const tmp = new Date(Date.UTC(lp.year, lp.month - 1, lp.day, 12, 0, 0));
      tmp.setUTCDate(tmp.getUTCDate() + 1);
      const tp = toLocalParts(tmp, timeZone);
      targetLocalDate = { year: tp.year, month: tp.month, day: tp.day };
    }
  } else {
    // crosses midnight (our case 06:00-01:00)
    // inactive window is from end -> start (01:00 -> 06:00)
    // If current is between end and start, next start is today at start (06:00)
    // Otherwise it's already active (handled above)
    // Here means inactive: cur in [end, start)
    if (curMin >= eMin && curMin < sMin) {
      targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };
    } else {
      // should not happen because active handled, but fallback: start tomorrow
      const tmp = new Date(Date.UTC(lp.year, lp.month - 1, lp.day, 12, 0, 0));
      tmp.setUTCDate(tmp.getUTCDate() + 1);
      const tp = toLocalParts(tmp, timeZone);
      targetLocalDate = { year: tp.year, month: tp.month, day: tp.day };
    }
  }

  const base = makeDateInTZ(targetLocalDate, start.hh, start.mm, timeZone);
  return base;
}

function addMinutes(dateUTC, minutes) {
  return new Date(dateUTC.getTime() + minutes * 60 * 1000);
}

function withinWindowOrRoll(dateUTC, start, end, timeZone) {
  // If after adding gap we fall into sleep window, roll forward to next start.
  if (isInActiveWindow(dateUTC, start, end, timeZone)) return dateUTC;
  return nextAllowedTime(dateUTC, start, end, timeZone);
}

// ----------------- main -----------------
async function run() {
  const status = String(getArg("status", "pending")).toLowerCase(); // pending|approved
  const count = clampInt(getArg("count", "20"), 1, 500, 20);
  const gapMin = clampInt(getArg("gapMin", "57"), 5, 240, 57);

  const tz = String(getArg("tz", "Europe/Istanbul"));
  const start = parseHHMM(getArg("start", "06:00"), { hh: 6, mm: 0 });
  const end = parseHHMM(getArg("end", "01:00"), { hh: 1, mm: 0 });

  if (!["pending", "approved"].includes(status)) {
    console.error("❌ --status sadece pending veya approved olabilir.");
    process.exit(1);
  }

  console.log(
    `✅ Bulk queue (window) başlıyor: status=${status} count=${count} gapMin=${gapMin} window=${getArg(
      "start",
      "06:00"
    )}-${getArg("end", "01:00")} tz=${tz}`
  );

  // Find last scheduled item in queue (waiting)
  const lastQ = await pool.query(
    `SELECT scheduled_at
     FROM queue
     WHERE status='waiting'
     ORDER BY scheduled_at DESC
     LIMIT 1`
  );

  let base = new Date(); // now UTC
  if (lastQ.rowCount === 1 && lastQ.rows[0].scheduled_at) {
    const t = new Date(lastQ.rows[0].scheduled_at);
    if (t.getTime() > base.getTime()) base = t;
  }

  // Ensure base is in allowed window (or move to next start)
  base = nextAllowedTime(base, start, end, tz);

  // fetch drafts
  const drafts = await pool.query(
    `SELECT d.id
     FROM drafts d
     WHERE d.status=$1
       AND NOT EXISTS (
         SELECT 1
         FROM queue q
         WHERE q.draft_id = d.id
       )
     ORDER BY created_at ASC
     LIMIT $2`,
    [status, count]
  );

  console.log("✅ Aday draft:", drafts.rowCount);
  if (drafts.rowCount === 0) {
    await pool.end();
    return;
  }

  let queued = 0;
  let scheduled = base;

  for (let i = 0; i < drafts.rows.length; i++) {
    const draftId = drafts.rows[i].id;

    // For first item, use scheduled; for next, add gap then roll if needed.
    if (i === 0) {
      scheduled = withinWindowOrRoll(scheduled, start, end, tz);
    } else {
      scheduled = addMinutes(scheduled, gapMin);
      scheduled = withinWindowOrRoll(scheduled, start, end, tz);
    }

    await pool.query(
      `INSERT INTO queue (draft_id, scheduled_at, status)
       VALUES ($1, $2, 'waiting')`,
      [draftId, scheduled]
    );

    queued++;
    console.log(`⏱️ queued draft_id=${draftId} at ${scheduled.toISOString()}`);
  }

  console.log(`🚀 Bitti. queued=${queued}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ bulk-queue-window hata:", e);
  process.exit(1);
});