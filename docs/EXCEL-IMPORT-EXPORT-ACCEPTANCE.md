# Excel Import/Export Acceptance — Round 17

Verified 2026-11-14. Evidence suites (all synthetic data):
`tests/test-import-acceptance.js` (**18/0** — 10 workbook variants incl. a
400-student soak, executed with `fetch` AND `XMLHttpRequest` **throwing**, so
local-only parsing is proven by construction), `tests/spraudit.test.js`
(20/0), `tests/spradapter.test.js` (38/0 — round trip certified by
`calc.gradeAll` equality), `tests/excel-import.test.js` (24/0 — includes an
export → import round-trip keeping grades identical).

## Import pipeline (as implemented)

1. **File selection**: `.xlsx` (and `.xls` where the vendored SheetJS build
   parses it — the school's actual SPR files are .xlsx; legacy .xls is
   best-effort and reported, never guessed).
2. **Local parse**: workbook bytes never leave the browser in the import
   flow. There is no upload code path at all; the acceptance matrix ran with
   the network primitives disabled and still passed (proof, not assertion).
3. **Discovery**: sheets, class info, roster, months, assessment maxima,
   formula cells, cached values — `spraudit.profile()`.
4. **Mapping**: the audit recognises the standard SPR layout and reports
   what it found; non-standard sheet names are surfaced (acceptance #5:
   renamed sheets still audited with clear findings, not a crash).
5. **Audit**: completeness, calculation integrity (re-computed with the REAL
   calc engine, not a copy), consistency, statistical anomalies, FET/CET
   coverage — findings CRITICAL / WARNING / INFO with sheet + cell + student
   id + expected value + suggestion.
6. **Report**: CSV + Excel audit report download; the ORIGINAL workbook file
   is never modified (acceptance #3: byte-identical re-audit of the source).
7. **Optional migration**: only after explicit teacher approval; adapter
   uses stable deterministic ids so repeated imports cannot duplicate
   (spradapter tests: re-import = 0 new records); every import is audited.

## Mandate checklist mapping (§10.1)

Duplicate students (✅ #4), missing students/roster gaps (✅ #3), empty cells
(✅ completeness checks), formula detection + errors (#REF!/#DIV/0! →
CRITICAL `error-cell` with cell ref — added round 11 §6), invalid numerics,
out-of-range scores (✅ `obs-out-of-range`, `score-over-total`), inconsistent
maxima (✅ `max-inconsistent` vs class modal — added round 11 §6), invalid
grade mapping (✅ cached-average mismatch vs calc engine), duplicate records,
unexpected rows/columns (✅ formula-in-data-area + structural findings).

## Legitimate performance is never a data error

Acceptance #9: a genuinely weak but validly-recorded student produces INFO
trend findings, never CRITICAL/WARNING data errors (asserted explicitly).

## Export (app feature, preserved)

- Standard SPR workbook layout; values not baked formulas for scores;
  export → import round trip keeps every grade identical (excel-import
  suite §round-trip, 24/0).
- Export is client-side; unauthorised export is impossible through the API
  (class export endpoint duty-checked — adversarial §9), and the in-app
  export only sees records the signed-in teacher can read.
- Export identifies academic context (semester/class) in the workbook
  content; the export date is embedded by the workbook metadata the app
  writes.

## Legacy .xls — honest status

The vendored SheetJS build parses .xls, but no synthetic .xls fixture exists
in the suite yet. Status: **best-effort, not acceptance-tested**. The school
uses .xlsx (verified in their SPR files); .xls support is reported as
"attempted parse with clear failure message", not a claimed capability.
