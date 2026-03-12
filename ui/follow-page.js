const {
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderFollowClientScript } = require("./client-scripts");

function renderFollowStatusPill(status, esc) {
  const normalized = String(status || "pending");
  const cls =
    normalized === "followed"
      ? "pill approved"
      : normalized === "pending"
        ? "pill pending"
        : "pill rejected";
  return `<span class="${cls}">${esc(normalized)}</span>`;
}

function renderFollowQueueCard(items, helpers) {
  const { esc, formatDateTR } = helpers;
  const rows = (items || [])
    .map((item) => {
      const handle = String(item.handle || "").replace(/^@/, "");
      return `
        <tr data-follow-id="${esc(item.id)}">
          <td class="mono">@${esc(handle)}</td>
          <td>${renderFollowStatusPill(item.status, esc)}</td>
          <td class="muted" data-follow-next>${esc(formatDateTR(item.next_follow_at))}</td>
          <td class="muted" data-follow-followed>${esc(formatDateTR(item.followed_at))}</td>
          <td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(item.last_error || "")}">${esc((item.last_error || "-").slice(0, 50))}</td>
          <td>
            ${item.status === "pending" ? `<button class="btn" type="button" data-action="retry-follow" data-id="${esc(item.id)}">Yeniden dene</button>` : ""}
            <button class="btn btnReject" type="button" data-action="delete-follow" data-id="${esc(item.id)}">Sil</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Takip Kuyruğu</div>
          <div class="settingsHelp">Listeye eklediğiniz hesaplar, follow-worker tarafından sırayla takip edilir. Aralık: FOLLOW_INTERVAL_MINUTES (varsayılan 10 dk).</div>
        </div>
        <div class="settingsMeta muted">
          <span>Aralık: ${esc(process.env.FOLLOW_INTERVAL_MINUTES || "10")} dk</span>
        </div>
      </div>

      <form id="followAddForm" class="formGrid">
        <label class="field">
          <span class="label">Takip edilecek kullanıcı</span>
          <input class="input" id="followHandle" name="handle" type="text" placeholder="orn: ylecun" />
        </label>
      </form>

      <div class="actions" style="margin-top:0;">
        <button class="btn btnSave" type="submit" form="followAddForm" data-follow-submit>Listeye Ekle</button>
      </div>
      <div id="followMessage" class="message" aria-live="polite"></div>

      <div class="card compact" style="margin-top:0;">
        <table class="statusTable">
          <thead>
            <tr>
              <th>handle</th>
              <th>durum</th>
              <th>next_follow_at</th>
              <th>followed_at</th>
              <th>hata</th>
              <th>işlem</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6">Kuyruk boş.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFollowPage({ items, helpers, limit }) {
  const { esc } = helpers;
  const pending = (items || []).filter((i) => i.status === "pending").length;
  const followed = (items || []).filter((i) => i.status === "followed").length;

  const body = `
    ${renderTopBar(
      {
        title: "Takip Kuyruğu",
        subtitle: "Belirli aralıklarla sırayla takip edilecek hesaplar",
        navItems: [
          { href: "/inbox", label: "Inbox" },
          { href: "/sources-ui", label: "Sources" },
          { href: "/collector-ui", label: "Collector" },
          { href: "/history-ui", label: "History" },
        ],
      },
      esc
    )}

    ${renderDashboardCards(
      [
        { label: "Toplam", value: (items || []).length },
        { label: "Bekleyen", value: pending },
        { label: "Takip edildi", value: followed },
      ],
      esc
    )}

    <div class="toolbar">
      ${renderLimitPicker({ basePath: "/follow-ui", currentLimit: limit }, esc)}
    </div>

    ${renderFollowQueueCard(items, helpers)}
  `;

  return renderPageShell("Takip Kuyruğu", body, renderFollowClientScript(), {
    writeTokenRequired: !!helpers.writeTokenRequired,
  });
}

module.exports = {
  renderFollowPage,
};
