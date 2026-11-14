# Calculation Integrity Acceptance — Round 18

Verified 2026-11-14. The grading engine (`source/calc.js`) is UNCHANGED since
the Round-0 baseline — the mandate forbids replacing it and no defect was
found that justifies touching the rules.

## Evidence

| Property | Evidence |
|---|---|
| Grading rules unchanged, fully pinned | `tests/calc-regression.test.js` — **329/0** |
| Robustness: empty class, absent records, zero months | `tests/calc-boundaries.test.js` — **13/0** (new, round 18) |
| Zero ≠ missing ≠ not-assessed ≠ invalid | regression P11 (zeros are real evidence → U, never hidden) + boundaries §2 (`validPair(0,10)` true, `validPair(11,10)` false, `validTotal(0)` false) |
| Determinism / purity | boundaries §3: letter() pure across 12 boundary probes; §5: grades independent of key/arrival order |
| Rounding stability | boundaries §4: round1 stable and finite at 0.005 / 2.675 / −0.005 / 1.005 / ⅓ |
| Imported data grades identically | `tests/spradapter.test.js` 38/0 — semester → backend → semester, `gradeAll` outputs byte-equal |
| Exported data grades identically | `tests/excel-import.test.js` 24/0 (export → import round trip, final grades equal) |
| Synced records grade identically | adapter path IS the sync record shape; browser suite §9 rebuilds a gradable semester from a real backend export |
| Archived students | archiving removes them from the default roster but keeps records (migrations suite §4); reports read the roster they are given, so archived students do not distort current class reports |

## Same input → same output, independent of context

No calculation in calc.js reads the clock, the network, the role, the device
or storage: inputs are the semester object only. Verified by inspection
(pure functions) and by the order-independence check (boundaries §5).

## Missing-data policy (unchanged, deliberate)

- A missing component is excluded from that average's denominator
  (assessed-component counting); it is never coerced to zero.
- `FINAL_MIN_ASSESSED` gates the final grade: below it the report states
  incomplete assessment instead of inventing a final grade.
- Zero is always treated as assessed evidence (a real zero can be a
  legitimate result and must surface, e.g. as a U).

## Limitations

- Different assessment structures across semesters are NOT normalised into a
  single cross-semester score — cross-semester comparisons operate per
  component/category with explicit completeness context (product decision
  from the original SPR model, preserved).
- No property-based/fuzz harness over random score matrices (the 329 + 13
  checks are example-based). The engine is small and pure; a fuzz harness is
  optional future hardening.
