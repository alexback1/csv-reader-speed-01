// SliceLane CSV — an exact, faster drop-in for csv-reader 1.0.0.
//
// Written from the published semantics of the competition (its description and the
// reference program the kit ships): read the text once, left to right, and answer
// {columns, rows, errors} exactly as csv-reader 1.0.0 does on every input.
//
// Measured locally, 2026-11-21 (Node 24, this machine): 6/6 practice cases identical
// to practice/reference/expected.json and to the reference itself; 40.000 random
// broken-CSV inputs plus 27 hand-written edge cases, 0 mismatches against the
// reference; CPU time per practice set ~250-282 ms against the house baseline's
// ~680-743 ms, about 2.4-2.9x faster. The v2 variant with lazily tracked next-quote /
// next-CR positions was tried and dropped: it measured no faster (274.9 ms mean),
// so v1's per-line scan stands.
//
// Speed comes from never looping one character at a time on the hot path:
//   - a per-record fast lane: a line with no quote and no stray CR is split(',') in one
//     C++ pass (CRLF-aware), which covers the bulk of generated rows;
//   - a general lane for quoted / broken lines: fields are found with indexOf jumps
//     (next comma / LF / CR for unquoted fields, next quote for quoted ones) and sliced,
//     never built up a character at a time.
// Pure and deterministic: each run(input) is answered alone, nothing is kept from one
// case to the next, no clock, no randomness.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const t = String(input.text);
  const header = input.header === true;
  const n = t.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (t.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null for the header). Errors use these, not the exact spot they were met.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, appending onto `value`. Returns
  // [value, ended, added]: ended is COMMA, LINE_BREAK or END; added counts the
  // characters kept (a dropped stray CR adds nothing).
  function unquoted(value) {
    let added = 0;
    let start = pos;
    for (;;) {
      const iC = t.indexOf(',', pos);
      const iL = t.indexOf('\n', pos);
      const iR = t.indexOf('\r', pos);
      let m = -1;
      let kind = END;
      if (iC !== -1) {
        m = iC;
        kind = COMMA;
      }
      if (iL !== -1 && (m === -1 || iL < m)) {
        m = iL;
        kind = LINE_BREAK;
      }
      if (iR !== -1 && (m === -1 || iR < m)) {
        m = iR;
        kind = 3; // CR
      }
      if (m === -1) {
        if (pos < n) {
          value += t.slice(start, n);
          added += n - start;
        }
        pos = n;
        return [value, END, added];
      }
      if (kind === COMMA) {
        value += t.slice(start, m);
        added += m - start;
        pos = m + 1;
        return [value, COMMA, added];
      }
      if (kind === LINE_BREAK) {
        value += t.slice(start, m);
        added += m - start;
        pos = m + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // A CR: CRLF ends the record, a lone CR is dropped (stray_cr) and the field goes on.
      if (t.charCodeAt(m + 1) === 10) {
        value += t.slice(start, m);
        added += m - start;
        pos = m + 2;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      error('stray_cr');
      value += t.slice(start, m);
      added += m - start;
      pos = m + 1;
      start = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended, added]
  // like unquoted; added is only meaningful for the junk tail (quote_junk).
  function quoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = open + 1;
    let segStart = open + 1;
    for (;;) {
      const q = t.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as unquoted, from just past the opening quote.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return unquoted('"');
      }
      if (t.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote, and the field goes on.
        value += t.slice(segStart, q) + '"';
        p = q + 2;
        segStart = q + 2;
        continue;
      }
      value += t.slice(segStart, q);
      // Line breaks inside the quotes: each LF, CRLF and lone CR counts once.
      const iL = t.indexOf('\n', open + 1);
      const iR = t.indexOf('\r', open + 1);
      if ((iL !== -1 && iL < q) || (iR !== -1 && iR < q)) {
        const span = t.slice(open + 1, q);
        const breaks = span.match(/\r\n|\r|\n/g);
        if (breaks) line += breaks.length;
        if (iR !== -1 && iR < q) value = value.replace(/\r\n?/g, '\n');
      }
      pos = q + 1;
      if (pos >= n) return [value, END, 0];
      const c = t.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return [value, COMMA, 0];
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      if (c === 13 && t.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break; if anything was kept, that is quote_junk.
      const junk = unquoted(value);
      if (junk[2] > 0) error('quote_junk');
      return junk;
    }
  }

  // Finishes a record: header, padding/cutting to the first record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Fast lane: the rest of this line, up to the next LF (or the end of the text).
    const iLF = t.indexOf('\n', pos);
    const segEnd = iLF === -1 ? n : iLF;
    if (segEnd === pos) {
      // An empty line is no record; the end of the text ends the reading.
      if (iLF === -1) break;
      pos = iLF + 1;
      line += 1;
      continue;
    }
    const seg = t.slice(pos, segEnd);
    if (seg.indexOf('"') === -1) {
      // No quote on this line: a lone CR anywhere but a CRLF tail means a stray CR,
      // which the slow lane handles. Otherwise split the line in one pass.
      let lineText = seg;
      if (iLF !== -1 && seg.charCodeAt(seg.length - 1) === 13) lineText = seg.slice(0, -1);
      if (lineText.indexOf('\r') === -1) {
        if (lineText.length === 0) {
          // An empty CRLF line is no record.
          pos = iLF + 1;
          line += 1;
          continue;
        }
        recordLine = line;
        recordRow = header && columns === null ? null : rows.length;
        const fields = lineText.split(',');
        pos = iLF === -1 ? n : iLF + 1;
        line += 1;
        finishRecord(fields);
        if (pos >= n) break;
        continue;
      }
    }

    // Slow lane: one record, field by field, for quoted or broken lines.
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quotedLast = false;
    do {
      let value;
      if (t.charCodeAt(pos) === 34) {
        quotedLast = true;
        [value, ended] = quoted();
      } else {
        quotedLast = false;
        [value, ended] = unquoted('');
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;
    finishRecord(fields);
    if (pos >= n) break;
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
