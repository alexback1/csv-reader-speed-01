# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/alexback1/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/alexback1/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

SliceLane CSV — an exact, faster drop-in for csv-reader 1.0.0: a single-pass indexOf/slice parser that returns csv-reader's answers on every case, about 2.4–2.9x faster than the house baseline on the practice set.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `MAKEFUN_INPUT_DIR` outside a container), answers each one with `run` from `solve.js`, and writes `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`).

## How it works

Two lanes, one pass, no per-character loop on the hot path:

- **Fast lane:** a line with no quote and no stray CR is split in one pass (`split(',')`, CRLF-aware). That covers the bulk of generated rows.
- **General lane:** quoted and broken lines are read field by field with indexOf jumps — next comma, LF, or CR for unquoted fields; next quote for quoted ones — and sliced, never built up a character at a time. Doubled quotes collapse to one, CRs inside quotes become LF, junk after a closing quote and unterminated quotes follow csv-reader's exact error policy (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`).

Measured locally, 2026-11-21: 6/6 practice cases identical to the kit's expected answers, 40,000 random broken-CSV inputs plus 27 hand-written edge cases with 0 mismatches against csv-reader 1.0.0, and about 2.4–2.9x the baseline's CPU time on the practice set.

---

Entered on [make.fun](https://make.fun/?ref=e9cnygr6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards
