import "dotenv/config";
import express from "express";
import path from "node:path";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import PDFDocument from "pdfkit";
import { reconcileFiles, reconcileParsedExcel, type Reconciliation, type ExcelSummary } from "../reconcile";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 2, parts: 4 },
    fileFilter: (_req, file, callback) => {
      const name = file.originalname.toLowerCase();
      const valid = file.fieldname === "pdf" ? name.endsWith(".pdf") : file.fieldname === "excel" && (name.endsWith(".xls") || name.endsWith(".xlsx"));
      (callback as any)(valid ? null : new Error(file.fieldname === "pdf" ? "The payment advice must be a PDF file." : "The detail export must be an XLS or XLSX file."), valid);
    },
  });
  app.post("/api/reconcile", (req, res, next) => {
    upload.fields([{ name: "pdf", maxCount: 1 }, { name: "excel", maxCount: 1 }])(req, res, error => {
      if (error) {
        console.error("[Reconcile] upload failed", error);
        return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read uploaded files." });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const pdf = files?.pdf?.[0];
      const excel = files?.excel?.[0];
      if (!pdf) return res.status(400).json({ error: "Upload a payment-advice PDF and the Excel export." });
      const pdfName = pdf.originalname.toLowerCase();
      const excelName = excel?.originalname.toLowerCase() ?? "";
      if (!pdfName.endsWith(".pdf")) return res.status(400).json({ error: "The payment advice must be a PDF file." });
      if (excel && !(excelName.endsWith(".xls") || excelName.endsWith(".xlsx"))) return res.status(400).json({ error: "The detail export must be an XLS or XLSX file." });
      const summary = req.body?.excelSummary ? JSON.parse(req.body.excelSummary) as ExcelSummary : null;
      if (!summary && !excel) return res.status(400).json({ error: "The Excel summary is missing. Please select the workbook again." });
      const result = summary ? await reconcileParsedExcel(pdf.buffer, summary, pdf.originalname, "browser-normalized Excel export") : await reconcileFiles(pdf.buffer, excel.buffer, pdf.originalname, excel.originalname);
      res.json(result);
    } catch (error) {
      console.error("[Reconcile] failed", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read these files." });
    }
  });
  app.post("/api/reconcile/report", express.json({ limit: "2mb" }), (req, res) => {
    const result = req.body as Reconciliation;
    if (!result?.pdf || !result?.excel) return res.status(400).json({ error: "A reconciliation result is required." });
    const fontDir = path.resolve(process.cwd(), "server/assets");
    const logoPath = path.resolve(process.cwd(), "client/public/humsafarai-logo.png");
    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, info: { Title: "HumsafarAI Settlement Reconciliation", Author: "HumsafarAI" } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="humsafarAI-${result.source.invoiceNo || "report"}.pdf"`);
    doc.registerFont("Humsafar Sans", path.join(fontDir, "DejaVuSans.ttf"));
    doc.registerFont("Humsafar Sans Bold", path.join(fontDir, "DejaVuSans-Bold.ttf"));
    doc.pipe(res);
    const regular = "Humsafar Sans", bold = "Humsafar Sans Bold";

    const navy = "#123331", teal = "#0f766e", mint = "#e8f6f2", ink = "#20312f", muted = "#6c7d79", amber = "#a15c15", red = "#a13f2b", line = "#dfe8e5", paper = "#f7faf9";
    const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const moneyWithSign = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}${inr(Math.abs(v))}`;
    const rule = () => { doc.moveTo(44, doc.y).lineTo(551, doc.y).strokeColor(line).lineWidth(0.7).stroke(); };
    const section = (number: string, title: string) => { if (doc.y > 700) doc.addPage(); doc.moveDown(0.7); doc.fillColor(teal).font(bold).fontSize(9).text(`${number}  /  ${title.toUpperCase()}`, 44, doc.y, { width: 507 }); doc.moveDown(0.28); rule(); doc.moveDown(0.55); };
    const label = (text: string, x: number, y: number, width = 150) => doc.fillColor(muted).font(bold).fontSize(7.5).text(text.toUpperCase(), x, y, { width, characterSpacing: 0.8 });
    const tableRow = (left: string, right: string, emphasis = false) => { const y = doc.y; doc.fillColor(emphasis ? ink : muted).font(emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(emphasis ? 10.5 : 9.5).text(left, 58, y, { width: 330 }); doc.fillColor(emphasis ? teal : ink).font(emphasis ? "Helvetica-Bold" : "Helvetica").text(right, 400, y, { width: 135, align: "right" }); doc.moveDown(0.38); rule(); doc.moveDown(0.38); };
    const drawHeader = () => { doc.save(); doc.image(logoPath, 44, 18, { fit: [30, 30] }); doc.fillColor(navy).font(bold).fontSize(8).text("HUMSAFARAI", 82, 24); doc.fillColor(muted).font(regular).fontSize(7.5).text("SETTLEMENT INTELLIGENCE", 82, 36); doc.restore(); };
    doc.on("pageAdded", drawHeader);
    drawHeader();
    doc.y = 76;
    doc.fillColor(navy).font(bold).fontSize(27).text("Settlement reconciliation");
    doc.moveDown(0.25).fillColor(muted).font(regular).fontSize(10).text("An evidence-led comparison of the payment advice and detailed Excel export.", { width: 470 });
    doc.moveDown(1.05);

    const metaY = doc.y;
    doc.roundedRect(44, metaY, 507, 68, 7).fillAndStroke(paper, line);
    label("Operator", 60, metaY + 14); doc.fillColor(ink).font(bold).fontSize(10).text(result.source.operator, 60, metaY + 29, { width: 145 });
    label("Invoice", 235, metaY + 14); doc.fillColor(ink).font(bold).fontSize(10).text(result.source.invoiceNo, 235, metaY + 29, { width: 145 });
    label("Period", 410, metaY + 14); doc.fillColor(ink).font(bold).fontSize(10).text(result.source.period, 410, metaY + 29, { width: 120 });
    doc.y = metaY + 87;

    const heroY = doc.y;
    doc.roundedRect(44, heroY, 507, 108, 9).fill(navy);
    label("Final settlement", 62, heroY + 18); doc.fillColor("#ffffff").font(bold).fontSize(27).text(inr(result.pdf.finalSettlement), 62, heroY + 35);
    doc.fillColor("#b7dfd6").font(regular).fontSize(9).text(`After adjustment  ${moneyWithSign(result.pdf.adjustment)}`, 63, heroY + 78);
    doc.roundedRect(398, heroY + 20, 125, 25, 12).fill(mint); doc.fillColor(teal).font(bold).fontSize(7.2).text("READY TO SHARE", 407, heroY + 29, { width: 107, align: "center" });
    doc.fillColor("#b7dfd6").font(regular).fontSize(8).text("Review any item marked REVIEW before external submission.", 325, heroY + 78, { width: 195, align: "right" });
    doc.y = heroY + 130;

    section("01", "Settlement bridge");
    result.bridge.forEach(item => tableRow(item.label, item.kind === "base" || item.kind === "final" ? inr(item.amount) : moneyWithSign(item.amount), item.kind === "final"));

    section("02", "Source evidence");
    const sourceRows = [["Excel booking rows", result.excel.bookingRows.toLocaleString("en-IN")], ["Excel booking net (raw)", inr(result.excel.rawBookingNet ?? result.excel.bookingNet)], ["Active booking net after overlap", inr(result.excel.activeBookingNet ?? result.excel.bookingNet)], ["Embedded cancellation fare", inr(result.excel.embeddedCancellationFare)], ["Separate cancellation rows", result.excel.cancellationRows.toLocaleString("en-IN")], ["Subscription/detail total", inr(result.excel.subscriptionTotal)]];
    sourceRows.forEach(([left, right]) => tableRow(left, right));

    section("03", "Where differences occur");
    label("Comparison", 58, doc.y, 170); label("PDF", 235, doc.y, 100); label("Excel", 340, doc.y, 100); label("Variance", 445, doc.y, 105); doc.moveDown(0.5); rule(); doc.moveDown(0.45);
    (result.differences ?? []).forEach(item => { if (doc.y > 720) doc.addPage(); const color = item.status === "matched" ? teal : red; const y = doc.y; doc.fillColor(color).font(bold).fontSize(9.2).text(item.label, 58, y, { width: 170 }); doc.fillColor(ink).font(regular).fontSize(7.6).text(inr(item.pdfAmount), 235, y, { width: 100, align: "right" }); doc.text(inr(item.excelAmount), 340, y, { width: 100, align: "right" }); doc.fillColor(color).font(bold).fontSize(7.6).text(moneyWithSign(item.variance), 445, y, { width: 105, align: "right" }); doc.fillColor(muted).font(regular).fontSize(8).text(item.explanation, 58, y + 17, { width: 465 }); doc.moveDown(0.95); rule(); doc.moveDown(0.38); });

    section("04", "Subscription detail match");
    [["Dynamic Pricing", result.pdf.dynamicPricing], ["SRP", result.pdf.srp], ["Sponsored Listing", result.pdf.sponsored], ["Nova", result.pdf.nova]].forEach(([itemLabel, value]) => { const matched = result.excel.subscriptionItems?.find((item: { label: string }) => item.label === itemLabel)?.matched ?? "Review"; tableRow(`${String(itemLabel)}  ·  ${matched}`, inr(Number(value))); });

    section("05", "Control checks");
    result.checks.forEach(check => { if (doc.y > 720) doc.addPage(); const color = check.status === "matched" ? teal : check.status === "info" ? amber : red; doc.fillColor(color).font(bold).fontSize(9.5).text(`${check.status.toUpperCase()}  ·  ${check.label}`); doc.fillColor(muted).font(regular).fontSize(8.5).text(check.detail, { width: 470 }); doc.moveDown(0.6); });

    doc.moveDown(0.5); doc.roundedRect(44, doc.y, 507, 42, 6).fillAndStroke(mint, "#c7e8df"); doc.fillColor(teal).font(bold).fontSize(8.5).text("SHARE NOTE", 58, doc.y + 11); doc.fillColor(ink).font(regular).fontSize(8.5).text("This report preserves the source-to-calculation trail so the settlement answer can be reviewed without reopening the workbook.", 140, doc.y + 10, { width: 390 });

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page += 1) { doc.switchToPage(page); doc.moveTo(44, 797).lineTo(551, 797).strokeColor(line).lineWidth(0.7).stroke(); doc.fillColor(muted).font(regular).fontSize(7.5).text("HumsafarAI  ·  Settlement intelligence", 44, 807); doc.text(`Page ${page - pages.start + 1} of ${pages.count}`, 470, 807, { width: 81, align: "right" }); }
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
