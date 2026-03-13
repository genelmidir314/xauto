const {
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
} = require("./common");
const { renderInboxClientScript } = require("./client-scripts");
const { isSourceLinkFallbackFormat } = require("../draft-format");

function renderInboxTabs(statuses, currentStatus, getCount, helpers, limit) {
  const { esc, fmtStatusPill } = helpers;
  return `
    <div class="tabs">
      ${statuses
        .map((status) => {
          return `<a class="${fmtStatusPill(status)}" href="/inbox?status=${encodeURIComponent(
            status
          )}&limit=${encodeURIComponent(limit)}">
            ${esc(status.charAt(0).toUpperCase() + status.slice(1))}
            <span class="count">${getCount(status)}</span>
          </a>`;
        })
        .join("")}
    </div>
  `;
}

function renderPendingMediaFilters(currentPendingMedia, limit, categoryFilter, sourceFilter, esc) {
  const filters = [
    { id: "all", label: "Tumu" },
    { id: "video", label: "Sadece videolu" },
  ];

  const base = (pm) => {
    const p = new URLSearchParams({ status: "pending", pendingMedia: pm, limit: String(limit) });
    if (categoryFilter) p.set("category", categoryFilter);
    if (sourceFilter) p.set("source", sourceFilter);
    return "/inbox?" + p.toString();
  };

  return `
    <div class="subNav">
      ${filters
        .map(
          (filter) => `<a class="btn ${
            currentPendingMedia === filter.id ? "isActive" : ""
          }" href="${esc(base(filter.id))}">${esc(filter.label)}</a>`
        )
        .join("")}
    </div>
  `;
}

function renderSourceFilter(currentSource, status, pendingMedia, limit, categoryFilter, esc) {
  const baseParams = new URLSearchParams({ status, limit: String(limit) });
  if (status === "pending") baseParams.set("pendingMedia", pendingMedia);
  if (categoryFilter) baseParams.set("category", categoryFilter);
  return `
    <form class="subNav" method="get" action="/inbox" style="display:flex; gap:8px; align-items:center;">
      <input type="hidden" name="status" value="${esc(status)}" />
      <input type="hidden" name="limit" value="${esc(limit)}" />
      ${status === "pending" ? `<input type="hidden" name="pendingMedia" value="${esc(pendingMedia)}" />` : ""}
      ${categoryFilter ? `<input type="hidden" name="category" value="${esc(categoryFilter)}" />` : ""}
      <label class="muted" style="font-size:12px;">Kaynak:</label>
      <input class="input" name="source" type="text" placeholder="@handle" value="${esc(
        currentSource || ""
      )}" style="width:140px; padding:8px 10px;" />
      <button class="btn" type="submit">Filtrele</button>
    </form>
  `;
}

function renderCategoryFilter(currentCategory, categoryOptions, status, pendingMedia, limit, sourceFilter, esc) {
  if (!categoryOptions || categoryOptions.length === 0) return "";
  const base = (cat) => {
    const p = new URLSearchParams({ status, limit: String(limit) });
    if (status === "pending") p.set("pendingMedia", pendingMedia);
    if (sourceFilter) p.set("source", sourceFilter);
    if (cat) p.set("category", cat);
    return "/inbox?" + p.toString();
  };
  return `
    <div class="subNav">
      <span class="muted" style="font-size:12px;">Kategori:</span>
      <a class="btn ${!currentCategory ? "isActive" : ""}" href="${esc(base(""))}">Tumu</a>
      ${categoryOptions.map((cat) => `<a class="btn ${currentCategory === cat ? "isActive" : ""}" href="${esc(base(cat))}">${esc(cat)}</a>`).join("")}
    </div>
  `;
}

function renderScheduleSettingsCard(scheduleSettings, esc) {
  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Schedule Ayarlari</div>
          <div class="settingsHelp">Bu alan kaydedilince sirada bekleyen postlar yeni kurala gore yeniden schedule edilir.</div>
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

function renderCollectorMetricsCard(collectorMetrics, helpers) {
  const { esc, formatDateTR } = helpers;
  const totals = collectorMetrics?.totals || {};
  const lastRun = collectorMetrics?.lastRun || null;
  const topSources = Array.isArray(collectorMetrics?.topSources)
    ? collectorMetrics.topSources
    : [];
  const recentErrors = Array.isArray(collectorMetrics?.recentErrors)
    ? collectorMetrics.recentErrors
    : [];

  return `
    <div class="card settingsCard">
      <div class="meta">
        <div class="titleBlock">
          <div style="font-weight:700;">Collector Metrics</div>
          <div class="settingsHelp">X API tasarrufu ve source verimini collector run kayitlari uzerinden izler.</div>
        </div>
        <div class="settingsMeta muted">
          <span>toplam run: ${esc(totals.total_runs || 0)}</span>
          <span>cache hit: ${esc(totals.resolve_cache_hits || 0)}</span>
          <span>timeline basina draft: ${esc(totals.yield_per_timeline || "0.00")}</span>
          <span>invalid medya: ${esc(totals.invalid_tweets || 0)}</span>
        </div>
      </div>

      <div class="dashGrid">
        <div class="dashCard">
          <div class="dashLabel">Son run due</div>
          <div class="dashValue">${esc(lastRun?.due_sources ?? 0)}</div>
          <div class="dashSub">islenen: ${esc(lastRun?.processed_sources ?? 0)}</div>
        </div>
        <div class="dashCard">
          <div class="dashLabel">User id resolve</div>
          <div class="dashValue">${esc(lastRun?.user_id_resolves ?? 0)}</div>
          <div class="dashSub">cache hit toplam: ${esc(totals.resolve_cache_hits || 0)}</div>
        </div>
        <div class="dashCard">
          <div class="dashLabel">Timeline call</div>
          <div class="dashValue">${esc(lastRun?.timeline_calls ?? 0)}</div>
          <div class="dashSub">yeni tweet: ${esc(lastRun?.new_tweets ?? 0)}</div>
        </div>
        <div class="dashCard">
          <div class="dashLabel">Draft adayi</div>
          <div class="dashValue">${esc(lastRun?.draft_candidates ?? 0)}</div>
          <div class="dashSub">medyali tweet: ${esc(lastRun?.media_tweets ?? 0)}</div>
        </div>
        <div class="dashCard">
          <div class="dashLabel">Invalid medya</div>
          <div class="dashValue">${esc(totals.invalid_tweets ?? 0)}</div>
          <div class="dashSub">sirada kalan gecersiz: ${esc(totals.invalid_queued_drafts ?? 0)}</div>
        </div>
      </div>

      <div class="row">
        <div class="detailsBox">
          <div class="label">En verimli source'lar</div>
          ${
            topSources.length
              ? `<div class="stack">${topSources
                  .map(
                    (item) => `
                <div class="meta">
                  <div class="mono">@${esc(item.handle)}</div>
                  <div class="muted">draft: ${esc(item.draft_candidates)} · media: ${esc(
                    item.media_tweets_found
                  )} · calls: ${esc(item.timeline_calls)}</div>
                </div>
              `
                  )
                  .join("")}</div>`
              : `<div class="muted">Henuz source performans verisi yok.</div>`
          }
        </div>
        <div class="detailsBox">
          <div class="label">Son hata veren source'lar</div>
          ${
            recentErrors.length
              ? `<div class="stack">${recentErrors
                  .map(
                    (item) => `
                <div>
                  <div class="meta">
                    <div class="mono">@${esc(item.handle)}</div>
                    <div class="muted">${esc(formatDateTR(item.updated_at))}</div>
                  </div>
                  <div class="muted">hata: ${esc(item.error_count)} · ${esc(item.last_error || "-")}</div>
                </div>
              `
                  )
                  .join("")}</div>`
              : `<div class="muted">Kayitli source hatasi yok.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

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

function renderInboxActions(row, previewLength, helpers) {
  const { esc } = helpers || {};
  if (row.status === "posted") {
    return "";
  }

  const sourceLinkFallback = isSourceLinkFallbackFormat(row.format_key);
  const mediaBlocked = row.has_media && row.media_uploadable === false && !sourceLinkFallback;
  const queueDisabled = mediaBlocked ? "disabled" : "";
  const queueFitAttr = mediaBlocked ? "" : ' data-requires-fit="true"';
  const buttons = [];
  buttons.push(
    '<button type="button" class="btn btnSave" data-action="save">Save</button>',
    `<button type="button" class="btn btnNow" data-action="postNow"${queueFitAttr} ${queueDisabled}>Simdi Paylas</button>`
  );

  if (row.status === "pending" || row.status === "rejected") {
    buttons.splice(
      0,
      0,
      '<button type="button" class="btn btnApprove" data-action="approve">Onayla</button>',
      '<button type="button" class="btn btnReject" data-action="reject">Reject</button>'
    );
  } else if (row.status === "approved" && row.queue_id) {
    if (row.queue_status === "failed") {
      buttons.splice(
        1,
        0,
        `<button type="button" class="btn btnSave" data-action="retryQueue" data-queue-id="${esc ? esc(String(row.queue_id)) : row.queue_id}">Yeniden siraya al</button>`
      );
    } else if (row.queue_status !== "processing") {
      buttons.splice(
        1,
        0,
        `<button type="button" class="btn btnCancel" data-action="cancelQueue" data-queue-id="${esc ? esc(String(row.queue_id)) : row.queue_id}">Iptal</button>`
      );
    }
  }

  return `
    <div class="actions">
      ${buttons.join("")}
      <span class="actionNote">${
        row.status === "approved"
          ? (row.queue_status === "processing"
              ? "Paylasiliyor; iptal edilemez."
              : row.queue_status === "failed"
                ? "Hata alindi. Yeniden siraya al ile tekrar denenecek."
                : "Sirada. Iptal ile cikarilabilir.")
          : sourceLinkFallback
          ? "Source link fallback: medya yuklenmeden kaynak tweet linkiyle paylasilir."
          : mediaBlocked
          ? `Medya paylasim icin uygun degil: ${row.media_validation_error || "kullanilabilir upload adayi yok."}`
          : previewLength > 280
            ? "280 karakter ustu: sira ve post islemleri kilitlenir."
            : "Tek tikla onaylanir ve schedule kuralina gore siraya eklenir. Ek adim yok."
      }</span>
    </div>
  `;
}

function renderInboxCard(row, helpers) {
  const { esc, fmtStatusPill, fmtQueueStatusTR, composePreview, formatDateTR, mediaHtml } = helpers;
  const id = row.id;
  const sourceLinkFallback = isSourceLinkFallbackFormat(row.format_key);
  const preview = composePreview(row.comment_tr, row.translation_tr, row.format_key, row.x_url);
  const charCount = preview.length;
  const tweetId = row.tweet_id || "";
  const sh = (row.source_handle || "").replace(/^@/, "");
  const source = sh ? `@${sh}` : "-";
  const xUrl = row.x_url || (sh && row.tweet_id ? `https://x.com/${sh}/status/${row.tweet_id}` : "");
  const viralScore = row.viral_score ?? "-";
  const viralReason = row.viral_reason || "";
  const scheduledText = row.scheduled_at ? formatDateTR(row.scheduled_at) : null;
  const mediaWarning =
    row.has_media && row.media_uploadable === false && !sourceLinkFallback
      ? row.media_validation_error || "Bu medya yeniden paylasim icin uygun degil."
      : "";

  return `
    <article class="card draftCard" id="draft-${id}" data-id="${id}" data-status="${esc(
      row.status
    )}" data-in-queue="${row.is_queued ? "true" : "false"}" data-queue-id="${esc(
      String(row.queue_id || "")
    )}" data-format-key="${esc(
      row.format_key || ""
    )}" data-x-url="${esc(xUrl)}" data-use-comment="${row.use_comment !== false ? "true" : "false"}">
      <div class="draftHeader">
        <div class="titleBlock">
          <div class="draftTitle">
            <div class="mono" style="font-size:18px;"><b>ID:</b> ${id}</div>
            <span class="${fmtStatusPill(row.status)}" data-status-pill>${esc(row.status)}</span>
            <span class="score">Viral Score: <b>${esc(viralScore)}</b></span>
            <span class="pill ${esc(row.queue_status || "queued")}" data-queue-pill ${row.is_queued ? "" : "hidden"}>
              Sira: <b data-queue-status-text>${esc((fmtQueueStatusTR || ((s) => s))(row.queue_status || "waiting"))}</b>
            </span>
            <span class="scheduleBox" data-scheduled-box ${scheduledText ? "" : "hidden"}>
              Planlanan: <b data-scheduled-text>${esc(scheduledText || "-")}</b>
            </span>
          </div>
          ${viralReason ? `<div class="muted">reason: ${esc(viralReason)}</div>` : ""}
          ${sourceLinkFallback ? `<div class="muted">format: source link fallback</div>` : ""}
        </div>

        <div class="metaRight">
          <div class="muted mono">tweet_id: ${esc(tweetId)}</div>
          <div class="muted">kaynak: <b>${esc(source)}</b></div>
          ${row.source_category ? `<span class="pill" style="font-size:12px;">${esc(row.source_category)}</span>` : ""}
          ${xUrl ? `<a class="btn" href="${esc(xUrl)}" target="_blank" rel="noopener noreferrer">X link</a>` : ""}
        </div>
      </div>

      <div class="draftPanels">
        <section class="fieldStack">
          <div class="label">Orijinal Tweet</div>
          <div class="box">${esc(row.original_text || "(bulunamadi)")}</div>
          ${mediaWarning ? `<div class="message show error">${esc(mediaWarning)}</div>` : ""}
          ${mediaHtml(row.media, xUrl)}
        </section>

        <section class="fieldStack">
          <div class="label">Final Onizleme</div>
          <div class="box mono" data-preview>${esc(preview)}</div>
          <div class="fieldHint">
            <div class="char" data-char-count>${charCount} / 280</div>
            <div class="muted">Canli olarak guncellenir</div>
          </div>
        </section>

        <section class="fieldStack">
          <div class="label">TR Ceviri</div>
          <textarea class="box mono" data-field="translation">${esc(row.translation_tr || "")}</textarea>
        </section>

        <section class="fieldStack">
          <div class="label">Yorum</div>
          <div class="commentControls" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" data-field="use-comment" ${row.use_comment !== false ? "checked" : ""} />
              <span>Yorumu kullan</span>
            </label>
            <button type="button" class="btn btnSave" data-action="regenerate-comment">Yorumu yenile</button>
          </div>
          <textarea class="box mono" data-field="comment">${esc(row.comment_tr || "")}</textarea>
        </section>
      </div>

      ${renderInboxActions(row, charCount, helpers)}

      <div class="message" aria-live="polite"></div>
    </article>
  `;
}

