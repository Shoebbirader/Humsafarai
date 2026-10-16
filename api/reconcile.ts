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

  try {
    (upload as any)(req, res, (error: unknown) => {
      void (async () => {
        if (error) return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read uploaded files." });
        try {
          const files = req.files as Record<string, Array<{ buffer: Buffer; originalname: string }>>;
          const pdf = files?.pdf?.[0];
          const excel = files?.excel?.[0];
          if (!pdf) return res.status(400).json({ error: "Upload a payment-advice PDF and the Excel export." });
          let summary: ExcelSummary | null = null;
          if (req.body?.excelSummary) {
            try {
              summary = JSON.parse(req.body.excelSummary) as ExcelSummary;
            } catch {
              return res.status(400).json({ error: "The Excel summary is not valid JSON. Please select the workbook again." });
            }
            if (!summary || !Array.isArray(summary.subscriptionItems) || !Number.isFinite(summary.rawBookingNet)) {
              return res.status(400).json({ error: "The Excel summary is incomplete. Please select the workbook again." });
            }
          }
          if (!summary && !excel) return res.status(400).json({ error: "The Excel summary is missing. Please select the workbook again." });
          const result = summary
            ? await reconcileParsedExcel(pdf.buffer, summary, pdf.originalname, "browser-normalized Excel export")
            : await reconcileFiles(pdf.buffer, excel.buffer, pdf.originalname, excel.originalname);
          return res.status(200).json(result);
        } catch (error) {
          console.error("[Reconcile API] failed", error);
          return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reconcile these files." });
        }
      })().catch(error => {
        console.error("[Reconcile API] unhandled failure", error);
        if (!res.headersSent) res.status(500).json({ error: "Unable to reconcile these files." });
      });
    });
  } catch (error) {
    console.error("[Reconcile API] middleware failure", error);
    return res.status(500).json({ error: "Unable to initialize file upload processing." });
  }
}
