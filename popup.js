/**
 * popup.js
 * Full conversation history + context-aware AI assistant popup.
 */

import { queryTextModel, queryImageModel, buildPrompt, buildConversationPrompt, truncateToTokenLimit } from "./utils/api.js";
import { scrapePage, buildScrapeSystemNote } from "./utils/scraper.js";
import { extractPdfText, buildPdfSystemNote } from "./utils/pdfHandler.js";
import { prepareImage, buildImageFollowUpSystemNote, formatCaption } from "./utils/imageHandler.js";
import { isYouTubePage, getRecentTranscript, buildYouTubeSystemNote } from "./utils/youtubeHandler.js";

/* ─────────────────────────────────────────────
   State
───────────────────────────────────────────── */
const state = {
  mode:         "ask",
  activeTab:    null,
  // Per-mode conversation histories
  histories: { ask: [], scrape: [], pdf: [], image: [], youtube: [] },
  // Per-mode context (system notes cached so follow-ups reuse same context)
  contexts:  { ask: null, scrape: null, pdf: null, image: null, youtube: null },
  // File state
  pdfFile:      null,
  pdfText:      null,
  imageFile:    null,
  imageCaption: null,
  imageBuffer:  null,
  // UI lock
  isLoading:    false,
};

/* ─────────────────────────────────────────────
   DOM
───────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const els = {
  tabs:            document.querySelectorAll(".tab"),
  uploadZone:      $("uploadZone"),
  uploadInner:     $("uploadInner"),
  uploadPreview:   $("uploadPreview"),
  uploadHint:      $("uploadHint"),
  fileInput:       $("fileInput"),
  previewName:     $("previewName"),
  btnRemoveFile:   $("btnRemoveFile"),
  ytBadge:         $("ytBadge"),
  ytBadgeText:     $("ytBadgeText"),
  questionInput:   $("questionInput"),
  btnSend:         $("btnSend"),
  btnClear:        $("btnClear"),
  btnCopy:         $("btnCopy"),
  idleState:       $("idleState"),
  chatWrap:        $("chatWrap"),
  chatThread:      $("chatThread"),
  typingIndicator: $("typingIndicator"),
  errorBox:        $("errorBox"),
  errorText:       $("errorText"),
  chatFooter:      $("chatFooter"),
  contextBadge:    $("contextBadge"),
  turnCount:       $("turnCount"),
};

/* ─────────────────────────────────────────────
   Init
───────────────────────────────────────────── */
async function init() {
  await resolveActiveTab();
  bindTabs();
  bindUpload();
  bindActions();
  applyModeUI("ask");
}

async function resolveActiveTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }, (res) => {
      if (res?.tab) state.activeTab = res.tab;
      resolve();
    });
  });
}

/* ─────────────────────────────────────────────
   Tab Switching
───────────────────────────────────────────── */
function bindTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (state.isLoading) return;
      els.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      applyModeUI(tab.dataset.mode);
    });
  });
}

function applyModeUI(mode) {
  state.mode = mode;
  hideError();

  const placeholders = {
    ask:     "Ask anything about this page…",
    scrape:  "Ask me to summarize or explain this page…",
    pdf:     "Ask a question about the PDF…",
    image:   "Ask about the uploaded image…",
    youtube: "Ask about the last 3 minutes of this video…",
  };
  els.questionInput.placeholder = placeholders[mode] || "Ask anything…";

  // Upload zone
  const needsUpload = mode === "pdf" || mode === "image";
  els.uploadZone.classList.toggle("hidden", !needsUpload);
  if (mode === "pdf") {
    els.fileInput.accept = ".pdf";
    els.uploadHint.textContent = "Supports PDF files";
  } else if (mode === "image") {
    els.fileInput.accept = "image/*";
    els.uploadHint.textContent = "Supports JPEG, PNG, WebP, GIF (max 5 MB)";
  }

  // YouTube badge
  const isYT = state.activeTab && isYouTubePage(state.activeTab.url);
  els.ytBadge.classList.toggle("hidden", mode !== "youtube");
  if (mode === "youtube") {
    if (isYT) {
      els.ytBadge.style.cssText = "";
      els.ytBadgeText.style.cssText = "";
      els.ytBadgeText.textContent = "YouTube detected — transcript ready";
    } else {
      els.ytBadge.style.borderColor = "rgba(255,200,0,0.3)";
      els.ytBadge.style.background  = "rgba(255,200,0,0.06)";
      els.ytBadgeText.style.color   = "#fde68a";
      els.ytBadgeText.textContent   = "Not a YouTube video page";
    }
  }

  // Restore thread for this mode
  renderThread(mode);
}

