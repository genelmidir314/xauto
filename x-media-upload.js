const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

const UPLOAD_BASE = process.env.X_UPLOAD_BASE || "https://upload.twitter.com";
const V2_MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
const CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_STATUS_POLLS = 40;
const NO_MP4_VARIANT_ERROR =
  "Video medya bulundu ama indirilebilir mp4 variant yok. Collector script'ini yeni medya alanlariyla tekrar calistir.";

function createError(message, status) {
  const err = new Error(message);
  if (status) err.status = status;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStoredMedia(media) {
  if (!media) return [];
  if (Array.isArray(media)) return media;

  try {
    const parsed = JSON.parse(media);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasOAuth1a(auth) {
  return !!(
    auth?.consumerKey &&
    auth?.consumerSecret &&
    auth?.accessToken &&
    auth?.accessSecret
  );
}

function hasOAuth2UserToken(auth) {
  return !!auth?.userBearer && String(auth.userBearer).trim().length > 20;
}

function createOAuthClient(auth) {
  if (!hasOAuth1a(auth)) {
    throw createError("Video/gif medya yuklemek icin OAuth1a gerekli.", 403);
  }

  return new OAuth({
    consumer: {
      key: auth.consumerKey,
      secret: auth.consumerSecret,
    },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto.createHmac("sha1", key).update(baseString).digest("base64");
    },
  });
}

function buildOAuthHeader(auth, requestData) {
  const oauth = createOAuthClient(auth);
  const token = {
    key: auth.accessToken,
    secret: auth.accessSecret,
  };

  return oauth.toHeader(oauth.authorize(requestData, token));
}

function pickBestMp4Variant(variants) {
  return (Array.isArray(variants) ? variants : [])
    .filter((variant) => {
      const url = String(variant?.url || "");
      const contentType = String(variant?.content_type || "");
      return !!url && contentType.toLowerCase() === "video/mp4";
    })
    .sort((a, b) => Number(b?.bit_rate || 0) - Number(a?.bit_rate || 0))[0];
}

function inspectStoredMedia(media) {
  const items = parseStoredMedia(media);
  if (items.length === 0) {
    return { ok: true, hasMedia: false, candidate: null, error: null };
  }

  const photo = items.find((item) => item?.type === "photo" && item?.url);
  if (photo) {
    return {
      ok: true,
      hasMedia: true,
      candidate: {
        type: "photo",
        url: photo.url,
        filename: "image.jpg",
        mediaCategory: "tweet_image",
      },
      error: null,
    };
  }

  const videoLike = items.find(
    (item) => item?.type === "video" || item?.type === "animated_gif"
  );
  if (!videoLike) {
    return {
      ok: false,
      hasMedia: true,
      candidate: null,
      error: "Medya bulundu ama kullanilabilir foto/video adayi yok.",
    };
  }

  const bestVariant = pickBestMp4Variant(videoLike.variants);
  if (!bestVariant?.url) {
    return {
      ok: false,
      hasMedia: true,
      candidate: null,
      error: NO_MP4_VARIANT_ERROR,
    };
  }

  const isGif = videoLike.type === "animated_gif";
  return {
    ok: true,
    hasMedia: true,
    candidate: {
      type: isGif ? "animated_gif" : "video",
      url: bestVariant.url,
      filename: isGif ? "animation.mp4" : "video.mp4",
      mediaCategory: isGif ? "tweet_gif" : "tweet_video",
    },
    error: null,
  };
}

function buildUploadCandidate(media) {
  const inspection = inspectStoredMedia(media);
  if (!inspection.ok) {
    throw createError(inspection.error || "Medya upload icin uygun degil.", 400);
  }
  return inspection.candidate;
}

async function downloadBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw createError(`Medya indirilemedi: ${response.status}`, response.status);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function uploadPhotoWithOAuth1a(candidate, auth) {
  const { buffer, contentType } = await downloadBinary(candidate.url);
  const uploadUrl = `${UPLOAD_BASE}/1.1/media/upload.json`;
  const form = new FormData();
  form.append(
    "media",
    new Blob([buffer], { type: contentType }),
    candidate.filename
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildOAuthHeader(auth, {
      url: uploadUrl,
      method: "POST",
    }),
    body: form,
  });

  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!response.ok) {
    throw createError(
      `Media upload error ${response.status}: ${bodyText.slice(0, 500)}`,
      response.status
    );
  }

  const mediaId = json?.media_id_string || json?.media_id;
  if (!mediaId) {
    throw createError("Media upload basarili ama media_id donmedi", 502);
  }

  return String(mediaId);
}

