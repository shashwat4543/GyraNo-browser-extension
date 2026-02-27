/**
 * pdfHandler.js
 * Extracts text from uploaded PDF files using pdf.js (loaded via CDN in popup.html).
 * Combines extracted text + user question into an AI-ready prompt context.
 */

// pdf.js exposes pdfjsLib globally via the CDN script tag in popup.html
const getPdfjsLib = () => {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("pdf.js is not loaded. Check the CDN script in popup.html.");
  }
  // Point worker to CDN to avoid bundling issues in MV3
  pdfjsLib.GlobalWorkerOptions.workerSrc =
  chrome.runtime.getURL("lib/pdf.worker.min.js");
  return pdfjsLib;
};

const MAX_PAGES    = 40;   // Safety cap — very long PDFs would exceed context window
const MAX_CHARS    = 12000; // ~3000 tokens; leave room for prompt + response

/**
 * Read a File object into an ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read PDF file."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract all text from a pdf.js PDFDocumentProxy.
 * Iterates pages sequentially to preserve reading order.
 *
 * @param {PDFDocumentProxy} pdfDoc
 * @returns {Promise<string>}
 */
async function extractTextFromDoc(pdfDoc) {
  const totalPages = Math.min(pdfDoc.numPages, MAX_PAGES);
  const pageTexts  = [];

  for (let i = 1; i <= totalPages; i++) {
    const page    = await pdfDoc.getPage(i);
    const content = await page.getTextContent();

    // Join text items, preserving line breaks via transform Y-position changes
    let lastY   = null;
    let lineAcc = [];
    const lines = [];

    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform?.[5] ?? 0;

      if (lastY !== null && Math.abs(y - lastY) > 5) {
        lines.push(lineAcc.join(" "));
        lineAcc = [];
      }

      lineAcc.push(item.str.trim());
      lastY = y;
    }

    if (lineAcc.length) lines.push(lineAcc.join(" "));

    const pageText = lines
      .filter((l) => l.trim().length > 0)
      .join("\n");

    if (pageText) {
      pageTexts.push(`[Page ${i}]\n${pageText}`);
    }
  }

  if (pdfDoc.numPages > MAX_PAGES) {
    pageTexts.push(`\n[Note: Only first ${MAX_PAGES} of ${pdfDoc.numPages} pages were processed.]`);
  }

  return pageTexts.join("\n\n");
}

/**
 * Main entry — load a PDF File and return extracted text.
 *
 * @param {File} file - PDF File object from input or drop
 * @returns {Promise<{ text: string, pageCount: number, fileName: string }>}
 */
export async function extractPdfText(file) {
  if (!file || file.type !== "application/pdf") {
    throw new Error("Please upload a valid PDF file.");
  }

  const lib      = getPdfjsLib();
  const buffer   = await readFileAsArrayBuffer(file);
  const loadTask = lib.getDocument({ data: buffer });
  const pdfDoc   = await loadTask.promise;

  let text = await extractTextFromDoc(pdfDoc);

  if (!text.trim()) {
    throw new Error(
      "No extractable text found. This PDF may be scanned or image-based."
    );
  }

  // Truncate to context-safe length
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) +
      "\n\n[...PDF truncated — only first portion processed...]";
  }

  return {
    text,
    pageCount: pdfDoc.numPages,
    fileName:  file.name,
  };
}

/**
 * Build the system note for PDF Q&A mode.
 *
 * @param {string} pdfText   - Extracted PDF text
 * @param {string} fileName  - Original file name
 * @returns {string}
 */
export function buildPdfSystemNote(pdfText, fileName) {
  return `You are a helpful document assistant.
The user has uploaded a PDF file named "${fileName}".
Answer their question using only the content provided below.
If the answer is not found in the document, say so clearly.

--- PDF CONTENT START ---
${pdfText}
--- PDF CONTENT END ---`;
}