/* ─────────────────────────────────────────────
   File Upload
───────────────────────────────────────────── */
function bindUpload() {
  els.uploadInner.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
  els.btnRemoveFile.addEventListener("click", () => {
    clearFileState();
    // Clear context so next send re-extracts
    state.contexts[state.mode] = null;
  });

  els.uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.uploadZone.classList.add("drag-over");
  });
  els.uploadZone.addEventListener("dragleave", () => {
    els.uploadZone.classList.remove("drag-over");
  });
  els.uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) handleFileSelect(file);
  });
}

async function handleFileSelect(file) {
  if (!file) return;
  hideError();

  if (state.mode === "pdf") {
    state.pdfFile  = file;
    state.pdfText  = null;
    state.contexts.pdf = null;
    state.histories.pdf = [];
    showFilePreview("📄", file.name);
    renderThread("pdf");
  } else if (state.mode === "image") {
    try {
      const { buffer } = await prepareImage(file);
      state.imageFile    = file;
      state.imageBuffer  = buffer;
      state.imageCaption = null;
      state.contexts.image = null;
      state.histories.image = [];
      showFilePreview("🖼️", file.name);
      renderThread("image");
    } catch (err) {
      showError(err.message);
    }
  }
}

function showFilePreview(icon, name) {
  els.uploadInner.classList.add("hidden");
  els.uploadPreview.classList.remove("hidden");
  els.uploadPreview.querySelector(".preview-icon").textContent = icon;
  els.previewName.textContent = name;
}

function clearFileState() {
  state.pdfFile = null; state.pdfText = null;
  state.imageFile = null; state.imageCaption = null; state.imageBuffer = null;
  els.fileInput.value = "";
  els.uploadInner.classList.remove("hidden");
  els.uploadPreview.classList.add("hidden");
}

/* ─────────────────────────────────────────────
   Actions
───────────────────────────────────────────── */
function bindActions() {
  els.btnSend.addEventListener("click", handleSend);
  els.questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  els.btnClear.addEventListener("click", handleClear);
  els.btnCopy.addEventListener("click", handleCopy);
}

async function handleSend() {
  if (state.isLoading) return;
  const question = els.questionInput.value.trim();
  if (!question && !["scrape", "youtube"].includes(state.mode) &&
      !(state.mode === "image" && state.imageFile)) return;

  els.questionInput.value = "";
  setLoading(true);
  hideError();

  // Add user bubble immediately
  const userText = question || getDefaultQuestion(state.mode);
  appendMessage("user", userText);

  try {
    await ensureContentScriptReady();

    let systemNote = state.contexts[state.mode];
    const history  = state.histories[state.mode];

    // Build system note only if not cached (first message or new file)
    if (!systemNote) {
      systemNote = await buildSystemNote(state.mode, question);
      state.contexts[state.mode] = systemNote;
      // Add context divider if resuming with new context
      if (history.length > 0) appendDivider("Context refreshed");
    }

    // Build prompt with full conversation history
    const prompt = buildConversationPrompt(systemNote, history, userText);
    const response = await queryTextModel(prompt);

    // Save both turns to history
    history.push({ role: "user",      content: userText });
    history.push({ role: "assistant", content: response });

    setLoading(false);
    appendMessage("ai", response, true);
    updateFooter();

  } catch (err) {
    setLoading(false);
    // Remove the optimistic user bubble on error
    const msgs = els.chatThread.querySelectorAll(".chat-message");
    if (msgs.length) msgs[msgs.length - 1].remove();
    showError(err.message);
  }
}

