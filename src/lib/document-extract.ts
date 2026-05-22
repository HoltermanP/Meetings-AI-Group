import mammoth from "mammoth";

const MAX_EXTRACT_CHARS = 80_000;

export const ALLOWED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
]);

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function mimeFromFileName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  return null;
}

function truncate(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.length <= MAX_EXTRACT_CHARS) return t;
  return `${t.slice(0, MAX_EXTRACT_CHARS)}\n\n[… tekst ingekort voor verwerking …]`;
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return truncate(buffer.toString("utf-8"));
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return truncate(result.value || "");
  }

  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return truncate(typeof data.text === "string" ? data.text : "");
  }

  throw new Error(`Bestandstype niet ondersteund: ${fileName}`);
}
