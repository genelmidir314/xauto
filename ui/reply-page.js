const {
  renderDashboardCards,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderReplyClientScript } = require("./client-scripts");

function renderReplySourcesCard(sources, helpers) {
  const { esc } = helpers;
  const rows = (sources || [])
    .map(
      (s) => `
      <tr data-reply-source-id="${esc(s.id)}">
        <td class="mono">@${esc((s.handle || "").replace(/^@/, ""))}</td>
        <td><button class="btn btnReject" data-action="delete-reply-source" data-id="${esc(s.id)}">Sil</button></td>
      </tr>`
    )
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Reply Kaynakları</div>
          <div class="settingsHelp">Viral tweet'leri reply hedefi olarak izlenecek hesaplar.</div>
        </div>
      </div>
      <form id="replySourceAddForm">
        <input type="text" id="replySourceHandle" placeholder="handle" class="input" style="width:180px;margin-right:8px;" />
        <button type="submit" class="btn btnSave">Ekle</button>
      </form>
      <div id="replySourceMessage" class="message"></div>
      <table class="statusTable" style="margin-top:12px;">
        <thead><tr><th>handle</th><th>işlem</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='2'>Kaynak yok.</td></tr>"}</tbody>
      </table>
    </div>
  `;
}

function renderReplyDraftsCard(drafts, helpers) {
  const { esc, formatDateTR } = helpers;
  const rows = (drafts || [])
    .map(
      (d) => `
      <tr data-reply-draft-id="${d.id}">
        <td class="mono">${esc(d.tweet_id)}</td>
        <td>@${esc((d.author_handle || "").replace(/^@/, ""))}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${esc((d.original_text || "").slice(0, 80))}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc((d.reply_text || "").slice(0, 60))}</td>
        <td><span class="pill ${d.status === 'posted' ? 'approved' : 'pending'}">${esc(d.status)}</span></td>
        <td>
          ${d.status === "pending" ? `
            <button class="btn btnSave" data-action="approve-reply" data-id="${d.id}">Onayla</button>
            <button class="btn btnReject" data-action="reject-reply" data-id="${d.id}">Reddet</button>
          ` : ""}
        </td>
      </tr>`
    )
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Reply Draft'ları</div>
          <div class="settingsHelp">Onaylananlar sıraya alınır ve reply atılır.</div>
        </div>
      </div>
      <table class="statusTable">
        <thead><tr><th>tweet_id</th><th>yazar</th><th>orijinal</th><th>reply</th><th>durum</th><th>işlem</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='6'>Draft yok.</td></tr>"}</tbody>
      </table>
    </div>
  `;
}

function renderReplyPage({ sources, drafts, helpers, counts }) {
  const { esc } = helpers;
  const c = counts || {};

  const body = `
    ${renderTopBar(
      {
        title: "Reply Sistemi",
        subtitle: "Viral tweet'lere reply - takipçi kazanımı",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources" },
          { href: "/collector-ui", label: "Collector" },
          { href: "/follow-ui", label: "Takip" },
          { href: "/history-ui", label: "History" },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        { label: "Kaynak", value: c.sources ?? 0 },
        { label: "Aday", value: c.candidates ?? 0 },
        { label: "Pending", value: c.pendingDrafts ?? 0 },
        { label: "Kuyrukta", value: c.queued ?? 0 },
      ],
      esc
    )}

    <div class="toolbar">
      <button class="btn btnSave" data-action="run-reply-collector">Reply Collector</button>
      <button class="btn btnSave" data-action="run-make-reply-drafts">AI Yorum Üret</button>
    </div>
    <div id="replyMessage" class="message"></div>

    ${renderReplySourcesCard(sources, helpers)}
    ${renderReplyDraftsCard(drafts, helpers)}
  `;

  return renderPageShell("Reply Sistemi", body, renderReplyClientScript(), {
    writeTokenRequired: !!helpers.writeTokenRequired,
  });
}

module.exports = {
  renderReplyPage,
};