function getDefaultQuestion(mode) {
  const defaults = {
    ask:     "Summarize this page.",
    scrape:  "Summarize this page.",
    pdf:     "Summarize this document.",
    image:   "Describe this image.",
    youtube: "Summarize the last 3 minutes.",
  };
  return defaults[mode];
}

/**
 * Build the system note for a given mode.
 * This is called once per context — on first message or after file change.
 */
async function buildSystemNote(mode, question) {
  switch (mode) {

    case "ask": {
      const res = await sendToContentScript("ASK_PAGE");
      const pageText = truncateToTokenLimit(res.text);
      return `You are a helpful assistant with access to the current webpage content.
Answer all questions using this page as your primary source.
Maintain context across the conversation — refer to previous answers when relevant.

--- PAGE CONTENT ---
${pageText}
--- END ---`;
    }

    case "scrape": {
      const { structured } = await scrapePage(state.activeTab.id);
      return buildScrapeSystemNote(structured);
    }

    case "pdf": {
      if (!state.pdfFile) throw new Error("Please upload a PDF file first.");
      if (!state.pdfText) {
        const { text } = await extractPdfText(state.pdfFile);
        state.pdfText = text;
      }
      return buildPdfSystemNote(state.pdfText, state.pdfFile.name);
    }

    case "image": {
      if (!state.imageFile) throw new Error("Please upload an image first.");
      if (!state.imageCaption) {
        const blob = new Blob([state.imageBuffer], { type: state.imageFile.type });
        const raw  = await queryImageModel(blob);
        state.imageCaption = formatCaption(raw);
        // Show caption as first AI message
        appendMessage("ai", `🖼️ Image description:\n\n${state.imageCaption}`);
        state.histories.image.push({ role: "assistant", content: state.imageCaption });
        updateFooter();
      }
      return buildImageFollowUpSystemNote(state.imageCaption);
    }

    case "youtube": {
      if (!state.activeTab || !isYouTubePage(state.activeTab.url)) {
        throw new Error("Please navigate to a YouTube video page and try again.");
      }
      const { transcript, currentTime, windowStart } =
        await getRecentTranscript(state.activeTab.id);
      return buildYouTubeSystemNote(transcript, currentTime, windowStart);
    }

    default:
      throw new Error("Unknown mode.");
  }
}

function handleClear() {
  if (state.isLoading) return;
  state.histories[state.mode] = [];
  state.contexts[state.mode]  = null;
  // For pdf/image, also reset file so context is fully fresh
  if (state.mode === "pdf")   { state.pdfText = null; }
  if (state.mode === "image") { state.imageCaption = null; }
  renderThread(state.mode);
  hideError();
}

