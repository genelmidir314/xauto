const {
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderSourcesClientScript } = require("./client-scripts");

function renderResolveStatusPill(status, esc) {
  const normalized = String(status || "pending");
  const cls =
    normalized === "resolved"
      ? "pill approved"
      : normalized === "failed"
        ? "pill rejected"
        : "pill pending";
  return `<span class="${cls}">${esc(normalized)}</span>`;
}

function renderSourcesCard(sources, tierCheckIntervals, helpers) {
  const { esc, formatDateTR } = helpers;
  const rows = (sources || [])
    .map((source) => {
      return `
        <tr data-source-id="${esc(source.id)}">
          <td class="mono">@${esc(source.handle)}</td>
          <td>
            <select class="input" data-source-field="tier">
              ${[1, 2, 3]
                .map(
                  (tier) => `<option value="${tier}" ${
                    Number(source.tier) === tier ? "selected" : ""
                  }>Tier ${tier}</option>`
                )
                .join("")}
            </select>
          </td>
          <td>
            <input class="input" data-source-field="category" type="text" value="${esc(
              source.category || ""
            )}" placeholder="kategori" />
          </td>
          <td>
            <label class="muted" style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" data-source-field="active" ${
                source.active ? "checked" : ""
              } />
              aktif
            </label>
          </td>
          <td>${renderResolveStatusPill(source.resolve_status, esc)}</td>
          <td class="muted" data-source-next-check>${esc(formatDateTR(source.next_check_at))}</td>
          <td class="muted" data-source-last-check>${esc(formatDateTR(source.last_checked_at))}</td>
          <td class="muted mono">${esc(source.last_tweet_id || "-")}</td>
          <td>
            <button class="btn btnSave" type="button" data-action="save-source">Kaydet</button>
            <button class="btn" type="button" data-action="check-source-now">Check now</button>
            <button class="btn btnReject" type="button" data-action="delete-source">Sil</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Kaynak / Tier List</div>
          <div class="settingsHelp">Yeni source eklemek icin sadece username gir. X user id collector sirasinda lazy resolve edilir, boylece ekleme aninda API kredisi tuketilmez.</div>
        </div>
        <div class="settingsMeta muted">
          <span>Tier 1: ${esc(tierCheckIntervals[1])} dk</span>
          <span>Tier 2: ${esc(tierCheckIntervals[2])} dk</span>
          <span>Tier 3: ${esc(tierCheckIntervals[3])} dk</span>
        </div>
      </div>

      <form id="sourceAddForm" class="formGrid">
        <label class="field">
          <span class="label">Kullanici adi</span>
          <input class="input" id="sourceHandle" name="handle" type="text" placeholder="orn: ylecun" />
        </label>
        <label class="field">
          <span class="label">Tier</span>
          <select class="input" id="sourceTier" name="tier">
            <option value="1">Tier 1</option>
            <option value="2" selected>Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Kategori</span>
          <input class="input" id="sourceCategory" name="category" type="text" placeholder="opsiyonel" />
        </label>
      </form>

      <div class="actions" style="margin-top:0;">
        <button class="btn btnSave" type="submit" form="sourceAddForm" data-source-submit>Kaynak Ekle</button>
      </div>
      <div id="sourceMessage" class="message" aria-live="polite"></div>

      <div class="card compact" style="margin-top:0;">
        <table class="statusTable">
          <thead>
            <tr>
              <th>handle</th>
              <th>tier</th>
              <th>kategori</th>
              <th>aktif</th>
              <th>resolve</th>
              <th>next_check_at</th>
              <th>last_checked_at</th>
              <th>last_tweet_id</th>
              <th>islem</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="9">Kaynak yok.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSourceSummaryCard(collectorMetrics, helpers) {
  const { esc } = helpers;
  const totals = collectorMetrics?.totals || {};
  const invalidMediaSources = Array.isArray(collectorMetrics?.invalidMediaSources)
    ? collectorMetrics.invalidMediaSources
    : [];

  return `
    <div class="row">
      <div class="card compact">
        <div class="label">Resolve ozeti</div>
        <div class="stack">
          <div class="meta"><span>resolved</span><b>${esc(totals.resolved_sources ?? 0)}</b></div>
          <div class="meta"><span>pending</span><b>${esc(totals.pending_sources ?? 0)}</b></div>
          <div class="meta"><span>failed</span><b>${esc(totals.failed_sources ?? 0)}</b></div>
        </div>
      </div>
      <div class="card compact">
        <div class="label">En cok invalid medya ureten source'lar</div>
        ${
          invalidMediaSources.length
            ? `<div class="stack">${invalidMediaSources
                .map(
                  (item) => `
              <div class="meta">
                <div class="mono">@${esc(item.handle)}</div>
                <div class="muted">invalid tweet: ${esc(item.invalid_tweets)}</div>
              </div>
            `
                )
                .join("")}</div>`
            : `<div class="muted">Invalid medya ureten source kaydi yok.</div>`
        }
      </div>
    </div>
  `;
}

function renderSourcesPage({ sources, tierCheckIntervals, collectorMetrics, helpers, limit }) {
  const { esc } = helpers;
  const totals = collectorMetrics?.totals || {};
  const body = `
    ${renderTopBar(
      {
        title: "Sources UI",
        subtitle: "Tier, aktiflik ve collector kaynak yonetimi",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/collector-ui", label: "Collector UI" },
          { href: "/history-ui", label: "History UI" },
          { href: "/sources", label: "Sources JSON", targetBlank: true },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        { label: "Toplam source", value: totals.total_sources ?? 0 },
        { label: "Aktif source", value: totals.active_sources ?? 0 },
        { label: "Cached user id", value: totals.cached_sources ?? 0 },
        { label: "Invalid medya", value: totals.invalid_tweets ?? 0 },
      ],
      esc
    )}

    <div class="toolbar">
      ${renderLimitPicker({ basePath: "/sources-ui", currentLimit: limit }, esc)}
    </div>

    ${renderSourceSummaryCard(collectorMetrics, helpers)}
    ${renderSourcesCard(sources, tierCheckIntervals, helpers)}
  `;

  return renderPageShell("Sources UI", body, renderSourcesClientScript());
}

module.exports = {
  renderSourcesPage,
};
