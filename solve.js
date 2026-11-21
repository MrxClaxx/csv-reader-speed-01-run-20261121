// solve.js — a fast drop-in for csv-reader 1.0.0.
//
// run(input) returns csv-reader's reading of {text, header} as
// {columns, rows, errors}. Single left-to-right pass over the text.
// Fields are sliced at their boundaries (no per-character string building);
// only the rare broken-field paths (escapes, stray CRs, junk, unterminated
// quotes) assemble a value from segments.
//
// Reading rules implemented:
// - A U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes, a CR not followed by LF is dropped (error stray_cr).
//   A lone CR at the very start of a record is dropped the same way, and
//   the record's first field is then read as unquoted (a quote after it is
//   a literal character); if that leaves a record of a single empty field,
//   the record is no record at all.
// - A field that opens with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote; each CRLF or lone CR inside it is
//   read as LF; what follows its closing quote, up to the next comma or line
//   break, is appended as it stands (quote_junk, when the field ends); a
//   quote that never closes is a literal character, and the text after it is
//   read again as unquoted (unterminated_quote, reported when the quote is
//   found to never close, before any stray_cr the re-read meets).
// - A quote inside an unquoted field is a literal character.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true (or [] when header is
//   true and there is no record), else null; rows holds the records after
//   it, each padded with empty strings (short_row, with fields: its field
//   count) or cut (long_row, with extra: the cut fields) to the first
//   record's width.
// - Each error is {code, line, row}, in the order met, and every error's
//   line is the 1-based line its record starts on (counting every LF, CRLF
//   and lone CR inside quotes); row is its record's index in rows, null
//   for the header. A record's short_row or long_row is reported when it
//   ends.

