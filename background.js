/**
 * background.js
 * MV3 Service Worker — handles tab queries and acts as a message relay
 * between popup and content scripts when direct messaging isn't possible.
 *
 * Also manages extension lifecycle events.
 */

/* ─────────────────────────────────────────────
   Installation & Update Lifecycle
───────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    console.log("[AI Assistant] Extension installed.");
  } else if (reason === "update") {
    console.log("[AI Assistant] Extension updated.");
  }
});

/* ─────────────────────────────────────────────
   Message Handler
   Relays requests from popup.js that need
   background-level chrome API access.
───────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case "GET_ACTIVE_TAB":
      getActiveTab()
        .then((tab) => sendResponse({ tab }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "ENSURE_CONTENT_SCRIPT":
      ensureContentScript(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    default:
      // Unknown message — ignore silently
      return false;
  }
});

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

/**
 * Get the currently active tab in the focused window.
 * @returns {Promise<chrome.tabs.Tab>}
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

/**
 * Programmatically inject content.js into a tab if it hasn't been injected yet.
 * This handles edge cases where the content script didn't load
 * (e.g. extension was installed after the tab was opened).
 *
 * @param {number} tabId
 */
async function ensureContentScript(tabId) {
  try {
    // Ping the content script — if it responds, it's already injected
    await pingContentScript(tabId);
  } catch {
    // No response — inject it now
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    // Brief wait for script to initialize
    await sleep(200);
  }
}

/**
 * Send a ping to the content script and expect a pong.
 * Rejects if the content script is not present.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function pingContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
      if (chrome.runtime.lastError || !response?.pong) {
        return reject(new Error("Content script not ready."));
      }
      resolve();
    });
  });
}

/**
 * Sleep helper for async delays.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
