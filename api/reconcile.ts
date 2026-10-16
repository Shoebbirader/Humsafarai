import multer from "multer";
import { reconcileFiles } from "../server/reconcile";

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
    callback(valid ? null : new Error(file.fieldname === "pdf" ? "The payment advice must be a PDF file." : "The detail export must be an XLS or XLSX file."), valid);
  },
}).fields([
  { name: "pdf", maxCount: 1 },
  { name: "excel", maxCount: 1 },
]);

export default function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  upload(req, res, async (error: unknown) => {
    if (error) return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read uploaded files." });
    try {
      const files = req.files as Record<string, Array<{ buffer: Buffer; originalname: string }>>;
      const pdf = files?.pdf?.[0];
      const excel = files?.excel?.[0];
      if (!pdf || !excel) return res.status(400).json({ error: "Upload both a payment-advice PDF and an Excel export." });
      const result = await reconcileFiles(pdf.buffer, excel.buffer, pdf.originalname, excel.originalname);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reconcile these files." });
    }
  });
}
