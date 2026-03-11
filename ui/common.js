const LIMIT_OPTIONS = [50, 100, 200, 500];

const BASE_STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system; background:#06070a; color:#e9eef6; }
  a { color:#9ecbff; text-decoration:none; }
  a:hover{ text-decoration:underline; }
  .wrap { max-width: 1280px; margin: 28px auto; padding: 0 16px 32px; }
  .top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom: 16px; }
  .titleBlock { display:flex; flex-direction:column; gap:6px; }
  h1 { margin:0; font-size:28px; letter-spacing:0.3px; }
  .subtitle { margin:0; opacity:.72; font-size:13px; }
  .nav { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin: 10px 0 16px; }
  .btn, button.btn { border:1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); color:#e9eef6;
         padding:10px 14px; border-radius:12px; cursor:pointer; font: inherit; }
  .btn:hover, button.btn:hover { background: rgba(255,255,255,.07); text-decoration:none; }
  .btn[disabled], button.btn[disabled] { opacity:.55; cursor:wait; }
  .tabs { display:flex; gap:10px; flex-wrap:wrap; margin: 18px 0 14px; }
  .pill { display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px;
          border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.03); }
  .pill.pending { box-shadow: 0 0 0 1px rgba(120,170,255,.35) inset; }
  .pill.approved { box-shadow: 0 0 0 1px rgba(90,220,150,.35) inset; }
  .pill.queued { box-shadow: 0 0 0 1px rgba(255,200,90,.35) inset; }
  .pill.rejected { box-shadow: 0 0 0 1px rgba(255,90,90,.35) inset; }
  .pill.posted { box-shadow: 0 0 0 1px rgba(190,190,255,.35) inset; }
  .pill.processing { box-shadow: 0 0 0 1px rgba(180,120,255,.35) inset; }
  .pill.waiting { box-shadow: 0 0 0 1px rgba(255,200,90,.35) inset; }
  .pill.failed { box-shadow: 0 0 0 1px rgba(255,90,90,.35) inset; }
  .pill.done { box-shadow: 0 0 0 1px rgba(120,220,180,.35) inset; }
  .count { opacity:.9; font-weight:700; }
  .card { margin-top:16px; border:1px solid rgba(255,255,255,.10); background: radial-gradient(1200px 600px at 20% 0%, rgba(120,170,255,.10), transparent 60%), rgba(255,255,255,.03); border-radius:18px; padding:16px; }
  .card.compact { padding: 14px; }
  .row { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
  .stack { display:flex; flex-direction:column; gap:14px; }
  .fieldStack { display:flex; flex-direction:column; gap:8px; }
  @media (max-width: 920px){ .row{ grid-template-columns:1fr; } .top { flex-direction:column; } }
  .label { font-size:12px; opacity:.75; margin-bottom:8px; }
  .box { border:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.25); border-radius:14px; padding:12px; min-height:64px; white-space:pre-wrap; }
  textarea.box { width:100%; color:#e9eef6; resize:vertical; min-height:110px; font: inherit; }
  .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
  .btnSave { background: rgba(70,120,255,.22); border-color: rgba(70,120,255,.35); }
  .btnApprove { background: rgba(70,220,140,.18); border-color: rgba(70,220,140,.35); }
  .btnReject { background: rgba(255,90,90,.18); border-color: rgba(255,90,90,.35); }
  .btnQueue { background: rgba(255,200,90,.16); border-color: rgba(255,200,90,.35); }
  .btnNow { background: rgba(180,120,255,.16); border-color: rgba(180,120,255,.35); }
  .btnCancel { background: rgba(255,120,120,.12); border-color: rgba(255,120,120,.28); }
  .muted { opacity:.75; font-size:12px; }
  .meta { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .metaRight { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas; }
  .char { font-size:12px; opacity:.85; }
  .char.over { color:#ff9898; }
  .score { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); font-size:12px; }
  .scheduleBox { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,200,90,.08); border:1px solid rgba(255,200,90,.22); font-size:12px; }
  .dashGrid { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px; margin: 14px 0 6px; }
  @media (max-width: 920px){ .dashGrid{ grid-template-columns: 1fr 1fr; } }
  .dashCard { border:1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); border-radius:16px; padding:14px; }
  .dashLabel { font-size:12px; opacity:.72; margin-bottom:6px; }
  .dashValue { font-size:22px; font-weight:700; }
  .dashSub { font-size:12px; opacity:.8; margin-top:6px; }
  .mediaGrid { margin-top:10px; display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }
  @media (max-width: 920px){ .mediaGrid{ grid-template-columns: 1fr; } }
  .mediaItem { position:relative; border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,.10); background: rgba(0,0,0,.20); }
  .mediaImg { width:100%; height:auto; display:block; }
  .mediaBadge { position:absolute; right:10px; top:10px; padding:6px 10px; border-radius:999px; background: rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.18); font-size:12px; }
  .mediaLink { display:block; }
  .draftCard { display:flex; flex-direction:column; gap:12px; }
  .draftHeader { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .draftTitle { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .draftPanels { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:14px; }
  @media (max-width: 920px){ .draftPanels{ grid-template-columns:1fr; } }
  .actionNote { font-size:12px; opacity:.75; }
  .message { margin-top:8px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); font-size:13px; display:none; }
  .message.show { display:block; }
  .message.info { border-color: rgba(120,170,255,.30); }
  .message.success { border-color: rgba(90,220,150,.35); }
  .message.error { border-color: rgba(255,90,90,.35); }
  .emptyState { margin-top:16px; padding:28px 18px; text-align:center; border:1px dashed rgba(255,255,255,.12); border-radius:18px; background: rgba(255,255,255,.02); }
  .emptyState.hidden { display:none; }
  .statusTable { width:100%; border-collapse: collapse; }
  .statusTable th, .statusTable td { padding:12px 10px; border-bottom: 1px solid rgba(255,255,255,.08); text-align:left; vertical-align:top; }
  .statusTable th { font-size:12px; opacity:.75; font-weight:600; }
  .tableText { max-width: 380px; }
  .detailsBox { border:1px solid rgba(255,255,255,.08); border-radius:12px; background: rgba(255,255,255,.02); padding:10px 12px; }
  .detailsBox summary { cursor:pointer; }
  .detailsBody { margin-top:10px; white-space:pre-wrap; }
  .tableActions { display:flex; gap:8px; flex-wrap:wrap; }
  .flash { margin: 0 0 16px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); display:none; }
  .flash.show { display:block; }
  .flash.success { border-color: rgba(90,220,150,.35); }
  .flash.error { border-color: rgba(255,90,90,.35); }
  .limitSet { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .limitSet .muted { margin-right: 4px; }
  .btn.isActive { border-color: rgba(120,170,255,.45); background: rgba(120,170,255,.12); }
  .subNav { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .fieldHint { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-top:8px; }
  .settingsCard { display:flex; flex-direction:column; gap:14px; }
  .formGrid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px; }
  @media (max-width: 920px){ .formGrid{ grid-template-columns:1fr; } }
  .field { display:flex; flex-direction:column; gap:8px; }
  .input, input.input, select.input {
    width:100%;
    color:#e9eef6;
    background: rgba(0,0,0,.25);
    border:1px solid rgba(255,255,255,.10);
    border-radius:12px;
    padding:10px 12px;
    font: inherit;
  }
  .settingsMeta { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  .settingsHelp { font-size:12px; opacity:.78; }
`;

function renderPageShell(title, body, scripts = "") {
  return `
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <title>${title}</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
  ${scripts}
</body>
</html>`;
}

function renderNavButtons(items, esc) {
  return items
    .map((item) => {
      const attrs = item.targetBlank
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a class="btn" href="${esc(item.href)}"${attrs}>${esc(item.label)}</a>`;
    })
    .join("");
}

