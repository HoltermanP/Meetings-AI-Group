declare module "pdf-parse" {
  function pdfParse(buffer: Buffer): Promise<{ text: string; numpages?: number }>;
  export default pdfParse;
}
