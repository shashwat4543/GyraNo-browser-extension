// ⚠️ PRODUCTION NOTE: Move API key to a backend proxy to avoid exposing it client-side.

const HF_API_KEY = "YOUR_HUGGING_FACE_API";

const HF_CHAT_URL  = "https://router.huggingface.co/v1/chat/completions";
// ✅ FIX: Removed ":auto" suffix — causes 400 "provider not valid" error
const TEXT_MODEL   = "meta-llama/Llama-3.1-8B-Instruct";
const VISION_MODEL = "meta-llama/Llama-3.2-11B-Vision-Instruct";

const MAX_NEW_TOKENS = 512;
const RETRY_DELAY_MS = 8000;
const MAX_RETRIES    = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function buildPrompt(systemNote, userMessage) {
  return `${systemNote.trim()}\n\n${userMessage.trim()}`;
}

/**
 * Build messages array for chat completions API (replaces old Mistral prompt strings).
 * ✅ FIX: Uses proper OpenAI-compatible messages format instead of manual prompt templating.
 */
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

/**
 * Call the HuggingFace text chat completions endpoint.
 * ✅ FIX: Accepts messages array (new) or legacy string prompt.
 */
export async function queryTextModel(promptOrMessages, options = {}) {
  const messages = Array.isArray(promptOrMessages)
    ? promptOrMessages
    : [{ role: "user", content: promptOrMessages }];

  const payload = {
    model: TEXT_MODEL,
    messages,
    max_tokens: options.max_new_tokens ?? MAX_NEW_TOKENS,
    temperature: options.temperature ?? 0.7,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
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
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    throw new Error("Unexpected response format from model.");
  }
}

/**
 * Call the vision model for image captioning / Q&A.
 * ✅ FIX: Replaced broken fetch (used undefined `prompt` variable) with proper
 *         vision chat message using base64 image_url format.
 */
export async function queryImageModel(imageBuffer, question = "Describe this image in detail.") {
  // Convert ArrayBuffer → base64
  const uint8 = new Uint8Array(imageBuffer);
  let binary  = "";
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const base64  = btoa(binary);
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const payload = {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text",      text: question },
        ],
      },
    ],
    max_tokens: MAX_NEW_TOKENS,
    temperature: 0.5,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
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
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    throw new Error("Unexpected response format from image model.");
  }
}

export function truncateToTokenLimit(text, maxTokens = 2800) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[...content truncated for length...]";
}