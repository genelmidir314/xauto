const COMMENT_TRANSLATION_FORMAT_KEY = "comment_plus_translation";
const COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY =
  "comment_translation_source_link";

function isSourceLinkFallbackFormat(formatKey) {
  return formatKey === COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY;
}

function composeDraftText(comment, translation, formatKey, xUrl, hashtags, useHashtags) {
  const c = String(comment || "").trim();
  const t = String(translation || "").trim();
  const link = String(xUrl || "").trim();
  const tags = String(hashtags || "").trim();

  let base;
  if (isSourceLinkFallbackFormat(formatKey)) {
    base = [c, t, link].filter(Boolean).join("\n\n");
  } else if (formatKey === COMMENT_TRANSLATION_FORMAT_KEY) {
    if (c && t) base = `${c}\n\n${t}`;
    else if (t) base = t;
    else base = c || "";
  } else {
    base = [c, t].filter(Boolean).join("\n\n");
  }

  if (useHashtags === true && tags) {
    return base ? `${base}\n\n${tags}` : tags;
  }
  return base;
}

module.exports = {
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
  composeDraftText,
  isSourceLinkFallbackFormat,
};
