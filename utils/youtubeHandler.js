/**
 * youtubeHandler.js
 * Detects YouTube watch pages, extracts transcript captions from the DOM,
 * filters to the last 3 minutes of playback, and builds an AI prompt context.
 */

const LOOKBACK_SECONDS = 180; // 3 minutes

/**
 * Check if a given URL is a YouTube watch page.
 * @param {string} url
 * @returns {boolean}
 */
export function isYouTubePage(url = "") {
  return /^https?:\/\/(www\.)?youtube\.com\/watch/.test(url);
}

/**
 * Request YouTube transcript + current time from the content script.
 * @param {number} tabId
 * @returns {Promise<{ captions: Array, currentTime: number }>}
 */
async function fetchYouTubeData(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_YOUTUBE_DATA" }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response || response.error) {
        return reject(new Error(response?.error || "No response from YouTube page."));
      }
      resolve(response);
    });
  });
}

/**
 * Parse a timestamp string ("1:23" or "1:23:45") into total seconds.
 * @param {string} ts
 * @returns {number}
 */
function parseTimestamp(ts = "") {
  const parts = ts.trim().split(":").map(Number);
  if (parts.some(isNaN)) return -1;

  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

/**
 * Filter captions to only those within the last N seconds of currentTime.
 * @param {Array<{ time: string, text: string }>} captions
 * @param {number} currentTime - Video playback position in seconds
 * @param {number} [lookback]  - Window size in seconds (default 180)
 * @returns {Array<{ time: string, text: string }>}
 */
export function filterRecentCaptions(captions, currentTime, lookback = LOOKBACK_SECONDS) {
  const windowStart = Math.max(0, currentTime - lookback);

  return captions.filter(({ time }) => {
    const seconds = parseTimestamp(time);
    return seconds >= windowStart && seconds <= currentTime;
  });
}

/**
 * Format filtered captions into a readable transcript block.
 * @param {Array<{ time: string, text: string }>} captions
 * @returns {string}
 */
function formatTranscript(captions) {
  return captions
    .map(({ time, text }) => `[${time}] ${text.trim()}`)
    .join("\n");
}

/**
 * Format seconds into a human-readable "Xm Ys" string.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Main entry — fetch, filter, and prepare YouTube transcript context.
 *
 * @param {number} tabId
 * @returns {Promise<{
 *   transcript: string,
 *   currentTime: number,
 *   captionCount: number,
 *   windowStart: number
 * }>}
 */
export async function getRecentTranscript(tabId) {
  const { captions, currentTime } = await fetchYouTubeData(tabId);

  if (!Array.isArray(captions) || captions.length === 0) {
    throw new Error(
      "No transcript found. Make sure captions are enabled for this video."
    );
  }

  const recent = filterRecentCaptions(captions, currentTime);

  if (recent.length === 0) {
    throw new Error(
      `No captions found in the last ${LOOKBACK_SECONDS / 60} minutes. ` +
      `Try seeking to a later point in the video.`
    );
  }

  const transcript = formatTranscript(recent);
  const windowStart = Math.max(0, currentTime - LOOKBACK_SECONDS);

  return {
    transcript,
    currentTime,
    captionCount: recent.length,
    windowStart,
  };
}

/**
 * Build the system note for YouTube transcript Q&A.
 *
 * @param {string} transcript  - Formatted transcript segment
 * @param {number} currentTime - Current playback time in seconds
 * @param {number} windowStart - Start of the transcript window in seconds
 * @returns {string}
 */
export function buildYouTubeSystemNote(transcript, currentTime, windowStart) {
  return `You are a helpful video content assistant.
Below is a transcript segment from a YouTube video.
This segment covers the last ${formatTime(currentTime - windowStart)} of playback \
(from ${formatTime(windowStart)} to ${formatTime(currentTime)}).

Answer the user's question using only this transcript.
If the answer is not covered in this segment, say so clearly.
Be concise and reference timestamps where helpful.

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---`;
}
