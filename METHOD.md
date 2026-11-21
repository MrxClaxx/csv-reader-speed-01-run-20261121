# METHOD — csv-reader-speed-01-run-20261121

Competition: "Read broken CSV files faster, 21 November 2026" (make.fun).
Entry: `solve.js` (ES module, `run(input)` returns csv-reader 1.0.0's answer
for `{text, header}`) + `main.ts` (the program the harness runs: reads
`/input/cases.json`, answers each case with `run`, writes
`/output/answers.json`). Free entry, $100 over 10 places, closes
23 Nov 2026 02:42 UTC (09:42 WIB). The scored set is drawn from drand
quicknet round 34199652.

## Approach

A single left-to-right pass over the text, written from the competition
spec only. The reference csv-reader 1.0.0 was used purely as a black-box
oracle (run on inputs, outputs compared); no reference source lines were
read or copied into `solve.js`.

- Fields are sliced at their boundaries (`String.prototype.slice`) instead
  of being built character by character. Only the rare broken-field paths
  (escaped quotes, stray CRs, junk after a closing quote, unterminated
  quotes) assemble a value from segments.
- The hot loop is a tight `charCodeAt` scan: unquoted fields stop at `,`,
  LF, CRLF or EOF; quoted fields scan for the closing quote with the same
  loop, counting embedded line breaks as they go.
- No regex, no `split`, no dependencies, no allocation per character.
  Rows are pushed directly when their width matches; short rows are padded
  and long rows cut only when needed.
- `main.ts` keeps the specified driver (reads cases, runs each alone,
  writes answers) and turns V8 incremental marking off, as the house
  baseline does. `package.json` (`{"type":"module"}`) is included so Node
  loads the modules without a reparse.

## Exact reading rules implemented

- U+FEFF at the very start is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`). A lone
  CR at the very start of a record is dropped the same way and forces the
  record's first field to be read as unquoted (a quote after it is a
  literal character); if that leaves a record of a single empty field, the
  record is no record at all.
- A field that opens with a quote runs to the next quote that is not
  doubled; `""` inside it is one quote; each CRLF or lone CR inside it is
  read as LF; what follows its closing quote, up to the next comma or line
  break, is appended as it stands (`quote_junk`, when the field ends); a
  quote that never closes is a literal character and the text after it is
  read again as unquoted (`unterminated_quote`, reported when the quote is
  found to never close, before any `stray_cr` the re-read meets — the
  closing-quote scan rewinds the line count it advanced, since it ran
  speculatively to EOF).
- A quote inside an unquoted field is a literal character.
- Fields stay strings, never trimmed or converted.
- `columns` is the first record when `header` is true (or `[]` when header
  is true and there is no record), else `null`; `rows` holds the records
  after it, each padded with empty strings (`short_row`, with `fields`:
  its field count) or cut (`long_row`, with `extra`: the cut fields) to the
  first record's width.
- Each error is `{code, line, row}`, in the order met, and every error's
  `line` is the 1-based line its record starts on (counting every LF, CRLF
  and lone CR inside quotes); `row` is its record's index in `rows`, null
  for the header. A record's `short_row`/`long_row` is reported when it ends.

The subtlest finding from testing against the oracle: every error's line is
its record's start line, not the line where the error character sits — a
record spanning lines (multi-line quoted field) reports its start line for
`stray_cr`/`quote_junk`/`unterminated_quote` too.

## Verification

- Practice set (kit, 6 cases, ~10.7 MB of CSV): all 6 answers identical
  to `practice/reference/expected.json` (byte-identical after
  `JSON.stringify` comparison).
- Black-box differential fuzzing against csv-reader 1.0.0: 4,106 checks
  (fixed edge cases + random strings) and 7,500 further checks (longer
  random strings + structured random CSVs with quoted/junk/unterminated/
  stray-CR breakage), 0 failures. Edge cases covered include empty text,
  BOM-only, header-only, trailing commas, empty lines, lone CRs at record
  start/mid-field/EOF, quoted fields spanning lines, and unterminated
  quotes mid-text.
- Determinism: the program is pure (no network, no randomness, no
  timestamps); two runs on the practice set produce byte-identical
  `answers.json`.

## Timing (local, Node v24.22.1, practice set, full `node main.ts` run)

- This entry: 722–948 ms over repeated runs (mean ~780 ms).
- House baseline (csv-reader 1.0.0, same driver): 1,458–1,656 ms
  (mean ~1,580 ms).
- Speedup ≈ 2.0x. The parse itself (`run()` on all 6 cases, warmed up)
  takes ~100 ms; the rest is fixed driver cost both entries pay
  (JSON.parse of the 11 MB cases file ~50 ms, JSON.stringify of the
  12 MB answers ~180 ms, Node startup + module load).

## Files

- `solve.js` — the parser (written fresh in the build session, revised
  twice: first for the record-start error-line rule, then for the
  record-start CR / unterminated-quote line-rewind rules).
- `main.ts` — the harness driver.
- `package.json` — `{"type":"module"}`.
- `README.md` — from the official template (owner MrxClaxx, repo
  csv-reader-speed-01-run-20261121, referral qk6r6d3e).
- `LICENSE` — MIT (written by the kit `init`).
- `.makefun/freshness.json` — kit anchor (drand round 34146065).

Kit: fresh download from
`https://make.fun/c/csv-reader-speed-01-run-20261121/kit?phase=dev`
(bundle sha `6a35685d320462fb0a864651472e2158f9ee49863a7c7096b0f84b0737947069`).
The kit itself is kept outside this repo (it would exceed the 1 MiB repo
limit) at `~/workspace/makefun/csv-reader-speed-01-run-20261121-kit-dir/`.
