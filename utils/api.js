// ⚠️ PRODUCTION NOTE: Move API key to a backend proxy to avoid exposing it client-side.

const HF_API_KEY     = "hf_YOUR_API_KEY";
const HF_CHAT_URL    = "https://router.huggingface.co/v1/chat/completions";
const TEXT_MODEL     = "meta-llama/Llama-3.1-8B-Instruct";
// Confirmed working on HF router free tier via novita provider
// Uses standard OpenAI image_url format with base64 data URLs
const VISION_MODEL   = "Qwen/Qwen3-VL-8B-Instruct:novita";

const MAX_NEW_TOKENS = 512;
const RETRY_DELAY_MS = 8000;
const MAX_RETRIES    = 2;

// Max dimension to resize image to before sending — keeps payload under provider limits
const MAX_IMAGE_DIM  = 768;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────────────────
   Prompt builders
───────────────────────────────────────────── */
export function buildPrompt(systemNote, userMessage) {
  return `${systemNote.trim()}\n\n${userMessage.trim()}`;
}

export function buildConversationPrompt(systemNote, history, newUserMessage) {
  const MAX_HISTORY_TURNS = 10;
  const recentHistory = history.slice(-MAX_HISTORY_TURNS);
  return [
    { role: "system", content: systemNote.trim() },
    ...recentHistory,
    { role: "user", content: newUserMessage.trim() },
  ];
}

export function summarizeHistory(history) {
  return history
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.trim()}`)
    .join("\n");
}

/* ─────────────────────────────────────────────
   Text model
───────────────────────────────────────────── */
export async function queryTextModel(promptOrMessages, options = {}) {
  const messages = Array.isArray(promptOrMessages)
    ? promptOrMessages
    : [{ role: "user", content: promptOrMessages }];

  const payload = {
    model: TEXT_MODEL,
    messages,
    max_tokens:  options.max_new_tokens ?? MAX_NEW_TOKENS,
    temperature: options.temperature    ?? 0.7,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(HF_CHAT_URL, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (res.status === 503) {
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
      throw new Error("Model is loading. Please try again shortly.");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content.trim();
    throw new Error("Unexpected response format from model.");
  }
}

/* ─────────────────────────────────────────────
   Image resizer — shrinks image to MAX_IMAGE_DIM
   via a canvas before base64 encoding.
   This keeps the payload well under provider limits
   and fixes the 400 caused by oversized payloads.
───────────────────────────────────────────── */
async function resizeImageToBase64(arrayBuffer, mimeType) {
  return new Promise((resolve, reject) => {
    // Build a blob URL so we can draw onto a canvas
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        if (width >= height) {
          height = Math.round((height / width) * MAX_IMAGE_DIM);
          width  = MAX_IMAGE_DIM;
        } else {
          width  = Math.round((width / height) * MAX_IMAGE_DIM);
          height = MAX_IMAGE_DIM;
        }
      }

      const canvas  = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);

      // Always output as JPEG for smaller size; quality 0.85
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for resizing."));
    };

    img.src = url;
  });
}

/* ─────────────────────────────────────────────
   Vision model
───────────────────────────────────────────── */
export async function queryImageModel(imageBuffer, mimeType = "image/jpeg", question = "Describe this image in detail.") {
  // Resize + compress image before sending — prevents 400 from oversized payloads
  const dataUrl = await resizeImageToBase64(imageBuffer, mimeType);

  const payload = {
    model:    VISION_MODEL,
    messages: [
      {
        role:    "user",
        content: [
          // Text first — recommended ordering for Qwen VL via HF router
          { type: "text",      text: question },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens:  MAX_NEW_TOKENS,
    temperature: 0.5,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(HF_CHAT_URL, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (res.status === 503) {
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
      throw new Error("Image model is loading. Please try again shortly.");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Image API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content.trim();
    throw new Error("Unexpected response format from image model.");
  }
}

/* ─────────────────────────────────────────────
   Utility
───────────────────────────────────────────── */
export function truncateToTokenLimit(text, maxTokens = 2800) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[...content truncated for length...]";
}