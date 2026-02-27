/**
 * content.js
 * Injected into every page at document_idle.
 * Listens for messages from popup.js and returns extracted DOM data.
 *
 * Handles:
 *  - ASK_PAGE      → raw page text
 *  - SCRAPE_PAGE   → structured title, meta, headings, article text
 *  - GET_YOUTUBE_DATA → captions array + current video time
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  
  try {
    switch (message.type) {
      case "PING":
        sendResponse({ pong: true });
        break;
      case "ASK_PAGE":
        sendResponse(handleAskPage());
        break;

      case "SCRAPE_PAGE":
        sendResponse(handleScrapePage());
        break;

      case "GET_YOUTUBE_DATA":
        handleYouTubeData()
          .then(sendResponse)
          .catch((err) => sendResponse({ error: err.message }));
        return true; // keep channel open for async response

      default:
        sendResponse({ error: `Unknown message type: ${message.type}` });
    }
  } catch (err) {
    sendResponse({ error: err.message });
  }

  return false;
});

/* ─────────────────────────────────────────────
   ASK PAGE — raw body text
───────────────────────────────────────────── */
function handleAskPage() {
  const text = document.body?.innerText?.trim();
  if (!text) return { error: "Page has no readable text content." };

  // Truncate to ~12k chars to stay within token limits
  const truncated = text.length > 12000
    ? text.slice(0, 12000) + "\n\n[...page content truncated...]"
    : text;

  return { text: truncated };
}

/* ─────────────────────────────────────────────
   SCRAPE PAGE — structured content
───────────────────────────────────────────── */
function handleScrapePage() {
  const title = document.title?.trim() || "";

  const metaEl = document.querySelector('meta[name="description"]') ||
                 document.querySelector('meta[property="og:description"]');
  const metaDescription = metaEl?.getAttribute("content")?.trim() || "";

  // Collect all headings h1–h6 in DOM order
  const headingEls = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const headings = Array.from(headingEls)
    .map((el) => ({
      level: parseInt(el.tagName[1], 10),
      text:  el.innerText?.trim() || "",
    }))
    .filter((h) => h.text.length > 0)
    .slice(0, 60); // cap at 60 headings

  // Best-effort article body extraction
  const articleText = extractArticleText();

  return { title, metaDescription, headings, articleText };
}

/**
 * Extract the most content-rich text block from the page.
 * Priority: <article>, <main>, largest <div> by text length.
 */
function extractArticleText() {
  const candidates = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector('[role="main"]'),
    document.querySelector(".post-content, .entry-content, .article-body, .content"),
  ].filter(Boolean);

  if (candidates.length > 0) {
    const text = candidates[0].innerText?.trim() || "";
    return text.slice(0, 8000);
  }

  // Fallback: find the <div> or <section> with most text
  const blocks = Array.from(document.querySelectorAll("div, section"));
  let best = "";
  for (const el of blocks) {
    const t = el.innerText?.trim() || "";
    if (t.length > best.length && t.length < 50000) best = t;
  }

  return best.slice(0, 8000);
}

/* ─────────────────────────────────────────────
   YOUTUBE DATA — captions + current time
───────────────────────────────────────────── */
async function handleYouTubeData() {
  // Get current video playback time
  const video = document.querySelector("video");
  if (!video) throw new Error("No video element found on this page.");

  const currentTime = Math.floor(video.currentTime);

  // Try to open the transcript panel if not already open
  await ensureTranscriptOpen();

  // Wait briefly for DOM to populate after opening
  await sleep(800);

  const captions = extractCaptions();

  return { captions, currentTime };
}

/**
 * Attempt to open YouTube's transcript panel via the "..." menu.
 */
async function ensureTranscriptOpen() {
  // If transcript is already open, skip
  const existing = document.querySelector("ytd-transcript-segment-renderer");
  if (existing) return;

  // Click the "More actions" (⋮) button under the video
  const moreBtn = document.querySelector(
    'button[aria-label="More actions"], ytd-menu-renderer yt-icon-button'
  );
  if (moreBtn) {
    moreBtn.click();
    await sleep(500);
  }

  // Look for "Show transcript" in the popup menu
  const menuItems = Array.from(
    document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item")
  );
  const transcriptItem = menuItems.find((el) =>
    el.innerText?.toLowerCase().includes("transcript")
  );

  if (transcriptItem) {
    transcriptItem.click();
    await sleep(1000);
  }
}

/**
 * Extract caption segments from the open transcript panel.
 * Returns array of { time, text } objects.
 */
function extractCaptions() {
  // Primary selector — YouTube's transcript segment component
  const segments = document.querySelectorAll("ytd-transcript-segment-renderer");

  if (segments.length > 0) {
    return Array.from(segments).map((seg) => {
      const time = seg.querySelector(".segment-timestamp")?.innerText?.trim() || "0:00";
      const text = seg.querySelector(".segment-text")?.innerText?.trim() || "";
      return { time, text };
    }).filter((c) => c.text.length > 0);
  }

  // Fallback — older YouTube DOM structure
  const legacySegments = document.querySelectorAll(
    ".ytd-transcript-body-renderer .cue-group"
  );

  if (legacySegments.length > 0) {
    return Array.from(legacySegments).map((seg) => {
      const time = seg.querySelector(".cue-group-start-offset")?.innerText?.trim() || "0:00";
      const text = seg.querySelector(".cue")?.innerText?.trim() || "";
      return { time, text };
    }).filter((c) => c.text.length > 0);
  }

  return [];
}

/**
 * Simple sleep helper.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
