# GyraNō 🧠

GyraNō is an AI-powered browser extension designed to enhance the way users consume YouTube content. 
It intelligently processes video data and generates concise summaries through a clean, distraction-free interface.

Built with performance and simplicity in mind, GyraNō focuses on delivering fast, readable insights without interrupting the viewing experience.

## ✨ Features

| Mode | Description |
|------|-------------|
| **Ask Page** | Ask any question about the current webpage — follow up naturally |
| **Scrape** | Extract and summarize structured page content (title, headings, body) |
| **PDF** | Upload a PDF and have a full conversation about its contents |
| **Image** | Upload a screenshot — get an AI caption then ask follow-up questions |
| **YouTube** | Analyze and discuss the last 3 minutes of any YouTube video transcript |

**Conversation features:**
- Per-mode chat history — each tab keeps its own independent conversation
- Context is cached on first message and reused for all follow-ups (no re-scraping)
- Switch tabs freely — return to any mode and your conversation is still there
- Live turn counter and message count in the UI
- Timestamped chat bubbles with typing animation

---

## 📁 Project Structure

```
ai-extension/
├── manifest.json              # MV3 manifest, permissions, CSP
├── popup.html                 # Extension popup UI (chat thread)
├── popup.js                   # Main orchestration + history logic
├── background.js              # MV3 service worker
├── content.js                 # Injected page script (DOM extraction)
├── style.css                  # Glassmorphism dark UI + chat bubbles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── utils/
    ├── api.js                 # HuggingFace API + multi-turn prompt builder
    ├── pdfHandler.js          # pdf.js text extraction
    ├── imageHandler.js        # Image prep + BLIP captioning
    ├── scraper.js             # Structured page scraping
    └── youtubeHandler.js      # Transcript extraction + timestamp filtering
```

---

## 🚀 Setup Guide

### Step 1 — Get a HuggingFace API Key

