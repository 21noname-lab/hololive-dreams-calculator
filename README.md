# hololive-dreams-calculator
Hololive Dreams Event Point Calculator

## Measured-data validation

The measured-data panel stores Spotlight and Point Rally multi-play records in
LocalStorage under a separate key from calculator settings. Records keep their
event type, and the panel filters the list, CSV export/import, predictions, and
coefficient analysis to the selected event. Existing record IDs are skipped and
never overwritten; imports are previewed and invalid rows are reported before
anything is saved.

Predictions use the existing event-specific score correction values and point
calculation functions. Coefficient analysis is informational only, requires at
least five records for the selected event, and never changes the calculator's
formulas.

CSV import/export uses the calculator's own column format. The measured-data
panel also imports the chapter-event `.xlsx` workbook locally in the browser,
without an external library or CDN. It reads the five named measurement sheets,
maps live columns by their headers, and previews eligible, held, duplicate, and
out-of-scope rows before registration. Excel bonus values stored as percentage
fractions are converted to integer percentages; unsupported values and rows
with missing or non-numeric required fields are held rather than corrected.
