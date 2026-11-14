# Reporting & Statistical Acceptance — Round 22

Verified 2026-11-14. The reporting engine is the existing one, preserved; no
statistical logic was rewritten this round. Evidence: `calc-regression` 329/0,
`calc-boundaries` 13/0, `completeness.test` 62/0 (missing-assessment
analysis), `spradapter` 38/0 (reports on synced/record data identical to
reports on workbook data — same `gradeAll` outputs), `excel-import` 24/0
(export → import round trip), browser suite §9 (export → adapter → gradable
semester from the live backend).

## Traceability (mandate §15.1)

Every displayed figure derives from: student → class → semester → records →
`calc.js`. The chain is verifiable because:

- The record shape carries class_id / student_id / semester_id / category /
  period / ordinal / value / max_value / version / updated_by / updated_at
  (server) — the same fields the adapter maps to and the reports read.
- Reports are computed from the SAME semester structure the audit engine and
  the export write — one source of truth, no parallel statistics.
- Cross-check: workbook → audit expected-values vs engine re-computation
  (`spraudit` uses the real calc engine for cached-average checks, not a
  copy); backend records → adapter → engine equality (spradapter tests).

## Consistency across surfaces (mandate §15.2)

| Surface | Same-data consistency evidence |
|---|---|
| Dashboard / class report / student profile | all call `Calc.gradeAll` on the same semester object (single code path) |
| Excel export | excel-import round trip: final grades equal |
| Backend-synced data | adapter round trip: grade outputs byte-equal |
| Audit findings | engine re-computation matches (or flags) the workbook's cached values |

## Statistical safeguards (mandate §11.1, unchanged and verified)

- Missing ≠ zero: denominators count assessed components only (regression
  P11 + boundaries §2); incomplete assessment gates the final grade
  (FINAL_MIN_ASSESSED).
- Raw scores with different maxima are never averaged naively — components
  are normalised by their own maxima inside the engine (pinned by the 329).
- Cross-semester comparisons show per-component context; the engine does not
  fabricate a single "overall" across structurally different semesters.
- RAG/SWOT outputs are evidence-linked to the underlying components
  (original design, preserved).
- No causal claims, no automated risk labels, no high-stakes automated
  decisions exist anywhere in the codebase (verified by sweep: no such
  strings/logic).
- Archived students do not distort current reports: archiving removes a
  student from the default roster while preserving their records
  (migrations suite §4); reports render the roster they are given.

## Gaps

- Cross-semester NORMALISED trend view (e.g. percentile-within-class) is not
  built — comparisons are per-component today. Product decision, documented.
- Reports do not yet embed a per-report "generated from N records,
  completeness X%" caption in the UI (the completeness DATA exists and is
  reported; a persistent caption is a UX backlog item).
