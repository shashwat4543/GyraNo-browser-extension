/**
 * scraper.js
 * Extracts structured content from the current page via the content script.
 * Returns a clean text block ready to be sent to the AI model.
 */

/**
 * Request structured page data from the content script.
 * @param {number} tabId - Active tab ID
 * @returns {Promise<object>} - Raw scraped data object
 */
async function fetchPageData(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PAGE" }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response || response.error) {
        return reject(new Error(response?.error || "No response from content script."));
      }
      resolve(response);
    });
  });
}

/**
 * Clean a raw string — collapse whitespace, remove zero-width chars.
 * @param {string} str
 * @returns {string}
 */
function clean(str = "") {
  return str
    .replace(/[\u200B-\u200D\uFEFF]/g, "")   // zero-width chars
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a structured plain-text document from scraped page data.
 * @param {object} data
 * @returns {string}
 */
function buildStructuredText(data) {
  const lines = [];

  if (data.title) {
    lines.push(`PAGE TITLE: ${clean(data.title)}`);
    lines.push("");
  }

  if (data.metaDescription) {
    lines.push(`META DESCRIPTION: ${clean(data.metaDescription)}`);
    lines.push("");
  }

  if (data.headings && data.headings.length > 0) {
    lines.push("HEADINGS:");
    data.headings.forEach(({ level, text }) => {
      const indent = "  ".repeat(Math.max(0, level - 1));
      lines.push(`${indent}[H${level}] ${clean(text)}`);
    });
    lines.push("");
  }

  if (data.articleText) {
    lines.push("MAIN CONTENT:");
    lines.push(clean(data.articleText));
  }

  return lines.join("\n");
}

/**
 * Scrape the active tab and return a structured summary prompt context.
 *
 * @param {number} tabId
 * @returns {Promise<{ structured: string, raw: object }>}
 */
export async function scrapePage(tabId) {
  const raw = await fetchPageData(tabId);
  const structured = buildStructuredText(raw);

  if (!structured.trim()) {
    throw new Error("Could not extract meaningful content from this page.");
  }

  return { structured, raw };
}

/**
 * Build the AI prompt for summarization mode.
 * @param {string} structuredText - Output of buildStructuredText()
 * @returns {string} system note for buildPrompt()
 */
export function buildScrapeSystemNote(structuredText) {
  return `You are a precise web content analyst.
Below is structured content extracted from a webpage.
Provide a clear, well-organized summary covering:
- The main topic and purpose of the page
- Key points from the headings and content
- Any important details worth highlighting

Keep the summary concise but complete. Use plain text only.

--- PAGE CONTENT START ---
${structuredText}
--- PAGE CONTENT END ---`;
}
