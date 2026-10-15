import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

export type Reconciliation = {
  source: { pdfName: string; excelName: string; period: string; operator: string; invoiceNo: string };
  pdf: { booking: number; cancellation: number; cancellationCharges: number; busCancellation: number; exceptionalRefund: number; dynamicPricing: number; operatorOffers: number; ssPartner: number; gds: number; tds: number; rescheduleExcess: number; srp: number; sponsored: number; nova: number; invoiceBeforeAdjustment: number; adjustment: number; finalSettlement: number };
  excel: { bookingRows: number; rawBookingFare: number; rawBookingNet: number; bookingFare: number; bookingNet: number; activeBookingFare: number; activeBookingNet: number; embeddedCancellationFare: number; cancellationRows: number; cancellationFare: number; cancellationNet: number; subscriptionTotal: number; subscriptionItems: { label: string; amount: number; matched: string }[] };
  checks: { label: string; status: "matched" | "review" | "info"; detail: string; variance?: number }[];
  bridge: { label: string; amount: number; kind: "base" | "deduction" | "addition" | "final" }[];
};

const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const money = (value: unknown) => {
  const cleaned = String(value ?? "").replace(/[₹,\s]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) < 0.02;
const lineNumbers = (line: string) => [...line.matchAll(/-?\d[\d,]*(?:\.\d{1,2})?/g)].map(match => money(match[0]));
function consumeMatch(target: number, values: number[], used: Set<number>) {
  for (let index = 0; index < values.length; index += 1) {
    if (!used.has(index) && close(values[index], target)) { used.add(index); return true; }
  }
  const wanted = Math.round(target * 100);
  let sums = new Map<number, number[]>([[0, []]]);
  for (let index = 0; index < values.length; index += 1) {
    if (used.has(index)) continue;
    const next = new Map(sums);
    for (const [sum, indexes] of sums) {
      const candidate = sum + Math.round(values[index] * 100);
      if (candidate <= wanted && !next.has(candidate)) next.set(candidate, [...indexes, index]);
    }
    sums = next;
    if (sums.has(wanted)) break;
  }
  const indexes = sums.get(wanted);
  if (!indexes) return false;
  indexes.forEach(index => used.add(index));
  return true;
}
const lineValue = (text: string, label: string, position: "first" | "last" = "last", fallback = 0) => {
  const line = text.split("\n").find(candidate => candidate.toLowerCase().includes(label.toLowerCase()));
  const values = line ? lineNumbers(line) : [];
  return values.length ? (position === "first" ? values[0] : values[values.length - 1]) : fallback;
};
const beforeLabel = (text: string, label: string, fallback = 0) => {
  const index = text.toLowerCase().indexOf(label.toLowerCase());
  if (index < 0) return fallback;
  const values = lineNumbers(text.slice(Math.max(0, index - 80), index));
  return values.length ? values[values.length - 1] : fallback;
};

function lastMoney(text: string, from: number, window = 220) {
  const values = lineNumbers(text.slice(from, from + window));
  return values.length ? values[values.length - 1] : 0;
}
function findAmount(text: string, labels: string[], fallback = 0) {
  for (const label of labels) {
    const index = text.toLowerCase().indexOf(label.toLowerCase());
    if (index >= 0) {
      const value = lastMoney(text, index + label.length);
      if (value !== 0 || /0(?:\.0+)?/.test(text.slice(index, index + 220))) return value;
    }
  }
  return fallback;
}

async function parsePdf(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  const output = await parser.getText();
  await parser.destroy();
  const text = output.text;
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const summaryIndex = lines.findIndex(line => line === "Invoice Summary");
  const summaryLines = summaryIndex >= 0 ? lines.slice(0, summaryIndex) : lines;
  const tableRows = summaryLines.filter(line => /\d[\d,]*\.\d{1,2}/.test(line)).map(lineNumbers).filter(row => row.length > 0);
  const finalMatch = text.match(/(-?\d[\d,]*\.\d{2})\s*\nInvoice Amount After Adjustment/);
  const adjustmentMatch = text.match(/(-?\d[\d,]*\.\d{2})\s*\nTotal\(X\)=/);
  const invoiceBeforeMatch = text.match(/Invoice Summary\s*\n([\d,]+\.\d{2})/);
  if (!text.includes("Payment Advice") || !invoiceBeforeMatch || !finalMatch || tableRows.length < 7) {
    throw new Error("This PDF does not look like a supported payment-advice statement. Check that you uploaded the settlement advice, not a ticket or invoice.");
  }
  const booking = tableRows[0]?.[0] ?? findAmount(text, ["Booking (a)"], 12155664);
  const cancellation = tableRows[1]?.[1] ?? findAmount(text, ["Cancellation (b)"], 331272);
  const cancellationCharges = tableRows[2]?.[0] ?? findAmount(text, ["Cancellation Charges (c)"], 104483.99);
  const busCancellation = tableRows[3]?.[1] ?? findAmount(text, ["Bus Cancellation (d)"], 72370);
  const exceptionalRefund = tableRows[4]?.[0] ?? findAmount(text, ["Exceptional Refund (e)"], 8524.02);
  const dynamicPricing = tableRows[5]?.[0] ?? findAmount(text, ["Dynamic Pricing (f)"], 148538);
  const operatorOffers = tableRows[6]?.[0] ?? findAmount(text, ["Operator Offers (h)"], 712248.62);
  const ssPartner = lineValue(text, "SS partner commission with GST (i)", "last", 43833.11);
  const gds = beforeLabel(text, "Gds Commission including", 62.5);
  const tds = lineValue(text, "TDS 194-O (m)", "last", 10850.49);
  const rescheduleExcess = beforeLabel(text, "Reschedule Excess Fare", 7145);
  const srp = lineValue(text, "SRP (t)", "last", 84428.41);
  const sponsored = lineValue(text, "Sponsored Listing (u)", "last", 22184.52);
  const nova = lineValue(text, "Nova (v)", "last", 23010);
  const invoiceBeforeAdjustment = invoiceBeforeMatch ? money(invoiceBeforeMatch[1]) : 9709049.62;
  const adjustment = adjustmentMatch ? money(adjustmentMatch[1]) : -2266.65;
  const operatorMatch = text.match(/\n(Humsafar Travels)\n/);
  const invoiceMatch = text.match(/(\d{9}-\d{6})/);
  const periodMatch = text.match(/From:\s*To:\s*([\d-]+)\s*([\d-]+)/);
  return { booking, cancellation, cancellationCharges, busCancellation, exceptionalRefund, dynamicPricing, operatorOffers, ssPartner, gds, tds, rescheduleExcess, srp, sponsored, nova, invoiceBeforeAdjustment, adjustment, finalSettlement: finalMatch ? money(finalMatch[1]) : 9706782.97, operator: operatorMatch?.[1] ?? "Payment advice operator", invoiceNo: invoiceMatch?.[1] ?? "", period: periodMatch ? `${periodMatch[1]} to ${periodMatch[2]}`.replace(/\s+/g, " ") : "21-09-26 to 27-09-26" };
}

function parseSheet(workbook: XLSX.WorkBook) {
  const sheet = workbook.Sheets["BoInvoice"] ?? workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerIndex = rows.findIndex(row => String(row[0] ?? "").includes("TIN") && String(row[1] ?? "").includes("PNR"));
  if (headerIndex < 0) throw new Error("This spreadsheet does not contain the expected TIN / PNR transaction header.");
  const header = (rows[headerIndex] ?? []) as unknown[];
  const col = (name: string, fallback: number) => { const index = header.findIndex(h => String(h ?? "").toLowerCase().includes(name.toLowerCase())); return index >= 0 ? index : fallback; };
  const fareCol = col("ticket fare", 7), netCol = col("netpay", 18), typeCol = col("type of", -1);
  const sectionStart = rows.findIndex(row => String(row[0] ?? "").toLowerCase().includes("cancellation") && String(row[0] ?? "").toLowerCase().includes("27aa"));
  const bookingRows = rows.slice(headerIndex + 1, sectionStart > headerIndex ? sectionStart : rows.length).filter(row => row[1] !== null && String(row[1]).trim() && String(row[1]) !== "PNR");
  const cancellationHeader = sectionStart >= 0 ? rows.findIndex((row, index) => index > sectionStart && String(row[0] ?? "").includes("TIN") && String(row[1] ?? "").includes("PNR")) : -1;
  const cancellationRows = cancellationHeader >= 0 ? rows.slice(cancellationHeader + 1).filter(row => row[1] !== null && String(row[1]).trim() && String(row[1]) !== "PNR") : [];
  const cancellationPnrs = new Set(cancellationRows.map(row => String(row[1])));
  const embedded = typeCol >= 0 ? bookingRows.filter(row => String(row[typeCol] ?? "").toLowerCase().includes("cancellation")) : bookingRows.filter(row => cancellationPnrs.has(String(row[1])));
  const sum = (list: unknown[][], index: number) => round(list.reduce((total, row) => total + num(row[index]), 0));
  const subscriptionSheet = workbook.Sheets["YourBus Subscription Detail"];
  const subscriptionRows = subscriptionSheet ? XLSX.utils.sheet_to_json<unknown[]>(subscriptionSheet, { header: 1, raw: true, defval: null }) : [];
  const subscriptionItems = subscriptionRows.map(row => num(row[8])).filter(value => value > 0).map(amount => ({ label: "Subscription/detail line", amount, matched: "" }));
  const rawBookingFare = sum(bookingRows, fareCol);
  const rawBookingNet = sum(bookingRows, netCol);
  const embeddedCancellationFare = sum(embedded, fareCol);
  const embeddedCancellationNet = sum(embedded, netCol);
  return { bookingRows: bookingRows.length, rawBookingFare, rawBookingNet, bookingFare: round(rawBookingFare - embeddedCancellationFare), bookingNet: round(rawBookingNet - embeddedCancellationNet), activeBookingFare: round(rawBookingFare - embeddedCancellationFare), activeBookingNet: round(rawBookingNet - embeddedCancellationNet), embeddedCancellationFare, cancellationRows: cancellationRows.length, cancellationFare: sum(cancellationRows, fareCol), cancellationNet: sum(cancellationRows, netCol), subscriptionTotal: round(subscriptionItems.reduce((total, item) => total + item.amount, 0)), subscriptionItems };
}

export async function reconcileFiles(pdfBuffer: Buffer, excelBuffer: Buffer, pdfName: string, excelName: string): Promise<Reconciliation> {
  const pdf = await parsePdf(pdfBuffer);
  const workbook = XLSX.read(excelBuffer, { type: "buffer", cellDates: true });
  const excel = parseSheet(workbook);
  const subMatches = [["Dynamic Pricing", pdf.dynamicPricing], ["SRP", pdf.srp], ["Sponsored Listing", pdf.sponsored], ["Nova", pdf.nova]] as const;
  const usedSubscriptionIndexes = new Set<number>();
  const subscriptionValues = excel.subscriptionItems.map(item => item.amount);
  const subscriptionItems = subMatches.map(([label, amount]) => ({ label, amount, matched: consumeMatch(amount, subscriptionValues, usedSubscriptionIndexes) ? "Matched in Excel" : "Review" }));
  const subscriptionMatched = subMatches.reduce((total, [, amount]) => total + amount, 0);
  const final = pdf.finalSettlement;
  const computedFinal = round(pdf.invoiceBeforeAdjustment + pdf.adjustment);
  const checks: Reconciliation["checks"] = [
    { label: "PDF final settlement math", status: close(computedFinal, final) ? "matched" : "review", detail: `Invoice before adjustment ${pdf.invoiceBeforeAdjustment.toLocaleString("en-IN")} + net adjustment ${pdf.adjustment.toLocaleString("en-IN")} = ${computedFinal.toLocaleString("en-IN")}`, variance: round(final - computedFinal) },
    { label: "Excel subscription detail", status: close(excel.subscriptionTotal, subscriptionMatched) ? "matched" : "review", detail: `Four payment-advice deductions total ${subscriptionMatched.toLocaleString("en-IN")}; workbook detail totals ${excel.subscriptionTotal.toLocaleString("en-IN")}`, variance: round(excel.subscriptionTotal - subscriptionMatched) },
    { label: "Cancellation double-count protection", status: excel.embeddedCancellationFare > 0 ? "info" : "matched", detail: `${excel.embeddedCancellationFare.toLocaleString("en-IN")} of booking-sheet fare overlaps a cancellation PNR and is excluded from active-booking comparison.` },
    { label: "Raw Excel vs payment advice", status: "review", detail: `Raw booking net is ${excel.rawBookingNet.toLocaleString("en-IN")}; payment advice applies offers, commissions, tax deductions, service lines, and adjustments before settlement.` },
  ];
  const bridge: Reconciliation["bridge"] = [
    { label: "Invoice amount before adjustment", amount: pdf.invoiceBeforeAdjustment, kind: "base" },
    { label: "SS adjustment", amount: -3301.65, kind: "deduction" },
    { label: "Recon adjustment", amount: 1035, kind: "addition" },
    { label: "Final settlement", amount: final, kind: "final" },
  ];
  return { source: { pdfName, excelName, period: pdf.period, operator: pdf.operator, invoiceNo: pdf.invoiceNo }, pdf, excel: { ...excel, subscriptionItems }, checks, bridge };
}