1. Go to [https://huggingface.co](https://huggingface.co) and create a free account
2. Navigate to **Settings → Access Tokens**
3. Click **New token** → select role **Read** → copy the token

> The free tier is sufficient — no credit card required.

---

### Step 2 — Add Your API Key

Open `utils/api.js` and replace the placeholder on line 4:

```js
// Before
const HF_API_KEY = "hf_YOUR_API_KEY_HERE";

// After
const HF_API_KEY = "hf_abc123yourrealtokenhere";
```

> ⚠️ **Security Note:** Never commit your API key to a public repository.
> For production use, route requests through your own backend proxy that injects
> the `Authorization` header server-side.

---

### Step 3 — Add the PING Handler to content.js

Open `content.js` and add a `PING` case inside the `switch (message.type)` block.
This lets the background script verify the content script is alive before sending messages.

---


### Step 5 — Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the `ai-extension/` folder (the one containing `manifest.json`)
5. The extension will appear in your toolbar

> If you don't see the icon, click the puzzle piece 🧩 in the toolbar and pin **GyraNō**.

---

### Step 6 — Verify It's Working

1. Navigate to any Wikipedia article
2. Click the extension icon
3. Make sure you're on the **Ask Page** tab
4. Type: `What is this page about?` and press **Enter**
5. You should see your message appear as a chat bubble, then the AI typing indicator, then a response

If the response takes 20–30 seconds on first use, that's normal — the model is waking up on HuggingFace's free tier. Subsequent messages are faster.

---

## 💬 Using Conversation History

Each mode maintains its own independent chat thread:

- **Ask follow-up questions** — the AI remembers the full conversation. Ask "Can you elaborate on that?" or "What about X?" and it will respond in context
- **Switch tabs freely** — clicking Scrape then back to Ask Page restores your Ask Page conversation exactly where you left off
- **Clear a conversation** — click the trash icon in the header to reset the current mode's history and start fresh
- **New file = new conversation** — uploading a different PDF or image automatically clears that mode's history and loads the new context
- **Context divider** — if the page context is refreshed mid-conversation (e.g. after clearing), a visual divider appears in the thread

---

## 🧪 Testing Each Mode

### Ask Page
1. Navigate to any webpage (Wikipedia works great)
2. Click the extension icon → **Ask Page** tab
3. Ask a question — then ask a follow-up referencing the first answer

### Scrape
1. Navigate to any article or blog post
2. Select the **Scrape** tab
3. Send with no text to get a structured summary, or ask a specific question

### PDF
1. Select the **PDF** tab
2. Drag and drop a PDF or click to browse (text-based PDFs only, max 40 pages)
3. Ask questions about the document — the AI remembers your conversation about it

### Image
1. Select the **Image** tab
2. Upload a screenshot or photo (JPEG, PNG, WebP, GIF — max 5 MB)
3. The AI automatically generates a caption as the first message
4. Ask follow-up questions: "What color is the background?" / "Is there any text visible?"

### YouTube
1. Navigate to a YouTube video (`youtube.com/watch?v=...`)
2. Play the video to the point you want to analyze
3. Select the **YouTube** tab — verify the green badge shows "YouTube detected"
4. Ask a question — the AI analyzes the last 3 minutes of transcript from your current position
5. Ask follow-ups: "What did they say about X?" / "Summarize just the last minute"

---

## ⚙️ Configuration

All tunable constants are at the top of their respective files:

| File | Constant | Default | Description |
|------|----------|---------|-------------|
| `utils/api.js` | `HF_API_KEY` | `"hf_YOUR_API_KEY_HERE"` | Your HuggingFace token |
| `utils/api.js` | `MAX_NEW_TOKENS` | `512` | Max tokens per AI response |
| `utils/api.js` | `RETRY_DELAY_MS` | `8000` | Wait time on 503 (model loading) |
| `utils/api.js` | `MAX_RETRIES` | `2` | Retry attempts on failure |
| `utils/api.js` | `MAX_HISTORY_TURNS` | `10` | Max conversation turns sent to AI |
| `utils/pdfHandler.js` | `MAX_PAGES` | `40` | Max PDF pages to extract |
| `utils/pdfHandler.js` | `MAX_CHARS` | `12000` | Max PDF characters sent to AI |
| `utils/imageHandler.js` | `MAX_FILE_SIZE` | `5 MB` | Max image upload size |
| `utils/youtubeHandler.js` | `LOOKBACK_SECONDS` | `180` | Transcript window size (3 min) |

---

## 🤖 AI Models Used

| Purpose | Model |
|---------|-------|
| Text Q&A, summarization, chat | `meta-llama/Llama-3.1-8B-Instruct` |
| Image captioning | `Salesforce/blip-image-captioning-base` |

Both models are free via the [HuggingFace Inference API](https://huggingface.co/inference-api).

> **Cold start:** Free tier models sleep after inactivity. The first request may take 20–30 seconds while the model loads. The extension retries automatically up to 2 times on a 503 response.

---

## 🐛 Troubleshooting

**"No response from content script"**
- Refresh the tab and try again. Content scripts don't inject into tabs that were open before the extension was installed — a refresh fixes this.

**"Model is still loading"**
- Normal on the free tier after inactivity. Wait ~30 seconds and send again. The extension retries automatically but you can also just resend.

**"No transcript found" (YouTube)**
- Make sure the video has captions. Click the **CC** button on the YouTube player to enable them, then try again. Auto-generated captions work too.

**"No extractable text found" (PDF)**
- The PDF is scanned/image-based and has no text layer. Use an OCR tool (e.g. Adobe Acrobat, Smallpdf) to convert it to a text PDF first.

**Conversation not remembering context**
- Check that you haven't switched tabs and back — each mode has separate history. If you switched modes, the context for that mode is restored but the other mode's context is separate by design.

**Extension not appearing in toolbar**
- Go to `chrome://extensions`, check for any red error badges, and click **Errors** to see details. Most commonly caused by a syntax error if you manually edited a file.

**Icons missing / broken**
- Make sure the `icons/` folder exists inside `ai-extension/` and contains `icon16.png`, `icon48.png`, and `icon128.png`. Without these, Chrome may refuse to load the extension.

---

## 🔒 Security & Privacy

- API key lives only in `utils/api.js` — never written to `chrome.storage` or sent anywhere except HuggingFace
- Page content, PDFs, and images are sent **directly** to HuggingFace — no intermediate server
- Nothing is persisted between browser sessions — all history resets when the popup closes
- For public/production distribution, proxy all API calls through your own backend to keep the key hidden

---

## 📄 License

GNU GPL V 2.0

© 2026 Shashwat Jha. All rights reserved.