async function uploadPhotoWithOAuth2(candidate, auth) {
  if (!hasOAuth2UserToken(auth)) {
    throw createError("Foto medya upload icin user bearer veya OAuth1a gerekli.", 403);
  }

  const { buffer, contentType } = await downloadBinary(candidate.url);
  const form = new FormData();
  form.append(
    "media",
    new Blob([buffer], { type: contentType }),
    candidate.filename
  );

  const response = await fetch(V2_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.userBearer}`,
    },
    body: form,
  });

  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!response.ok) {
    throw createError(
      `Media upload error ${response.status}: ${bodyText.slice(0, 500)}`,
      response.status
    );
  }

  const mediaId = json?.data?.id || json?.media_id_string || json?.media_id;
  if (!mediaId) {
    throw createError("Media upload basarili ama media_id donmedi", 502);
  }

  return String(mediaId);
}

async function signedUrlEncodedRequest(auth, method, url, params) {
  const response = await fetch(url, {
    method,
    headers: {
      ...buildOAuthHeader(auth, {
        url,
        method,
        data: params,
      }),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams(params),
  });

  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!response.ok) {
    throw createError(
      `Media upload error ${response.status}: ${bodyText.slice(0, 500)}`,
      response.status
    );
  }

  return json;
}

async function initChunkedUpload(auth, totalBytes, contentType, mediaCategory) {
  const uploadUrl = `${UPLOAD_BASE}/1.1/media/upload.json`;
  const json = await signedUrlEncodedRequest(auth, "POST", uploadUrl, {
    command: "INIT",
    total_bytes: String(totalBytes),
    media_type: contentType,
    media_category: mediaCategory,
  });

  const mediaId = json?.media_id_string || json?.media_id;
  if (!mediaId) {
    throw createError("INIT basarili ama media_id donmedi", 502);
  }

  return String(mediaId);
}

async function appendChunk(auth, mediaId, segmentIndex, chunk, contentType, filename) {
  const uploadUrl = `${UPLOAD_BASE}/1.1/media/upload.json`;
  const query = new URLSearchParams({
    command: "APPEND",
    media_id: String(mediaId),
    segment_index: String(segmentIndex),
  });
  const requestUrl = `${uploadUrl}?${query.toString()}`;

  const form = new FormData();
  form.append("media", new Blob([chunk], { type: contentType }), filename);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: buildOAuthHeader(auth, {
      url: uploadUrl,
      method: "POST",
      data: {
        command: "APPEND",
        media_id: String(mediaId),
        segment_index: String(segmentIndex),
      },
    }),
    body: form,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw createError(
      `Media append error ${response.status}: ${bodyText.slice(0, 500)}`,
      response.status
    );
  }
}

async function finalizeUpload(auth, mediaId) {
  const uploadUrl = `${UPLOAD_BASE}/1.1/media/upload.json`;
  return signedUrlEncodedRequest(auth, "POST", uploadUrl, {
    command: "FINALIZE",
    media_id: String(mediaId),
  });
}

async function getUploadStatus(auth, mediaId) {
  const uploadUrl = `${UPLOAD_BASE}/1.1/media/upload.json`;
  const query = new URLSearchParams({
    command: "STATUS",
    media_id: String(mediaId),
  });
  const requestUrl = `${uploadUrl}?${query.toString()}`;

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildOAuthHeader(auth, {
      url: uploadUrl,
      method: "GET",
      data: {
        command: "STATUS",
        media_id: String(mediaId),
      },
    }),
  });

  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!response.ok) {
    throw createError(
      `Media status error ${response.status}: ${bodyText.slice(0, 500)}`,
      response.status
    );
  }

  return json;
}

async function waitForProcessing(auth, mediaId) {
  for (let attempt = 0; attempt < MAX_STATUS_POLLS; attempt += 1) {
    const status = await getUploadStatus(auth, mediaId);
    const info = status?.processing_info;

    if (!info || info.state === "succeeded") {
      return;
    }

    if (info.state === "failed") {
      const message =
        info?.error?.message || "Video medya processing asamasinda basarisiz oldu.";
      throw createError(message, 400);
    }

    const waitMs = Math.max(Number(info.check_after_secs || 2) * 1000, 2000);
    await sleep(waitMs);
  }

  throw createError("Video medya processing timeout oldu.", 504);
}

async function uploadChunkedVideo(candidate, auth) {
  const { buffer, contentType } = await downloadBinary(candidate.url);
  const mediaId = await initChunkedUpload(
    auth,
    buffer.length,
    contentType,
    candidate.mediaCategory
  );

  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE_BYTES) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE_BYTES);
    await appendChunk(
      auth,
      mediaId,
      segmentIndex,
      chunk,
      contentType,
      candidate.filename
    );
    segmentIndex += 1;
  }

  const finalizeResponse = await finalizeUpload(auth, mediaId);
  if (finalizeResponse?.processing_info) {
    await waitForProcessing(auth, mediaId);
  }

  return mediaId;
}

async function uploadMediaFromStoredMedia(media, auth, options = {}) {
  const candidate = buildUploadCandidate(media);
  if (!candidate) return null;

  if (options.dryRun) {
    return {
      mediaId: `dry_media_${Date.now()}`,
      type: candidate.type,
      sourceUrl: candidate.url,
    };
  }

  if (candidate.type === "photo") {
    const mediaId = hasOAuth1a(auth)
      ? await uploadPhotoWithOAuth1a(candidate, auth)
      : await uploadPhotoWithOAuth2(candidate, auth);

    return {
      mediaId,
      type: candidate.type,
      sourceUrl: candidate.url,
    };
  }

  if (!hasOAuth1a(auth)) {
    throw createError("Video/gif medya upload icin OAuth1a gerekli.", 403);
  }

  const mediaId = await uploadChunkedVideo(candidate, auth);
  return {
    mediaId,
    type: candidate.type,
    sourceUrl: candidate.url,
  };
}

module.exports = {
  buildUploadCandidate,
  hasOAuth1a,
  hasOAuth2UserToken,
  inspectStoredMedia,
  NO_MP4_VARIANT_ERROR,
  parseStoredMedia,
  uploadMediaFromStoredMedia,
};
