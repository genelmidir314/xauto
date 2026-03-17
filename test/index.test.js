const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  computeActiveWindowMinutes,
  computeDailyLimit,
  formatHourLabel,
  getIntervalForSlot,
  parsePostIntervals,
  toPublicScheduleSettings,
  validateScheduleSettingsInput,
} = require("../schedule-settings");
const {
  composeDraftText,
  isSourceLinkFallbackFormat,
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
} = require("../draft-format");
const {
  clampTier,
  normalizeHandle,
  getTierCheckIntervalMinutes,
  computeNextCheckAt,
  validateSourceInput,
} = require("../source-tier");

describe("schedule-settings", () => {
  it("formatHourLabel pads single digit", () => {
    assert.strictEqual(formatHourLabel(6), "06:00");
    assert.strictEqual(formatHourLabel(23), "23:00");
  });

  it("computeActiveWindowMinutes: same hour = 24h", () => {
    assert.strictEqual(computeActiveWindowMinutes({ activeStartHour: 0, activeEndHour: 0 }), 24 * 60);
  });

  it("computeActiveWindowMinutes: normal window", () => {
    assert.strictEqual(computeActiveWindowMinutes({ activeStartHour: 6, activeEndHour: 22 }), 16 * 60);
  });

  it("computeActiveWindowMinutes: wrap midnight", () => {
    assert.strictEqual(computeActiveWindowMinutes({ activeStartHour: 22, activeEndHour: 6 }), 8 * 60);
  });

  it("computeDailyLimit uses min interval (single)", () => {
    const s = { activeStartHour: 6, activeEndHour: 22, minPostIntervalMinutes: 60 };
    assert.strictEqual(computeDailyLimit(s), 16);
  });

  it("computeDailyLimit uses average for multi-interval", () => {
    const s = { activeStartHour: 6, activeEndHour: 22, postIntervalMinutes: [17, 21, 15, 16] };
    const activeMinutes = 16 * 60;
    const avgInterval = (17 + 21 + 15 + 16) / 4;
    assert.strictEqual(computeDailyLimit(s), Math.floor(activeMinutes / avgInterval));
  });

  it("getIntervalForSlot cycles through intervals", () => {
    const intervals = [17, 21, 15, 16];
    assert.strictEqual(getIntervalForSlot(intervals, 0), 17);
    assert.strictEqual(getIntervalForSlot(intervals, 1), 21);
    assert.strictEqual(getIntervalForSlot(intervals, 2), 15);
    assert.strictEqual(getIntervalForSlot(intervals, 3), 16);
    assert.strictEqual(getIntervalForSlot(intervals, 4), 17);
    assert.strictEqual(getIntervalForSlot(intervals, 5), 21);
  });

  it("parsePostIntervals from array", () => {
    assert.deepStrictEqual(parsePostIntervals({ post_interval_minutes: [17, 21, 15, 16] }), [17, 21, 15, 16]);
  });

  it("parsePostIntervals fallback to min when array null", () => {
    assert.deepStrictEqual(parsePostIntervals({ min_post_interval_minutes: 57 }), [57]);
  });

  it("toPublicScheduleSettings returns dailyLimit and activeWindowText", () => {
    const out = toPublicScheduleSettings({ active_start_hour: 6, active_end_hour: 22, min_post_interval_minutes: 60 });
    assert.strictEqual(out.activeWindowText, "06:00-22:00");
    assert.strictEqual(out.dailyLimit, 16);
  });

  it("validateScheduleSettingsInput throws on bad input", () => {
    assert.throws(() => validateScheduleSettingsInput({ activeStartHour: 25 }), /Baslangic saati/);
    assert.throws(() => validateScheduleSettingsInput({ activeStartHour: 6, activeEndHour: 22 }), /Paylasim araligi bos/);
  });

  it("validateScheduleSettingsInput accepts postIntervalMinutes array", () => {
    const out = validateScheduleSettingsInput({
      activeStartHour: 6,
      activeEndHour: 22,
      postIntervalMinutes: [17, 21, 15, 16],
    });
    assert.deepStrictEqual(out.postIntervalMinutes, [17, 21, 15, 16]);
  });

  it("validateScheduleSettingsInput accepts postIntervalMinutes string", () => {
    const out = validateScheduleSettingsInput({
      activeStartHour: 6,
      activeEndHour: 22,
      postIntervalMinutes: "17, 21, 15, 16",
    });
    assert.deepStrictEqual(out.postIntervalMinutes, [17, 21, 15, 16]);
  });
});

describe("draft-format", () => {
  it("isSourceLinkFallbackFormat", () => {
    assert.strictEqual(isSourceLinkFallbackFormat(COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY), true);
    assert.strictEqual(isSourceLinkFallbackFormat(COMMENT_TRANSLATION_FORMAT_KEY), false);
  });

  it("composeDraftText: comment + translation", () => {
    assert.strictEqual(
      composeDraftText("yorum", "ceviri", COMMENT_TRANSLATION_FORMAT_KEY, null),
      "yorum\n\nceviri"
    );
  });

  it("composeDraftText: source link fallback", () => {
    assert.strictEqual(
      composeDraftText("yorum", "ceviri", COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY, "https://x.com/foo/status/1"),
      "yorum\n\nceviri\n\nhttps://x.com/foo/status/1"
    );
  });

  it("composeDraftText: only translation", () => {
    assert.strictEqual(
      composeDraftText("", "ceviri", COMMENT_TRANSLATION_FORMAT_KEY, null),
      "ceviri"
    );
  });
});

describe("source-tier", () => {
  it("clampTier", () => {
    assert.strictEqual(clampTier(1), 1);
    assert.strictEqual(clampTier(2), 2);
    assert.strictEqual(clampTier(3), 3);
    assert.strictEqual(clampTier(0), 1);
    assert.strictEqual(clampTier(5), 3);
    assert.strictEqual(clampTier(NaN), 2);
  });

  it("normalizeHandle", () => {
    assert.strictEqual(normalizeHandle("@FooBar"), "foobar");
    assert.strictEqual(normalizeHandle("  user  "), "user");
  });

  it("getTierCheckIntervalMinutes", () => {
    assert.strictEqual(getTierCheckIntervalMinutes(1), 15);
    assert.strictEqual(getTierCheckIntervalMinutes(2), 60);
    assert.strictEqual(getTierCheckIntervalMinutes(3), 180);
  });

  it("computeNextCheckAt adds interval", () => {
    const from = new Date("2026-01-01T12:00:00Z");
    const next = computeNextCheckAt(2, from);
    assert.strictEqual(next.getTime() - from.getTime(), 60 * 60 * 1000);
  });

  it("validateSourceInput rejects empty handle", () => {
    assert.throws(() => validateSourceInput({ handle: "" }), /Kullanici adi bos/);
  });

  it("validateSourceInput returns normalized object", () => {
    const out = validateSourceInput({ handle: "@Test", tier: 1 });
    assert.strictEqual(out.handle, "test");
    assert.strictEqual(out.tier, 1);
    assert.strictEqual(out.active, true);
  });
});
