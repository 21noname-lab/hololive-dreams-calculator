# hololive-dreams-calculator
Hololive Dreams Event Point Calculator

## Spotlight validation records

The Spotlight validation panel stores measured multi-play results in the browser's
LocalStorage under a separate key from calculator settings. Each record contains
the personal result score, the final multi score including FEVER, actual event
points, event bonus, song-length bonus, boost count, and Holo Pass status.

The panel compares measured points with the existing calculation paths and shows
the signed difference as predicted points minus measured points. CSV imports
append new record IDs; existing IDs are skipped and never overwritten. Invalid
CSV files are rejected without changing stored records.

Coefficient analysis is informational only. It is not shown as an estimate until
there are at least five records, and it warns when personal and multi scores are
too correlated to distinguish reliably. Estimated coefficients are never applied
to the calculator's existing formulas.
