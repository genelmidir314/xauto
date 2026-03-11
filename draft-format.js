const COMMENT_TRANSLATION_FORMAT_KEY = "comment_plus_translation";
const COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY =
  "comment_translation_source_link";

function isSourceLinkFallbackFormat(formatKey) {
  return formatKey === COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY;
}

function composeDraftText(comment, translation, formatKey, xUrl) {
  const c = String(comment || "").trim();
  const t = String(translation || "").trim();
  const link = String(xUrl || "").trim();

  if (isSourceLinkFallbackFormat(formatKey)) {
    return [c, t, link].filter(Boolean).join("\n\n");
  }

  if (formatKey === COMMENT_TRANSLATION_FORMAT_KEY) {
    if (c && t) return `${c}\n\n${t}`;
    if (t) return t;
    return c || "";
  }

  return [c, t].filter(Boolean).join("\n\n");
}

module.exports = {
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
  composeDraftText,
  isSourceLinkFallbackFormat,
};