export function run(input) {
  const text = input.text;
  const header = input.header;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  const errors = [];
  const rows = [];
  let columns = header ? [] : null;
  let width = 0;
  let line = 1;
  let first = true;

  // endKind: 0 = comma, 1 = LF, 2 = CRLF, 3 = EOF
  while (i < n) {
    let forceUnquoted = false;
    // Skip empty lines and leading lone CRs at record start. A lone CR
    // here is dropped (stray_cr) and forces the record's first field to be
    // read as unquoted; an empty line (or a line left with only dropped
    // CRs) is no record.
    for (;;) {
      if (i >= n) break;
      const c = text.charCodeAt(i);
      if (c === 10) {
        i++;
        line++;
        forceUnquoted = false;
        continue;
      }
      if (c === 13) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
          i += 2;
          line++;
          forceUnquoted = false;
          continue;
        }
        errors.push({
          code: 'stray_cr',
          line: line,
          row: first && header ? null : rows.length,
        });
        i++;
        forceUnquoted = true;
        continue;
      }
      break;
    }
    if (i >= n) break;
    const recStartLine = line;

    const fields = [];
    const rowIdx = first && header ? null : rows.length;
    let endKind = 3;
    let firstField = true;

    for (;;) {
      let value;
      const c = text.charCodeAt(i);
      if (c === 34 && !(firstField && forceUnquoted)) {
        // ---- quoted field ----
        const lineBefore = line;
        let j = i + 1;
        let segStart = j;
        let parts = null;
        let closedAt = -1;
        while (j < n) {
          const ch = text.charCodeAt(j);
          if (ch === 34) {
            if (j + 1 < n && text.charCodeAt(j + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, j + 1));
              j += 2;
              segStart = j;
              continue;
            }
            closedAt = j;
            break;
          }
          if (ch === 10) {
            line++;
            j++;
            continue;
          }
          if (ch === 13) {
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, j));
            parts.push('\n');
            line++;
            if (j + 1 < n && text.charCodeAt(j + 1) === 10) j += 2;
            else j += 1;
            segStart = j;
            continue;
          }
          j++;
        }

        if (closedAt === -1) {
          // Unterminated quote: the closing-quote scan ran to EOF without
          // finding one, so rewind the line count it advanced and read the
          // text after the quote again as unquoted. The error is reported
          // now, before any stray_cr the re-read meets.
          line = lineBefore;
          errors.push({
            code: 'unterminated_quote',
            line: recStartLine,
            row: rowIdx,
          });
          let k = i + 1;
          let s2 = k;
          let p2 = null;
          let ek = 3;
          while (k < n) {
            const ch = text.charCodeAt(k);
            if (ch === 44) {
              ek = 0;
              break;
            }
            if (ch === 10) {
              ek = 1;
              break;
            }
            if (ch === 13) {
              if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                ek = 2;
                break;
              }
              if (p2 === null) p2 = [];
              p2.push(text.slice(s2, k));
              errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
              k++;
              s2 = k;
              continue;
            }
            k++;
          }
          value =
            '"' +
            (p2 === null
              ? text.slice(i + 1, k)
              : p2.join('') + text.slice(s2, k));
          i = k;
          endKind = ek;
        } else {
          value =
            parts === null
              ? text.slice(i + 1, closedAt)
              : parts.join('') + text.slice(segStart, closedAt);
          // Junk after the closing quote, up to the next comma or line
          // break, appended as it stands.
          let k = closedAt + 1;
          let js = k;
          let jp = null;
          let ek = 3;
          while (k < n) {
            const ch = text.charCodeAt(k);
            if (ch === 44) {
              ek = 0;
              break;
            }
            if (ch === 10) {
              ek = 1;
              break;
            }
            if (ch === 13) {
              if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                ek = 2;
                break;
              }
              if (jp === null) jp = [];
              jp.push(text.slice(js, k));
              errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
              k++;
              js = k;
              continue;
            }
            k++;
          }
          const junk =
            jp === null
              ? text.slice(closedAt + 1, k)
              : jp.join('') + text.slice(js, k);
          if (junk.length > 0) {
            value += junk;
            errors.push({ code: 'quote_junk', line: recStartLine, row: rowIdx });
          }
          i = k;
          endKind = ek;
        }
      } else {
        // ---- unquoted field ----
        let j = i;
        let segStart = j;
        let parts = null;
        let ek = 3;
        while (j < n) {
          const ch = text.charCodeAt(j);
          if (ch === 44) {
            ek = 0;
            break;
          }
          if (ch === 10) {
            ek = 1;
            break;
          }
          if (ch === 13) {
            if (j + 1 < n && text.charCodeAt(j + 1) === 10) {
              ek = 2;
              break;
            }
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, j));
            errors.push({ code: 'stray_cr', line: recStartLine, row: rowIdx });
            j++;
            segStart = j;
            continue;
          }
          j++;
        }
        value =
          parts === null
            ? text.slice(i, j)
            : parts.join('') + text.slice(segStart, j);
        i = j;
        endKind = ek;
      }

      fields.push(value);
      firstField = false;
      if (endKind === 0) {
        i++; // comma: next field
        continue;
      }
      if (endKind === 1) {
        i++;
        line++;
      } else if (endKind === 2) {
        i += 2;
        line++;
      }
      break; // record ends (line break or EOF)
    }

    // A record left as a single empty field by dropped leading CRs is no
    // record at all.
    if (forceUnquoted && fields.length === 1 && fields[0] === '') {
      if (endKind === 3) break; // EOF
      continue;
    }

    if (first) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
      first = false;
    } else if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recStartLine,
        row: rowIdx,
        fields: fields.length,
      });
      const padded = new Array(width);
      for (let k = 0; k < fields.length; k++) padded[k] = fields[k];
      for (let k = fields.length; k < width; k++) padded[k] = '';
      rows.push(padded);
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recStartLine,
        row: rowIdx,
        extra: fields.slice(width),
      });
      rows.push(fields.slice(0, width));
    } else {
      rows.push(fields);
    }

    if (endKind === 3) break; // EOF
  }

  return { columns: columns, rows: rows, errors: errors };
}
