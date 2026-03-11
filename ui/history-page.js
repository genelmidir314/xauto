const {
  buildXStatusUrl,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
  truncateText,
} = require("./common");

function renderHistoryRow(row, helpers) {
  const { esc, formatDateTR } = helpers;
  const xUrl = buildXStatusUrl(row.x_post_id);
  const inboxUrl = `/inbox?status=posted&limit=200#draft-${encodeURIComponent(
    row.draft_id
  )}`;
  return `
    <tr>
      <td class="mono">${esc(row.id)}</td>
      <td class="mono"><a href="${esc(inboxUrl)}">${esc(row.draft_id)}</a></td>
      <td>${esc(formatDateTR(row.posted_at))}</td>
      <td class="mono">
        ${
          xUrl
            ? `<a href="${esc(xUrl)}" target="_blank" rel="noopener noreferrer">${esc(
                row.x_post_id
              )}</a>`
            : ""
        }
      </td>
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
          <summary class="mono">${esc(truncateText(row.text || "", 120) || "-")}</summary>
          <div class="detailsBody mono">${esc(row.text || "-")}</div>
        </details>
      </td>
    </tr>
  `;
}

function renderHistoryPage({ rows, helpers, limit }) {
  const { esc } = helpers;

  const body = `
    ${renderTopBar(
      {
        title: "History UI",
        subtitle: "Paylasilmis iceriklerin son kayitlari",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources UI" },
          { href: "/collector-ui", label: "Collector UI" },
          { href: "/history", label: "History JSON", targetBlank: true },
        ],
      },
      esc
    )}

    <div class="toolbar">
      ${renderLimitPicker({ basePath: "/history-ui", currentLimit: limit }, esc)}
      <a class="btn" href="/history?format=csv&limit=500" download>CSV indir</a>
    </div>

    <div class="card compact">
      <table class="statusTable">
        <thead>
          <tr>
            <th>id</th>
            <th>draft_id</th>
            <th>posted_at</th>
            <th>x_post_id</th>
            <th>tweet_id</th>
            <th>viral</th>
            <th>text</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderHistoryRow(row, helpers)).join("")}
        </tbody>
      </table>
    </div>

    <div class="emptyState ${rows.length > 0 ? "hidden" : ""}">
      History bos.
    </div>
  `;

  return renderPageShell("History UI", body);
}

module.exports = {
  renderHistoryPage,
};
