# ReconPilot outcomes

## Upload and parse source files
- [x] The app accepts one payment-advice PDF and one XLS/XLSX export and shows their filenames and processing state.
- [x] The app extracts PDF settlement summary values, Excel booking/cancellation details, and subscription-detail amounts without persisting source files.

## Prevent double counting and reconcile
- [x] The result identifies booking rows that overlap cancellation PNRs and keeps them separate from active bookings.
- [x] The result reconciles subscription/detail values to PDF deductions and labels exact matches, variances, and grouped matches.
- [x] The result displays invoice amount before adjustment, each adjustment, final settlement, and any variance with formulas and source labels.
- [x] The result includes a dedicated “Where Differences Occur” ledger showing PDF amount, Excel amount, variance, status, and an explanation for booking, cancellation, subscription, and final-settlement comparisons.

## Shareable report
- [x] The user can download a polished PDF report containing source files, key settlement numbers, bridge calculations, subscription match, and exception notes.

## Visual quality and delivery
- [x] The interface is a polished responsive finance workbench with an evidence-first layout and clear success/review states.
- [x] The project serves `/manus-routes.json`, passes typecheck/build, and runs on the managed preview port.
