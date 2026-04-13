/**
 * Paylasim penceresi (aktif saatler) — her zaman Europe/Istanbul (GMT+3).
 * Sunucu UTC'de olsa bile poster-worker ve queue scheduling ayni mantigi kullanir.
 *
 * Ortam: POSTER_SCHEDULE_TZ (varsayilan Europe/Istanbul)
 */
require("dotenv").config();

const POSTER_SCHEDULE_TZ = process.env.POSTER_SCHEDULE_TZ || "Europe/Istanbul";

function toLocalParts(date, timeZone) {
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
  let d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0));
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

  if (s === e) return true;
  if (s < e) {
    return cur >= s && cur < e;
  }
  return cur >= s || cur < e;
}

function nextAllowedTime(dateUTC, start, end, timeZone) {
  if (isInActiveWindow(dateUTC, start, end, timeZone)) return dateUTC;

  const lp = toLocalParts(dateUTC, timeZone);
  const curMin = lp.hour * 60 + lp.minute;
  const sMin = start.hh * 60 + start.mm;
  const eMin = end.hh * 60 + end.mm;

  let targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };

  if (sMin < eMin) {
    if (curMin < sMin) {
      targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };
    } else {
      const tmp = new Date(Date.UTC(lp.year, lp.month - 1, lp.day, 12, 0, 0));
      tmp.setUTCDate(tmp.getUTCDate() + 1);
      const tp = toLocalParts(tmp, timeZone);
      targetLocalDate = { year: tp.year, month: tp.month, day: tp.day };
    }
  } else {
    if (curMin >= eMin && curMin < sMin) {
      targetLocalDate = { year: lp.year, month: lp.month, day: lp.day };
    } else {
      const tmp = new Date(Date.UTC(lp.year, lp.month - 1, lp.day, 12, 0, 0));
      tmp.setUTCDate(tmp.getUTCDate() + 1);
      const tp = toLocalParts(tmp, timeZone);
      targetLocalDate = { year: tp.year, month: tp.month, day: tp.day };
    }
  }

  return makeDateInTZ(targetLocalDate, start.hh, start.mm, timeZone);
}

function hourWindowFromSettings(settings) {
  return {
    start: { hh: settings.activeStartHour, mm: 0 },
    end: { hh: settings.activeEndHour, mm: 0 },
  };
}

function isWithinActiveWindowTz(scheduleSettings, dateUTC, timeZone = POSTER_SCHEDULE_TZ) {
  const w = hourWindowFromSettings(scheduleSettings);
  if (w.start.hh === w.end.hh && w.start.mm === w.end.mm) return true;
  return isInActiveWindow(new Date(dateUTC), w.start, w.end, timeZone);
}

function normalizeToActiveWindowTz(scheduleSettings, dateUTC, timeZone = POSTER_SCHEDULE_TZ) {
  const w = hourWindowFromSettings(scheduleSettings);
  if (w.start.hh === w.end.hh && w.start.mm === w.end.mm) return new Date(dateUTC);
  const d = new Date(dateUTC);
  if (isInActiveWindow(d, w.start, w.end, timeZone)) return d;
  return nextAllowedTime(d, w.start, w.end, timeZone);
}

function minutesUntilNextActiveWindowTz(
  scheduleSettings,
  dateUTC = new Date(),
  timeZone = POSTER_SCHEDULE_TZ
) {
  const w = hourWindowFromSettings(scheduleSettings);
  if (w.start.hh === w.end.hh && w.start.mm === w.end.mm) return 0;
  const d = new Date(dateUTC);
  if (isInActiveWindow(d, w.start, w.end, timeZone)) return 0;
  const next = nextAllowedTime(d, w.start, w.end, timeZone);
  return Math.max(1, Math.ceil((next.getTime() - d.getTime()) / 60000));
}

module.exports = {
  POSTER_SCHEDULE_TZ,
  toLocalParts,
  makeDateInTZ,
  isInActiveWindow,
  nextAllowedTime,
  isWithinActiveWindowTz,
  normalizeToActiveWindowTz,
  minutesUntilNextActiveWindowTz,
};
