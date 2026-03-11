const {
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderCollectorClientScript } = require("./client-scripts");

function ratio(numerator, denominator) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  if (!d) return "0.00";
  return (n / d).toFixed(2);
}

function renderRecentRunsCard(collectorMetrics, helpers) {
  const { esc, formatDateTR } = helpers;
  const recentRuns = Array.isArray(collectorMetrics?.recentRuns)
    ? collectorMetrics.recentRuns
    : [];

  return `
    <div class="card">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Collector Trend</div>
          <div class="settingsHelp">Son run'lar uzerinden source tarama ve draft uretim trendi.</div>
        </div>
      </div>
      <table class="statusTable">
        <thead>
          <tr>
            <th>run</th>
            <th>basladi</th>
            <th>due/islenen</th>
            <th>timeline</th>
            <th>yeni tweet</th>
            <th>draft</th>
            <th>hata</th>
          </tr>
        </thead>
        <tbody>
          ${
            recentRuns.length
              ? recentRuns
                  .map(
                    (run) => `
                <tr>
                  <td>#${esc(run.id)}</td>
                  <td>${esc(formatDateTR(run.started_at))}</td>
                  <td>${esc(run.due_sources)} / ${esc(run.processed_sources)}</td>
                  <td>${esc(run.timeline_calls)}</td>
                  <td>${esc(run.new_tweets)}</td>
                  <td>${esc(run.draft_candidates)}</td>
                  <td>${esc(run.error_count)}</td>
                </tr>
              `
                  )
                  .join("")
              : `<tr><td colspan="7">Collector run verisi yok.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderSourcePerformanceCard(performanceRows, helpers) {
  const { esc, formatDateTR } = helpers;
  const rows = Array.isArray(performanceRows) ? performanceRows : [];

  return `
    <div class="card">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Source Verim</div>
          <div class="settingsHelp">Draft getiren source'lar ve hata ureten source'lar ayni tabloda gorunur.</div>
        </div>
      </div>
      <table class="statusTable">
        <thead>
          <tr>
            <th>source</th>
            <th>tier</th>
            <th>aktif</th>
            <th>draft</th>
            <th>media</th>
            <th>timeline</th>
            <th>yield</th>
            <th>hata</th>
            <th>son update</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                <tr>
                  <td class="mono">@${esc(row.handle)}</td>
                  <td>${esc(row.tier)}</td>
                  <td>${row.active ? "evet" : "hayir"}</td>
                  <td>${esc(row.draft_candidates)}</td>
                  <td>${esc(row.media_tweets_found)}</td>
                  <td>${esc(row.timeline_calls)}</td>
                  <td>${esc(ratio(row.draft_candidates, row.timeline_calls))}</td>
                  <td>${esc(row.error_count)}</td>
                  <td>${esc(formatDateTR(row.updated_at))}</td>
                </tr>
              `
                  )
                  .join("")
              : `<tr><td colspan="9">Source performans verisi yok.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderCollectorPage({ collectorMetrics, performanceRows, helpers, limit }) {
  const { esc } = helpers;
  const totals = collectorMetrics?.totals || {};
  const trend = collectorMetrics?.trend || {};

  const body = `
    ${renderTopBar(
      {
        title: "Collector UI",
        subtitle: "Collector trendleri, API verimi ve source performansi",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources UI" },
          { href: "/history-ui", label: "History UI" },
          { href: "/collector-metrics", label: "Collector JSON", targetBlank: true },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        {
          label: "24s run / draft",
          value: `${trend.runs_24h ?? 0} / ${trend.drafts_24h ?? 0}`,
          compact: true,
        },
        {
          label: "7g run / draft",
          value: `${trend.runs_7d ?? 0} / ${trend.drafts_7d ?? 0}`,
          compact: true,
        },
        {
          label: "Genel timeline yield",
          value: totals.yield_per_timeline ?? "0.00",
        },
        {
          label: "Due filter savings",
          value: totals.due_filter_savings ?? 0,
        },
      ],
      esc
    )}

    <div class="toolbar">
      <button class="btn btnSave" type="button" data-action="run-collector">Tweet Cek</button>
      <button class="btn btnSave" type="button" data-action="run-make-drafts">Draft Uret</button>
      ${renderLimitPicker({ basePath: "/collector-ui", currentLimit: limit }, esc)}
    </div>
    <div id="collectorMessage" class="message"></div>

    ${renderRecentRunsCard(collectorMetrics, helpers)}
    ${renderSourcePerformanceCard(performanceRows, helpers)}
  `;

  return renderPageShell("Collector UI", body, renderCollectorClientScript());
}

module.exports = {
  renderCollectorPage,
};
