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

CSV import/export uses the calculator's own column format. `.xlsx` import is not
available until a representative workbook and its column meanings are provided.
