const {
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
  truncateText,
} = require("./common");
const { renderQueueClientScript } = require("./client-scripts");

function renderScheduleSettingsCard(scheduleSettings, esc) {
  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Schedule Ayarlari</div>
          <div class="settingsHelp">Bu alan kaydedilince queue'da bekleyen postlar yeni kurala gore yeniden schedule edilir.</div>
        </div>
        <div class="settingsMeta muted">
          <span data-schedule-summary>${esc(
            scheduleSettings.activeWindowText
          )} · ${esc(scheduleSettings.minPostIntervalMinutes)} dk</span>
          <span data-schedule-daily-limit>gunluk kapasite: ${esc(
            scheduleSettings.dailyLimit
          )}</span>
        </div>
      </div>

      <form id="scheduleSettingsForm" class="formGrid">
        <label class="field">
          <span class="label">Baslangic saati (0-23)</span>
          <input class="input" id="scheduleStartHour" name="activeStartHour" type="number" min="0" max="23" step="1" value="${esc(
            scheduleSettings.activeStartHour
          )}" />
        </label>
        <label class="field">
          <span class="label">Bitis saati (0-23)</span>
          <input class="input" id="scheduleEndHour" name="activeEndHour" type="number" min="0" max="23" step="1" value="${esc(
            scheduleSettings.activeEndHour
          )}" />
        </label>
        <label class="field">
          <span class="label">Paylasim araligi (dakika)</span>
          <input class="input" id="scheduleIntervalMinutes" name="minPostIntervalMinutes" type="number" min="5" max="1440" step="1" value="${esc(
            scheduleSettings.minPostIntervalMinutes
          )}" />
        </label>
      </form>

      <div class="actions" style="margin-top:0;">
        <button class="btn btnSave" type="submit" form="scheduleSettingsForm" data-schedule-submit>Kurali Kaydet</button>
      </div>
      <div id="scheduleSettingsMessage" class="message" aria-live="polite"></div>
    </div>
  `;
}

function renderQueueRow(row, helpers) {
  const { esc, fmtStatusPill, formatDateTR } = helpers;
  const text = row.text || "";
  const lastError = row.last_error || "";
  const inboxUrl = `/inbox?status=approved&queueView=queued&limit=200#draft-${encodeURIComponent(
    row.draft_id
  )}`;
  return `
    <tr data-queue-id="${esc(row.id)}">
      <td class="mono">${esc(row.id)}</td>
      <td class="mono"><a href="${esc(inboxUrl)}">${esc(row.draft_id)}</a></td>
      <td><span class="${fmtStatusPill(row.status)}">${esc(row.status)}</span></td>
      <td>${esc(formatDateTR(row.scheduled_at))}</td>
      <td class="mono">
        ${esc(row.tweet_id)}
        ${
          row.x_url
            ? `<div style="margin-top:8px;"><a href="${esc(
                row.x_url
              )}" target="_blank" rel="noopener noreferrer">Kaynak X</a></div>`
            : ""
        }
      </td>
      <td>${esc(row.viral_score ?? "-")}</td>
      <td class="tableText">
        <details class="detailsBox">
          <summary class="mono">${esc(truncateText(text, 120) || "-")}</summary>
          <div class="detailsBody mono">${esc(text || "-")}</div>
        </details>
        ${
          lastError
            ? `<details class="detailsBox" style="margin-top:8px;">
                <summary class="muted">last_error</summary>
                <div class="detailsBody mono">${esc(lastError)}</div>
              </details>`
            : ""
        }
      </td>
      <td class="mono">${esc(row.attempts ?? 0)}</td>
      <td>
        <div class="tableActions">
          ${
            row.status === "waiting"
              ? `<button class="btn btnCancel" data-action="cancel-queue" data-queue-id="${esc(
                  row.id
                )}">Iptal</button>`
              : ""
          }
        </div>
      </td>
    </tr>
  `;
}

function renderQueuePage({ rows, dashboard, helpers, limit }) {
  const { esc } = helpers;
  const scheduleSettings = dashboard.scheduleSettings;
  const body = `
    ${renderTopBar(
      {
        title: "Queue UI",
        subtitle: "Bekleyen, islenen ve hata alan queue kayitlari",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources UI" },
          { href: "/collector-ui", label: "Collector UI" },
          { href: "/queue", label: "Queue JSON", targetBlank: true },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        { label: "Bugun scheduled", value: dashboard.todayScheduled },
        { label: "Siradaki bos slot", value: dashboard.nextSlotText, compact: true },
        { label: "Kalan slot", value: dashboard.remainingSlots },
        { label: "Gunluk limit", value: dashboard.dailyLimit },
      ],
      esc
    )}

    <div id="queueFlash" class="flash"></div>

    ${scheduleSettings ? renderScheduleSettingsCard(scheduleSettings, esc) : ""}

    <div class="toolbar">
      ${renderLimitPicker({ basePath: "/queue-ui", currentLimit: limit }, esc)}
    </div>

    <div class="card compact">
      <table class="statusTable">
        <thead>
          <tr>
            <th>queue_id</th>
            <th>draft_id</th>
            <th>status</th>
            <th>scheduled_at</th>
            <th>tweet_id</th>
            <th>viral</th>
            <th>text / error</th>
            <th>attempts</th>
            <th>islem</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderQueueRow(row, helpers)).join("")}
        </tbody>
      </table>
    </div>

    <div id="queueEmptyState" class="emptyState ${rows.length > 0 ? "hidden" : ""}">
      Queue bos.
    </div>
  `;

  return renderPageShell("Queue UI", body, renderQueueClientScript(), {
    writeTokenRequired: !!helpers.writeTokenRequired,
  });
}

module.exports = {
  renderQueuePage,
};