async function handleCopy() {
  const history = state.histories[state.mode];
  const lastAI  = [...history].reverse().find((t) => t.role === "assistant");
  if (!lastAI) return;

  try {
    await navigator.clipboard.writeText(lastAI.content);
    els.btnCopy.classList.add("copied");
    els.btnCopy.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      els.btnCopy.classList.remove("copied");
      els.btnCopy.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy last`;
    }, 2000);
  } catch {
    showError("Clipboard access denied.");
  }
}

/* ─────────────────────────────────────────────
   Thread Rendering
───────────────────────────────────────────── */

/**
 * Re-render the full chat thread from history for the given mode.
 */
function renderThread(mode) {
  const history = state.histories[mode];

  if (history.length === 0) {
    showIdle();
    return;
  }

  els.idleState.classList.add("hidden");
  els.chatThread.classList.remove("hidden");
  els.chatThread.innerHTML = "";

  history.forEach((turn) => {
    const el = createBubbleEl(turn.role === "user" ? "user" : "ai", turn.content);
    els.chatThread.appendChild(el);
  });

  updateFooter();
  scrollThread();
}

/**
 * Append a single new message bubble to the thread (live, with animation).
 * @param {"user"|"ai"} role
 * @param {string} text
 * @param {boolean} [animate] - use word-by-word typing for AI
 */
function appendMessage(role, text, animate = false) {
  els.idleState.classList.add("hidden");
  els.chatThread.classList.remove("hidden");

  const el = createBubbleEl(role, animate ? "" : text);
  els.chatThread.appendChild(el);
  scrollThread();

  if (animate && role === "ai") {
    const bubble = el.querySelector(".chat-bubble");
    typeIntoBubble(bubble, text);
  }
}

/**
 * Create a full message row element (avatar + bubble + timestamp).
 */
function createBubbleEl(role, text) {
  const isUser = role === "user";

  const row = document.createElement("div");
  row.className = `chat-message ${isUser ? "user-message" : "ai-message"}`;

  const avatar = document.createElement("div");
  avatar.className = isUser ? "user-avatar" : "ai-avatar";
  avatar.textContent = isUser ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isUser ? "user-bubble" : "ai-bubble"}`;
  bubble.textContent = text;

  const time = document.createElement("span");
  time.className = "bubble-time";
  time.textContent = nowTime();

  const inner = document.createElement("div");
  inner.style.cssText = "display:flex;flex-direction:column;max-width:82%";
  inner.appendChild(bubble);
  inner.appendChild(time);

  row.appendChild(avatar);
  row.appendChild(inner);

  return row;
}

/**
 * Word-by-word typing animation into a bubble element.
 */
function typeIntoBubble(bubble, text) {
  bubble.classList.add("typing");
  const words = text.split(" ");
  let idx = 0;

  const tick = () => {
    if (idx >= words.length) {
      bubble.classList.remove("typing");
      updateFooter();
      return;
    }
    bubble.textContent += (idx === 0 ? "" : " ") + words[idx];
    scrollThread();
    idx++;
    setTimeout(tick, 16);
  };
  tick();
}

/**
 * Append a visual divider between context segments.
 */
function appendDivider(label) {
  const div = document.createElement("div");
  div.className = "context-divider";
  div.innerHTML = `
    <div class="context-divider-line"></div>
    <span class="context-divider-label">${label}</span>
    <div class="context-divider-line"></div>`;
  els.chatThread.appendChild(div);
  scrollThread();
}

function scrollThread() {
  els.chatThread.scrollTop = els.chatThread.scrollHeight;
}

function showIdle() {
  els.idleState.classList.remove("hidden");
  els.chatThread.classList.add("hidden");
  els.chatFooter.classList.add("hidden");
  els.turnCount.classList.add("hidden");
}

/* ─────────────────────────────────────────────
   Footer + Turn Counter
───────────────────────────────────────────── */
function updateFooter() {
  const history = state.histories[state.mode];
  const turns   = history.length;

  if (turns === 0) {
    els.chatFooter.classList.add("hidden");
    els.turnCount.classList.add("hidden");
    return;
  }

  const msgCount = turns;
  els.contextBadge.textContent = `${msgCount} message${msgCount !== 1 ? "s" : ""}`;
  els.chatFooter.classList.remove("hidden");

  const turnPairs = Math.floor(turns / 2);
  els.turnCount.textContent = `${turnPairs} turn${turnPairs !== 1 ? "s" : ""}`;
  els.turnCount.classList.remove("hidden");
}

/* ─────────────────────────────────────────────
   Loading State
───────────────────────────────────────────── */
function setLoading(on) {
  state.isLoading = on;
  els.btnSend.disabled = on;
  els.typingIndicator.classList.toggle("hidden", !on);
  if (on) {
    els.chatThread.classList.remove("hidden");
    els.idleState.classList.add("hidden");
    scrollThread();
  }
}

/* ─────────────────────────────────────────────
   Error
───────────────────────────────────────────── */
function showError(msg) {
  els.errorBox.classList.remove("hidden");
  els.errorText.textContent = msg;
}

function hideError() {
  els.errorBox.classList.add("hidden");
  els.errorText.textContent = "";
}

/* ─────────────────────────────────────────────
   Content Script Bridge
───────────────────────────────────────────── */
async function ensureContentScriptReady() {
  if (!state.activeTab?.id) throw new Error("No active tab found.");
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "ENSURE_CONTENT_SCRIPT", tabId: state.activeTab.id },
      (res) => {
        if (res?.ok) resolve();
        else reject(new Error(res?.error || "Could not inject content script."));
      }
    );
  });
}

function sendToContentScript(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.activeTab.id, { type, ...data }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res?.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ─────────────────────────────────────────────
   Boot
───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);
