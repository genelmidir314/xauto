/**
 * Shared OpenAI comment generation for make-drafts and server (regenerate-comment).
 */
require("dotenv").config();

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
let OPENAI_KEY_VALID = !!OPENAI_API_KEY;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const OPENAI_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || 3);

function cleanupTweetText(text) {
  let t = String(text || "").trim();
  t = t.replace(/^RT\s+@[\w_]+:\s*/i, "");
  t = t.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function fallbackComment(sourceHandle, cleaned) {
  const h = String(sourceHandle || "").toLowerCase();
  if (
    h.includes("futbol") ||
    h.includes("football") ||
    h.includes("espn") ||
    h.includes("goal") ||
    h.includes("433")
  ) {
    return "Bu görüntüde en dikkat çekici detay ne sence?";
  }
  if (
    h.includes("rainmaker") ||
    h.includes("history") ||
    h.includes("figen")
  ) {
    return "Böyle içerikler neden bu kadar ilgi çekiyor sence?";
  }
  if (
    h.includes("karpathy") ||
    h.includes("sama") ||
    h.includes("ylecun")
  ) {
    return "Buradaki en kritik nokta sence ne?";
  }
  if (cleaned.includes("?")) {
    return "Sence burada asıl kritik nokta ne?";
  }
  return "Bu içerik hakkında sen ne düşünüyorsun?";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openaiChat(systemPrompt, userPrompt, temperature = 0.4) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY yok");
  }

  let lastError = null;
  for (let attempt = 1; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const textBody = await res.text();
      let json = null;
      try {
        json = JSON.parse(textBody);
      } catch (_) {}

      if (!res.ok) {
        const err = new Error(`OpenAI hata ${res.status}: ${textBody.slice(0, 500)}`);
        err.status = res.status;
        throw err;
      }

      const out = String(json?.choices?.[0]?.message?.content || "").trim();
      if (!out) {
        throw new Error("OpenAI boş cevap döndü");
      }

      return out;
    } catch (e) {
      lastError = e;
      const status = e?.status;
      const isRetryable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        e?.name === "AbortError" ||
        e?.message?.includes("fetch");

      if (isRetryable && attempt < OPENAI_MAX_RETRIES) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.log(
          `⚠️ OpenAI attempt ${attempt}/${OPENAI_MAX_RETRIES} failed: ${e.message}. ${waitMs}ms sonra tekrar denenecek.`
        );
        await sleep(waitMs);
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
}

async function generateComment(sourceHandle, originalText, translationTr, hasMedia) {
  const cleanOriginal = cleanupTweetText(originalText);
  const cleanTranslation = cleanupTweetText(translationTr);

  if (!OPENAI_API_KEY || !OPENAI_KEY_VALID) {
    if (!OPENAI_KEY_VALID) {
      console.log("⚠️ OpenAI key geçersiz, yorum fallback kullanılacak.");
    } else {
      console.log("⚠️ OPENAI_API_KEY yok, yorum fallback kullanılacak.");
    }
    return fallbackComment(sourceHandle, cleanOriginal);
  }

  try {
    const mediaHint = hasMedia ? "Bu tweet medya içeriyor." : "Bu tweet medya içermiyor.";

    const out = await openaiChat(
      `
You are writing a short Turkish comment for a repost-style social media workflow.

Goal:
Write ONE natural Turkish comment line that can be placed above a translated tweet.

Rules:
- Write in Turkish
- Sound natural, sharp, and human
- 1 sentence only
- Ideally 6 to 14 words
- Do not summarize the whole tweet
- Do not translate the tweet again
- Do not use emojis
- Do not use hashtags
- Avoid generic boring lines
- The comment should invite curiosity, reaction, or thought
- If the content is sports, comment should focus on the striking detail
- If the content is tech/AI, comment should focus on the key implication
- If the content is viral/history, comment should focus on why it is interesting

Output ONLY the Turkish comment sentence.
      `,
      `
Source handle: ${sourceHandle}
Original tweet:
${cleanOriginal}

Turkish translation:
${cleanTranslation}

${mediaHint}
      `,
      0.7
    );

    console.log("OPENAI RESULT [comment]:", out);
    return out;
  } catch (e) {
    console.log("⚠️ OpenAI yorum exception:", e.message);
    return fallbackComment(sourceHandle, cleanOriginal);
  }
}

function fallbackReply(authorHandle, cleaned) {
  if (cleaned.includes("?")) return "Çok iyi soru, merak ediyorum.";
  return "Bu gerçekten dikkat çekici.";
}

async function generateReplyToTweet(authorHandle, tweetText) {
  const cleaned = cleanupTweetText(tweetText);

  if (!OPENAI_API_KEY || !OPENAI_KEY_VALID) {
    return fallbackReply(authorHandle, cleaned);
  }

  try {
    const out = await openaiChat(
      `
You write a short Turkish REPLY to a tweet. This will be posted as a direct reply under someone else's tweet.

Goal:
Write ONE natural Turkish reply that engages with the tweet. It will appear under their tweet.

Rules:
- Write in Turkish
- Sound natural, human, conversational
- 1 short sentence, max 80 characters
- Do NOT summarize the tweet
- Do NOT repeat what they said
- Add value: reaction, question, insight, or agreement
- No emojis, no hashtags
- Do not use @username (X adds it automatically)

Output ONLY the reply text.
      `,
      `
Tweet by @${authorHandle || "user"}:
${cleaned}
      `,
      0.7
    );

    const trimmed = String(out || "").trim().slice(0, 280);
    if (trimmed) return trimmed;
    return fallbackReply(authorHandle, cleaned);
  } catch (e) {
    console.log("⚠️ OpenAI reply exception:", e.message);
    return fallbackReply(authorHandle, cleaned);
  }
}

function setOpenAIKeyValid(valid) {
  OPENAI_KEY_VALID = !!valid;
}

module.exports = {
  cleanupTweetText,
  fallbackComment,
  fallbackReply,
  openaiChat,
  generateComment,
  generateReplyToTweet,
  setOpenAIKeyValid,
};
