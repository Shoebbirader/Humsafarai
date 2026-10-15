# ReconPilot plan

## Product scope
ReconPilot reconciles a payment-advice PDF against a detailed XLS/XLSX export. It extracts visible PDF summary values, parses workbook booking/cancellation and subscription sheets, prevents double-counting cancellation-marked booking rows, and produces an auditable settlement bridge with downloadable PDF output.

## Implementation
- React/Vite frontend with a focused finance-workbench layout.
- Express endpoints: `/api/reconcile` accepts multipart PDF + Excel files, parses both in memory, and returns normalized evidence and reconciliation results; `/api/reconcile/report` renders the result as a polished PDF.
- Excel parser uses workbook sheet names, header-aware column mapping, section boundaries, numeric totals, and subscription-value matching.
- PDF parser extracts text and uses labeled amount matching for the known payment-advice summary. The UI also shows confidence and unmapped lines for review.
- Reconciliation engine computes subscription-detail matching, raw-vs-adjusted transaction totals, PDF invoice-before-adjustment, adjustments, and final settlement variance.
- No database is needed for this first version; files are processed transiently and never persisted.

## Project structure
- `client/src/pages/Home.tsx`: upload, results, evidence, and report download workflow.
- `client/src/index.css`: visual system and print styling.
- `server/reconcile.ts`: parsing and reconciliation engine.
- `server/_core/index.ts`: upload and PDF report routes.
- `public/manus-routes.json`: route manifest.

## Design direction
Three candidate styles: Ledger Modern (0.06); Quiet Audit (0.08); Signal Room (0.04). Chosen: **Ledger Modern**.

- **Design Movement:** Editorial financial tooling: precise tables, generous margins, and a high-contrast audit trail.
- **Core Principles:** Make the amount chain obvious; distinguish source evidence from calculated outputs; surface exceptions without alarm fatigue; keep every action reversible.
- **Color Philosophy:** Ink navy for authority, warm paper for calm, electric teal for verified math, and amber for review states.
- **Layout Paradigm:** A left rail of workflow steps and a wide right-side evidence canvas, avoiding a centered generic dashboard.
- **Signature Elements:** Receipt-like evidence chips, a vertical settlement spine, and small “source / calculated / variance” labels.
- **Interaction Philosophy:** Upload first, then progressively disclose the explanation. Every number can be traced to a source row or formula.
- **Animation:** Restrained 160ms fades and number-count transitions only on state changes; no decorative motion.
- **Typography System:** IBM Plex Sans for interface text and IBM Plex Mono for amounts, IDs, and formulas.
- **Brand Essence:** “Turn two messy files into one defensible answer.” Precise, calm, accountable.
- **Brand Voice:** “Follow the money.” / “Nothing gets counted twice.”
- **Wordmark & Logo:** A compact RP monogram built from two offset ledger lines.
- **Signature Brand Color:** Deep teal `#0f766e`.