function renderInboxPage({
  status,
  limit,
  queueView,
  pendingMedia,
  sourceFilter = "",
  categoryFilter = "",
  categoryOptions = [],
  rows,
  counts,
  dashboard,
  helpers,
  scheduleSettings,
  sources,
  tierCheckIntervals,
}) {
  const { esc } = helpers;
  const statusCounts = Object.fromEntries((counts.drafts_by_status || []).map((x) => [x.status, x.c]));
  const approvedCounts = counts.approved_breakdown || { total: 0, ready: 0, queued: 0 };
  const getCount = (value) =>
    value === "approved" ? Number(approvedCounts.queued || 0) : Number(statusCounts[value] || 0);

  const body = `
    ${renderTopBar(
      {
        title: "XAuto Inbox",
        subtitle: "Draft duzenleme, sira ve anlik paylasim merkezi",
        navItems: [
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

    ${renderDashboardCards(
      [
        {
          label: "Bugun scheduled",
          value: dashboard.todayScheduled,
          sub: `gunluk limit: ${dashboard.dailyLimit}`,
        },
        {
          label: "Siradaki bos slot",
          value: dashboard.nextSlotText,
          sub: `${scheduleSettings.activeWindowText} penceresi`,
          compact: true,
        },
        {
          label: "Kalan slot",
          value: dashboard.remainingSlots,
          sub: "bugun icin",
        },
        {
          label: "Gunluk limit durumu",
          value: dashboard.isDailyLimitReached ? "Doldu" : "Musait",
          sub: dashboard.isDailyLimitReached ? "yeni siraya yarina kayabilir" : "bugun hala yer var",
          compact: true,
        },
      ],
      esc
    )}

    ${renderScheduleSettingsCard(scheduleSettings, esc)}

    ${renderInboxTabs(["pending", "approved", "rejected", "posted"], status, getCount, helpers, limit)}

    <div class="toolbar">
      ${renderLimitPicker({
        basePath: "/inbox",
        currentLimit: limit,
        params: Object.assign(
          status === "pending" ? { status, pendingMedia } : { status },
          sourceFilter ? { source: sourceFilter } : {},
          categoryFilter ? { category: categoryFilter } : {}
        ),
      }, esc)}
      ${status === "pending" ? renderPendingMediaFilters(pendingMedia, limit, categoryFilter || "", sourceFilter || "", esc) : ""}
      ${renderCategoryFilter(categoryFilter, categoryOptions, status, pendingMedia, limit, sourceFilter, esc)}
      ${renderSourceFilter(sourceFilter || "", status, pendingMedia, limit, categoryFilter || "", esc)}
      <div class="subNav">
        ${status === "pending" ? `<button class="btn btnApprove" type="button" data-action="bulk-approve" data-bulk-count="10">En yuksek 10'u onayla</button>` : ""}
        ${status === "pending" ? `<button class="btn btnReject" type="button" data-action="bulk-reject">Reject All</button>` : ""}
        <button class="btn btnCancel" type="button" data-action="clear-rejected">Rejected'i Bosalt</button>
        <button class="btn btnCancel" type="button" data-action="clear-posted">Posted'i Bosalt</button>
        <button class="btn" type="button" onclick="location.reload()">Yenile</button>
        <a class="btn" href="/drafts?status=${encodeURIComponent(status)}${
          status === "pending"
            ? `&pendingMedia=${encodeURIComponent(pendingMedia)}`
            : ""
        }${sourceFilter ? `&source=${encodeURIComponent(sourceFilter)}` : ""}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ""}&limit=${limit}" target="_blank" rel="noopener noreferrer">Drafts JSON</a>
      </div>
    </div>

    ${rows.map((row) => renderInboxCard(row, helpers)).join("")}
    <div id="inboxEmptyState" class="emptyState ${rows.length > 0 ? "hidden" : ""}">
      Bu filtrede kayit yok: <b>${esc(status)}</b>
    </div>
  `;

  return renderPageShell(
    "XAuto Inbox",
    body,
    renderInboxClientScript(status, queueView),
    { writeTokenRequired: !!helpers.writeTokenRequired }
  );
}

module.exports = {
  renderInboxPage,
};
