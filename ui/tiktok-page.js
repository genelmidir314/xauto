const {
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderTikTokClientScript } = require("./client-scripts");

function renderTikTokSourcesCard(sources, helpers) {
  const { esc, formatDateTR } = helpers;
  const rows = Array.isArray(sources) ? sources : [];

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">TikTok Kaynaklari</div>
          <div class="settingsHelp">Viral TikTok videolarinin URL'lerini ekleyin. Collector videolari indirir, make-drafts OpenAI yorumu ile draft uretir.</div>
        </div>
      </div>

      <form id="tiktokSourceAddForm" class="formGrid">
        <label class="field" style="grid-column: 1 / -1;">
          <span class="label">TikTok video URL</span>
          <input class="input" id="tiktokSourceUrl" name="url" type="url" placeholder="https://www.tiktok.com/@user/video/123456789" style="width:100%;" />
        </label>
      </form>

      <div class="actions" style="margin-top:0;">
        <button class="btn btnSave" type="submit" form="tiktokSourceAddForm" data-tiktok-source-submit>Kaynak Ekle</button>
      </div>
      <div id="tiktokSourceMessage" class="message" aria-live="polite"></div>

      <div class="card compact" style="margin-top:12px;">
        <table class="statusTable">
          <thead>
            <tr>
              <th>URL</th>
              <th>aktif</th>
              <th>son kontrol</th>
              <th>islem</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (row) => `
                <tr data-tiktok-source-id="${esc(row.id)}">
                  <td class="tableText mono" style="max-width:320px; overflow:hidden; text-overflow:ellipsis;">${esc(row.url)}</td>
                  <td>${row.active ? "evet" : "hayir"}</td>
                  <td class="muted">${esc(formatDateTR(row.last_checked_at) || "-")}</td>
                  <td>
                    <button class="btn btnReject" type="button" data-action="delete-tiktok-source" data-id="${esc(row.id)}">Sil</button>
                  </td>
                </tr>
              `
                    )
                    .join("")
                : `<tr><td colspan="4">TikTok kaynagi yok. Yukaridan URL ekleyin.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTikTokActionsCard(helpers) {
  const { esc } = helpers;
  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">TikTok Akisi</div>
          <div class="settingsHelp">1) Kaynak ekle 2) Collector calistir (videolari indirir) 3) Draft uret (OpenAI yorum ekler)</div>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn btnSave" type="button" data-action="run-tiktok-collector">Collector Calistir</button>
        <button class="btn btnSave" type="button" data-action="run-make-tiktok-drafts">Draft Uret</button>
        <a class="btn" href="/inbox?status=pending&pendingMedia=video">Inbox (videolu)</a>
      </div>
      <div id="tiktokMessage" class="message" aria-live="polite"></div>
    </div>
  `;
}

function renderTikTokPage({ sources, helpers }) {
  const { esc } = helpers;

  const body = `
    ${renderTopBar(
      {
        title: "TikTok UI",
        subtitle: "TikTok videolarini topla, draft uret, X'e paylas",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources UI" },
          { href: "/collector-ui", label: "Collector UI" },
          { href: "/reply-ui", label: "Reply" },
          { href: "/news-ui", label: "Gundem" },
          { href: "/follow-ui", label: "Takip" },
          { href: "/history-ui", label: "History UI" },
        ],
      },
      esc
    )}

    ${renderTikTokActionsCard(helpers)}
    ${renderTikTokSourcesCard(sources, helpers)}
  `;

  return renderPageShell("TikTok UI", body, renderTikTokClientScript(), {
    writeTokenRequired: !!helpers.writeTokenRequired,
  });
}

module.exports = {
  renderTikTokPage,
};
