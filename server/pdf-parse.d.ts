declare module "pdf-parse" {
  type PdfParseResult = { text: string };
  const pdfParse: (buffer: Buffer) => Promise<PdfParseResult>;
  export default pdfParse;
}