function renderTopBar({ title, subtitle = "", navItems = [] }, esc) {
  return `
    <div class="top">
      <div class="titleBlock">
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ""}
      </div>
      <div class="nav">
        ${renderNavButtons(navItems, esc)}
      </div>
    </div>
  `;
}

function renderDashboardCards(cards, esc) {
  return `
    <div class="dashGrid">
      ${cards
        .map(
          (card) => `
        <div class="dashCard">
          <div class="dashLabel">${esc(card.label)}</div>
          <div class="dashValue"${card.compact ? ' style="font-size:18px;"' : ""}>${esc(
            card.value
          )}</div>
          ${card.sub ? `<div class="dashSub">${esc(card.sub)}</div>` : ""}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderLimitPicker({ basePath, currentLimit, params = {} }, esc) {
  const queryBase = new URLSearchParams(params);
  return `
    <div class="limitSet">
      <span class="muted">limit:</span>
      ${LIMIT_OPTIONS.map((limit) => {
        const query = new URLSearchParams(queryBase);
        query.set("limit", String(limit));
        const href = `${basePath}?${query.toString()}`;
        return `<a class="btn ${limit === currentLimit ? "isActive" : ""}" href="${esc(
          href
        )}">${limit}</a>`;
      }).join("")}
    </div>
  `;
}

function truncateText(text, max = 120) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function buildXStatusUrl(postId) {
  if (!postId) return "";
  return `https://x.com/i/web/status/${encodeURIComponent(String(postId))}`;
}

module.exports = {
  buildXStatusUrl,
  renderDashboardCards,
  renderLimitPicker,
  renderPageShell,
  renderTopBar,
  truncateText,
};
