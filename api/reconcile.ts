import multer from "multer";
import { reconcileFiles, reconcileParsedExcel, type ExcelSummary } from "../server/reconcile.js";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: "20mb",
  },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 2, parts: 4 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    const valid = file.fieldname === "pdf" ? name.endsWith(".pdf") : file.fieldname === "excel" && (name.endsWith(".xls") || name.endsWith(".xlsx"));
    (callback as any)(valid ? null : new Error(file.fieldname === "pdf" ? "The payment advice must be a PDF file." : "The detail export must be an XLS or XLSX file."), valid);
  },
}).fields([
  { name: "pdf", maxCount: 1 },
  { name: "excel", maxCount: 1 },
]);

export default function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  (upload as any)(req, res, async (error: unknown) => {
    if (error) return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read uploaded files." });
    try {
      const files = req.files as Record<string, Array<{ buffer: Buffer; originalname: string }>>;
      const pdf = files?.pdf?.[0];
      const excel = files?.excel?.[0];
      if (!pdf) return res.status(400).json({ error: "Upload a payment-advice PDF and the Excel export." });
      const summary = req.body?.excelSummary ? JSON.parse(req.body.excelSummary) as ExcelSummary : null;
      if (!summary && !files?.excel?.[0]) return res.status(400).json({ error: "The Excel summary is missing. Please select the workbook again." });
      const result = summary
        ? await reconcileParsedExcel(pdf.buffer, summary, pdf.originalname, "browser-normalized Excel export")
        : await reconcileFiles(pdf.buffer, files.excel[0].buffer, pdf.originalname, files.excel[0].originalname);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reconcile these files." });
    }
  });
}
