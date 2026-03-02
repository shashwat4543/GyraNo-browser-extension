/**
 * imageHandler.js
 * Handles image upload validation, binary reading, and context building.
 * The mimeType is now passed through to queryImageModel so the resizer
 * knows the original format before converting to JPEG for the API.
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
      `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`
    );
  }
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image for preview."));
    reader.readAsDataURL(file);
  });
}

/**
 * Validate and prepare image file.
 * Returns buffer (for API), dataURL (for preview), mimeType, and original file.
 * mimeType is now explicitly returned so it can be forwarded to queryImageModel.
 */
export async function prepareImage(file) {
  validateImage(file);
  const [buffer, dataURL] = await Promise.all([
    readFileAsArrayBuffer(file),
    readFileAsDataURL(file),
  ]);
  return { buffer, dataURL, mimeType: file.type, file };
}

export function buildImageFollowUpSystemNote(caption) {
  return `You are a helpful visual assistant.
An image was analyzed and described as:

"${caption}"

Answer the user's question based on this description.
If the question cannot be answered from the description alone, say so clearly.
Be concise and specific.`;
}

export function formatCaption(raw = "") {
  const trimmed = raw.trim();
  if (!trimmed) return "No description could be generated for this image.";
  const cap = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return cap.endsWith(".") ? cap : cap + ".";
}

export function getFileIcon(file) {
  return file.type.startsWith("image/") ? "🖼️" : "📄";
}