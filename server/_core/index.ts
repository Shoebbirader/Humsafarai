import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import PDFDocument from "pdfkit";
import { reconcileFiles, type Reconciliation } from "../reconcile";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  app.post("/api/reconcile", upload.fields([{ name: "pdf", maxCount: 1 }, { name: "excel", maxCount: 1 }]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const pdf = files?.pdf?.[0];
      const excel = files?.excel?.[0];
      if (!pdf || !excel) return res.status(400).json({ error: "Upload both a payment-advice PDF and an Excel export." });
      const pdfName = pdf.originalname.toLowerCase();
      const excelName = excel.originalname.toLowerCase();
      if (!pdfName.endsWith(".pdf")) return res.status(400).json({ error: "The payment advice must be a PDF file." });
      if (!(excelName.endsWith(".xls") || excelName.endsWith(".xlsx"))) return res.status(400).json({ error: "The detail export must be an XLS or XLSX file." });
      const result = await reconcileFiles(pdf.buffer, excel.buffer, pdf.originalname, excel.originalname);
      res.json(result);
    } catch (error) {
      console.error("[Reconcile] failed", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read these files." });
    }
  });
  app.post("/api/reconcile/report", express.json({ limit: "2mb" }), (req, res) => {
    const result = req.body as Reconciliation;
    if (!result?.pdf || !result?.excel) return res.status(400).json({ error: "A reconciliation result is required." });
    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="reconpilot-${result.source.invoiceNo || "report"}.pdf"`);
    doc.pipe(res);
    const teal = "#0f766e", navy = "#172033", muted = "#667085", amber = "#b45309", line = "#e6e9ee";
    const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const heading = (text: string) => { doc.moveDown(0.5).fontSize(13).fillColor(teal).font("Helvetica-Bold").text(text); doc.moveTo(44, doc.y + 5).lineTo(551, doc.y + 5).strokeColor(line).stroke(); doc.moveDown(0.55); };
    doc.fillColor(teal).fontSize(10).font("Helvetica-Bold").text("RECONPILOT / SETTLEMENT CONTROL");
    doc.moveDown(0.35).fillColor(navy).fontSize(26).font("Helvetica-Bold").text("Reconciliation report");
    doc.moveDown(0.25).fillColor(muted).fontSize(10).font("Helvetica").text(`${result.source.operator}  •  ${result.source.invoiceNo}  •  ${result.source.period}`);
    doc.moveDown(0.9).roundedRect(44, doc.y, 507, 76, 8).fillAndStroke("#effaf7", "#b7e4db");
    doc.fillColor(muted).fontSize(9).text("FINAL SETTLEMENT", 60, doc.y + 16);
    doc.fillColor(navy).fontSize(23).font("Helvetica-Bold").text(inr(result.pdf.finalSettlement), 60, doc.y + 3);
    doc.fillColor(teal).fontSize(10).font("Helvetica-Bold").text("READY TO SHARE", 415, doc.y - 18);
    heading("1. Settlement bridge");
    result.bridge.forEach(item => { const y = doc.y; doc.fillColor(item.kind === "final" ? navy : muted).fontSize(item.kind === "final" ? 11 : 10).font(item.kind === "final" ? "Helvetica-Bold" : "Helvetica").text(item.label, 58, y); doc.text(`${item.amount < 0 ? "−" : ""}${inr(Math.abs(item.amount))}`, 400, y, { width: 135, align: "right" }); doc.moveDown(0.45); });
    heading("2. Source comparison");
    const sourceRows = [["Excel booking rows", result.excel.bookingRows.toLocaleString("en-IN")], ["Excel booking net (raw)", inr(result.excel.rawBookingNet ?? result.excel.bookingNet)], ["Active booking net after overlap", inr(result.excel.activeBookingNet ?? result.excel.bookingNet)], ["Embedded cancellation fare", inr(result.excel.embeddedCancellationFare)], ["Separate cancellation rows", result.excel.cancellationRows.toLocaleString("en-IN")], ["Subscription/detail total", inr(result.excel.subscriptionTotal)]];
    sourceRows.forEach(([label, value]) => { doc.fillColor(muted).fontSize(10).text(label, 58, doc.y); doc.fillColor(navy).text(value, 400, doc.y - 10, { width: 135, align: "right" }); doc.moveDown(0.35); });
    heading("3. Checks and exceptions");
    result.checks.forEach(check => { const color = check.status === "matched" ? teal : check.status === "info" ? amber : "#9a3412"; doc.fillColor(color).fontSize(10).font("Helvetica-Bold").text(`${check.status.toUpperCase()}  ${check.label}`); doc.fillColor(muted).font("Helvetica").fontSize(9).text(check.detail, { width: 475 }); doc.moveDown(0.45); });
    heading("4. Subscription/detail match");
    result.pdf && [ ["Dynamic Pricing", result.pdf.dynamicPricing], ["SRP", result.pdf.srp], ["Sponsored Listing", result.pdf.sponsored], ["Nova", result.pdf.nova] ].forEach(([label, value]) => { const matched = result.excel.subscriptionItems?.find((item: { label: string }) => item.label === label)?.matched ?? "Review"; doc.fillColor(navy).fontSize(10).text(`${String(label)}  ·  ${matched}`, 58, doc.y); doc.text(inr(Number(value)), 400, doc.y - 10, { width: 135, align: "right" }); doc.moveDown(0.35); });
    doc.moveDown(1).fillColor(muted).fontSize(8).text("Prepared by ReconPilot. Amounts are extracted from the uploaded payment advice and Excel export. Review any item marked REVIEW before external submission.", { width: 500 });
    doc.end();
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
