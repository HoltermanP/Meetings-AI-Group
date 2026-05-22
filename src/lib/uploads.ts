import path from "path";
import fs from "fs/promises";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function templateDocxRelativePath(userId: string, templateId: string): string {
  return path.join("templates", userId, `${templateId}.docx`);
}

export function absolutePathFromRelative(relative: string): string {
  return path.join(UPLOADS_DIR, relative);
}

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function writeTemplateDocx(
  userId: string,
  templateId: string,
  buffer: Buffer
): Promise<string> {
  await ensureUploadsDir();
  const rel = templateDocxRelativePath(userId, templateId);
  const full = absolutePathFromRelative(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return rel.split(path.sep).join("/");
}

export async function removeTemplateDocx(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  const full = absolutePathFromRelative(relativePath);
  try {
    await fs.unlink(full);
  } catch {
    /* weg is weg */
  }
}

export function contextDocumentRelativePath(
  userId: string,
  documentId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[/\\:*?"<>|]/g, "_").slice(0, 120);
  return path.join("documents", userId, `${documentId}_${safe}`);
}

export async function writeContextDocument(
  userId: string,
  documentId: string,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  await ensureUploadsDir();
  const rel = contextDocumentRelativePath(userId, documentId, fileName);
  const full = absolutePathFromRelative(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return rel.split(path.sep).join("/");
}

export async function removeContextDocument(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  const full = absolutePathFromRelative(relativePath);
  try {
    await fs.unlink(full);
  } catch {
    /* weg is weg */
  }
}
