const {
  renderDashboardCards,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderNewsClientScript } = require("./client-scripts");

function renderNewsSourcesCard(sources, helpers) {
  const { esc } = helpers;
  const rows = (sources || [])
    .map(
      (s) => `
      <tr data-news-source-id="${esc(s.id)}">
        <td>${esc(s.name)}</td>
        <td class="mono" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${esc(s.feed_url)}</td>
        <td><button class="btn btnReject" data-action="delete-news-source" data-id="${esc(s.id)}">Sil</button></td>
      </tr>`
    )
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Haber Kaynaklari (RSS)</div>
          <div class="settingsHelp">RSS feed URL'leri. Ornek: https://rss.nytimes.com/services/xml/rss/nyt/World.xml</div>
        </div>
      </div>
      <form id="newsSourceAddForm">
        <input type="text" id="newsSourceName" placeholder="Kaynak adi (orn: NYT)" class="input" style="width:120px;margin-right:8px;" />
        <input type="text" id="newsSourceFeedUrl" placeholder="RSS feed URL" class="input" style="flex:1;min-width:280px;margin-right:8px;" />
        <button type="submit" class="btn btnSave">Ekle</button>
      </form>
      <div id="newsSourceMessage" class="message"></div>
      <table class="statusTable" style="margin-top:12px;">
        <thead><tr><th>Ad</th><th>Feed URL</th><th>Islem</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='3'>Kaynak yok.</td></tr>"}</tbody>
      </table>
    </div>
  `;
}

function renderNewsDraftsCard(drafts, helpers) {
  const { esc } = helpers;
  const rows = (drafts || [])
    .map(
      (d) => {
        const hasMedia = !!d.media_url?.trim();
        const mediaHtml = hasMedia
          ? `<div class="mediaItem" style="margin-top:6px;"><img class="mediaImg" src="${esc(d.media_url)}" alt="" style="max-width:120px;max-height:80px;object-fit:cover;border-radius:8px;" /></div>`
          : "";
        return `
      <tr data-news-draft-id="${d.id}">
        <td style="max-width:400px;vertical-align:top;">
          <div>${esc((d.post_text || "").slice(0, 140))}${(d.post_text || "").length > 140 ? "..." : ""}</div>
          ${mediaHtml}
        </td>
        <td><span class="pill ${d.status}">${esc(d.status)}</span></td>
        <td>
          ${d.status === "pending" ? `
            <button class="btn btnNow" data-action="post-news-now" data-id="${esc(d.id)}">Post Now</button>
            <button class="btn btnReject" data-action="delete-news-draft" data-id="${esc(d.id)}">Sil</button>
          ` : ""}
          ${d.status === "posted" ? `
            <button class="btn btnReject" data-action="delete-news-draft" data-id="${esc(d.id)}">Sil</button>
          ` : ""}
        </td>
      </tr>`;
      }
    )
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Gundem Draftlari (20 adet)</div>
          <div class="settingsHelp">Post Now ile anlik paylas. Schedule yok.</div>
        </div>
      </div>
      <table class="statusTable">
        <thead><tr><th>Post</th><th>Durum</th><th>Islem</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='3'>Draft yok. Post Uret ile olustur.</td></tr>"}</tbody>
      </table>
    </div>
  `;
}

function renderNewsPage({ sources, drafts, helpers, counts }) {
  const { esc } = helpers;
  const c = counts || {};

  const body = `
    ${renderTopBar(
      {
        title: "Gundem Post",
        subtitle: "Haber kaynaklarindan X postlari - anlik paylasim",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources" },
          { href: "/collector-ui", label: "Collector" },
          { href: "/reply-ui", label: "Reply" },
          { href: "/history-ui", label: "History" },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        { label: "Kaynak", value: c.sources ?? 0 },
        { label: "Haber", value: c.items ?? 0 },
        { label: "Pending", value: c.pending ?? 0 },
        { label: "Posted", value: c.posted ?? 0 },
      ],
      esc
    )}

    <div class="toolbar">
      <button class="btn btnSave" data-action="run-news-collector">Haber Cek</button>
      <button class="btn btnApprove" data-action="run-make-news-drafts">Post Uret (20 draft)</button>
    </div>
    <div id="newsMessage" class="message"></div>

    ${renderNewsSourcesCard(sources, helpers)}
    ${renderNewsDraftsCard(drafts, helpers)}
  `;

  return renderPageShell("Gundem Post", body, renderNewsClientScript(), {
    writeTokenRequired: !!helpers.writeTokenRequired,
  });
}

module.exports = {
  renderNewsPage,
};
