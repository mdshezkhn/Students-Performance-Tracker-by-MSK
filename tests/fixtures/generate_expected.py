#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenerate tests/fixtures/calc-fixture.json.

Builds a 23-pupil synthetic class (no real names — enumerated placeholders)
and computes every expected value with an INDEPENDENT implementation of the
school workbook rules (the same formulas the Excel sheet uses), so the JS
regression test cross-checks source/calc.js against a second implementation
rather than against itself.

Rules (must stay identical to the Excel workbook — DO NOT change either side
without the school's approval):
  - observations: each LO scored /10; skill % = AVERAGE(all LO raws across
    months) * 10
  - spelling/daily: month % = sum(scores)/sum(totals)*100 over weeks with a
    valid score/total pair; semester % = AVERAGE of month %
  - tests: score/total*100
  - final = 0.1*(L+S+W+R+Sp+Da+Mid+Oral) + 0.2*Written, missing parts count 0
  - letters: >84 A*, >74 A, >64 B, >54 C, >49 D, else U
  - final shown only when >= 6 of 9 components are assessed

Run:  python tests/fixtures/generate_expected.py   (Python 3 stdlib only)
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MONTHS = ["March", "May"]
SKILLS = ["Listening", "Speaking", "Writing", "Reading"]


def pupil(num, cn, en, gender):
    return {
        "id": "P%02d" % num, "nameCn": cn, "nameEn": en, "gender": gender,
        "observations": {}, "spelling": {}, "daily": {}, "tests": {},
    }


def obs_all(p, months, lo_val):
    """Every LO cell of every month = lo_val (0..10)."""
    for m in months:
        p["observations"][m] = {"%s-LO%d" % (sk, lo): lo_val
                                for sk in SKILLS for lo in (1, 2)}


def weeks(months, pairs):
    """{month: [(s, t), ...]} -> app week map (weeks with s None keep t)."""
    out = {}
    for m, lst in (months or {}).items():
        out[m] = {str(i + 1): {"s": s, "t": t} for i, (s, t) in enumerate(lst)}
    return out


def pct_weeks(pairs):
    num = den = 0.0
    any_valid = False
    for s, t in pairs:
        if s is None:
            continue                      # no score -> not assessable
        if t is None or t <= 0 or s > t or s < 0:
            continue                      # invalid pair -> ignored
        num += s
        den += t
        any_valid = True
    return (num / den * 100.0) if any_valid and den else None


# ---------------- build the 23 pupils ----------------
STU = []


def add_stu(num, gender, obs_months=MONTHS, lo=9, spell=None, daily=None,
            tests=None, obs_raw=None):
    p = pupil(num, "学生%02d" % num, "Pupil %02d" % num, gender)
    if obs_raw is not None:
        p["observations"] = obs_raw
    elif obs_months:
        obs_all(p, obs_months, lo)
    p["spelling"] = weeks(spell or {}, None) if spell is not None else \
        weeks({m: [(18, 20)] * 3 for m in MONTHS}, None)          # 90%
    p["daily"] = weeks(daily or {}, None) if daily is not None else \
        weeks({m: [(9, 10)] * 2 for m in MONTHS}, None)           # 90%
    p["tests"] = {k: {"s": s, "t": t} for k, (s, t) in (tests or {
        "midterm": (45, 50), "oral": (45, 50), "written": (90, 100)}).items()}
    STU.append(p)
    return p


def uniform(num, pct):
    """All nine components exactly pct% (uses totals that divide cleanly)."""
    lo = pct / 10.0
    assert 0 <= lo <= 10
    sp, da = pct * 20 / 100.0, pct * 10 / 100.0
    mid, wr = pct * 50 / 100.0, pct * 100 / 100.0
    return add_stu(num, "M" if num % 2 else "F",
                   obs_months=MONTHS, lo=lo,
                   spell={m: [(sp, 20)] * 3 for m in MONTHS},
                   daily={m: [(da, 10)] * 2 for m in MONTHS},
                   tests={"midterm": (mid, 50), "oral": (mid, 50), "written": (wr, 100)})


uniform(1, 90); uniform(2, 85); uniform(3, 84); uniform(4, 75); uniform(5, 74)
uniform(6, 65); uniform(7, 64); uniform(8, 55); uniform(9, 50); uniform(10, 40)
uniform(11, 0)                                    # zero is real evidence

# 12: written missing, rest 90 -> 72 B, provisional 8/9
add_stu(12, "F", tests={"midterm": (45, 50), "oral": (45, 50), "written": (None, 100)})
# 13: exactly 6 of 9 assessed (L,S,W,R,Sp,Mid at 90) -> 54 C, gate passes
p13 = add_stu(13, "M", daily={m: [(None, 10)] * 2 for m in MONTHS},
              tests={"midterm": (45, 50), "oral": (None, 50), "written": (None, 100)})
# 14: only 5 of 9 -> below the gate, no final
add_stu(14, "F", daily={m: [(None, 10)] * 2 for m in MONTHS},
        tests={"midterm": (None, 50), "oral": (None, 50), "written": (None, 100)})
# 15: spelling Mar 80 / May 90 -> 85; everything else 90 -> 89.5 A*
add_stu(15, "M", spell={"March": [(16, 20)] * 3, "May": [(18, 20)] * 3})
# 16: observations only in March, LOs 8 -> skills 80, rest 90 -> 86 A*
add_stu(16, "F", obs_months=["March"], lo=8)
# 17: weekly (18+19)/40 = 92.5 both months -> Spelling 92.5, rest 90 -> 81.25 A
add_stu(17, "M", spell={m: [(18, 20), (19, 20), (None, 20)] for m in MONTHS})
# 18: spelling total-only everywhere -> Spelling missing, rest 90 -> 72 B 8/9
add_stu(18, "F", spell={m: [(None, 20)] * 3 for m in MONTHS})
# 19: legacy invalid values stored (obs 12, spelling 25/20, midterm 60/50):
#     engine ignores them; valid evidence: L obs 9 (+invalid), Sp invalid,
#     Mid invalid; S,W,R 90, Da 90, Oral+Written 90 -> 7/9, 63 C
obs19 = {"March": dict([("%s-LO1" % "Listening", 9)] +
                       [("%s-LO%d" % (sk, lo), 9) for sk in SKILLS[1:] for lo in (1, 2)] +
                       [("%s-LO2" % "Listening", 12)]),
         "May": {"%s-LO%d" % (sk, lo): 9 for sk in SKILLS for lo in (1, 2)}}
add_stu(19, "M", obs_raw=obs19,
        spell={m: [(25, 20), (18, 20)] for m in MONTHS},
        tests={"midterm": (60, 50), "oral": (45, 50), "written": (90, 100)})
# 20: midterm total-only -> Mid missing, rest 90 -> 72 B 8/9
add_stu(20, "F", tests={"midterm": (None, 50), "oral": (45, 50), "written": (90, 100)})
# 21: decimals everywhere: LOs 8.5/7.5 -> 80, weeks 17+18.5/40 -> 88.75,
#     tests 44.5/50 -> 89 / 89/100 -> 89 -> Python computes the exact final
add_stu(21, "M",
        obs_raw={m: {"%s-LO1" % sk: 8.5 if i % 2 == 0 else 7.5
                     for i, sk in enumerate(SKILLS) for lo in [1]} |
                    {"%s-LO2" % sk: 8.5 if i % 2 == 1 else 7.5
                     for i, sk in enumerate(SKILLS)} for m in MONTHS},
        spell={m: [(17, 20), (18.5, 20)] for m in MONTHS},
        daily={m: [(8.5, 10), (8.75, 10)] for m in MONTHS},
        tests={"midterm": (44.5, 50), "oral": (44.5, 50), "written": (89, 100)})
# 22: cross-month averaging — March LOs 8, May LOs 9 -> skills 85, rest 90
add_stu(22, "F",
        obs_raw={"March": {"%s-LO%d" % (sk, lo): 8 for sk in SKILLS for lo in (1, 2)},
                 "May": {"%s-LO%d" % (sk, lo): 9 for sk in SKILLS for lo in (1, 2)}})
# 23: spelling valid in May only (March total-only) -> Spelling = May pct 90
add_stu(23, "M", spell={"March": [(None, 20)] * 3, "May": [(18, 20)] * 3})


# ---------------- independent expected-value engine ----------------
def skill_pct(p, sk):
    vals = []
    for m in MONTHS:
        cell = p["observations"].get(m, {})
        for lo in (1, 2):
            v = cell.get("%s-LO%d" % (sk, lo))
            if v is None:
                continue
            if not isinstance(v, (int, float)) or v < 0 or v > 10:
                continue                      # invalid stored value ignored
            vals.append(v)
    return (sum(vals) / len(vals) * 10.0) if vals else None


def sem_pct(p, metric):
    pcts = []
    for m in MONTHS:
        v = pct_weeks([(e["s"], e["t"]) for e in p[metric].get(m, {}).values()])
        if v is not None:
            pcts.append(v)
    return (sum(pcts) / len(pcts)) if pcts else None


def test_pct(p, kind):
    t = p["tests"].get(kind)
    if not t:
        return None
    s, tt = t["s"], t["t"]
    if s is None or tt is None or tt <= 0 or s > tt or s < 0:
        return None
    return s / tt * 100.0


def letter(x):
    if x is None:
        return None
    return "A*" if x > 84 else "A" if x > 74 else "B" if x > 64 else \
        "C" if x > 54 else "D" if x > 49 else "U"


expected = {}
for p in STU:
    parts = [skill_pct(p, sk) for sk in SKILLS] + \
            [sem_pct(p, "spelling"), sem_pct(p, "daily")] + \
            [test_pct(p, k) for k in ("midterm", "oral", "written")]
    names = SKILLS + ["Spelling", "Daily Assignments", "Mid-Term", "Oral", "Written"]
    partmap = {n: (round(v, 10) if v is not None else None) for n, v in zip(names, parts)}
    assessed = sum(1 for v in parts if v is not None)
    final = sum((v or 0.0) * (0.2 if n == "Written" else 0.1)
                for n, v in zip(names, parts))
    expected[p["id"]] = {
        "parts": partmap,
        "assessed": assessed,
        "gate": "not-assessed" if assessed < 6 else ("provisional" if assessed < 9 else "final"),
        "final": round(final, 10),
        "letter": letter(final) if assessed >= 6 else None,
    }

gated = [e for e in expected.values() if e["assessed"] >= 6]
fixture = {
    "meta": "SYNTHETIC regression fixture - no real students; expected values "
            "computed independently in Python (this generator), NOT by calc.js",
    "semester": {
        "id": "sem-fixture", "name": "2026 Spring", "school": "Fixture School",
        "className": "P4C4", "months": MONTHS, "teachers": ["Mo (fixture)", "Lisa (fixture)"],
        "students": [{"id": p["id"], "nameCn": p["nameCn"], "nameEn": p["nameEn"],
                      "gender": p["gender"]} for p in STU],
        "observations": {p["id"]: p["observations"] for p in STU},
        "spelling": {p["id"]: p["spelling"] for p in STU},
        "daily": {p["id"]: p["daily"] for p in STU},
        "tests": {p["id"]: p["tests"] for p in STU},
    },
    "expected": expected,
    "expectedClass": {
        "finalAvg": round(sum(e["final"] for e in gated) / len(gated), 10),
        "distribution": {L: sum(1 for e in gated if e["letter"] == L)
                         for L in ("A*", "A", "B", "C", "D", "U")},
    },
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calc-fixture.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(fixture, f, ensure_ascii=False, indent=1)
print("wrote", out)
print("pupils:", len(STU), "| gated:", len(gated),
      "| distribution:", fixture["expectedClass"]["distribution"],
      "| finalAvg:", fixture["expectedClass"]["finalAvg"])
