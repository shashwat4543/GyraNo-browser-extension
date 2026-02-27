/**
 * imageHandler.js
 * Handles image upload → binary conversion → vision model captioning → follow-up Q&A.
 * ✅ FIX: Updated buildImageFollowUpSystemNote and caption flow to work with
 *         the new vision-based queryImageModel (passes buffer + question, not just buffer).
 */

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE   = 5 * 1024 * 1024; // 5 MB

function validateImage(file) {
  if (!file) throw new Error("No file provided.");
  if (!SUPPORTED_TYPES.includes(file.type)) {
    throw new Error(
      `Unsupported file type: ${file.type}. Please upload a JPEG, PNG, WebP, or GIF.`
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 5 MB.`
    );
  }
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image for preview."));
    reader.readAsDataURL(file);
  });
}

export async function prepareImage(file) {
  validateImage(file);
  const [buffer, dataURL] = await Promise.all([
    readFileAsArrayBuffer(file),
    readFileAsDataURL(file),
  ]);
  return { buffer, dataURL, file };
}

/**
 * Build the system note for image follow-up Q&A.
 * ✅ FIX: Now returns a system note for TEXT follow-ups after initial captioning.
 *         The caption from the vision model is used as grounding context for
 *         subsequent text-only questions (avoiding re-sending the image each time).
 */
export function buildImageFollowUpSystemNote(caption) {
  return `You are a helpful visual assistant.
An image was analyzed and described as follows:

"${caption}"

Answer the user's question based on this image description.
If the question cannot be answered from the description alone, say so honestly.
Be concise and specific.`;
}

export function formatCaption(raw = "") {
  const trimmed = raw.trim();
  if (!trimmed) return "No description could be generated for this image.";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capitalized.endsWith(".") ? capitalized : capitalized + ".";
}

export function getFileIcon(file) {
  if (file.type.startsWith("image/")) return "🖼️";
  return "📄";
}