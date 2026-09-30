// A small RFC 4180 reader for the client's seed files. An empty field comes
// back as null, never "": the seed rule is that unknown is not empty.

export type CsvRow = Record<string, string | null>;

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let fieldWasQuoted = false;

  const endField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.trim() === "") {
      quoted = true;
      fieldWasQuoted = true;
      field = "";
    } else if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      endField();
      records.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || record.length > 0) {
    endField();
    records.push(record);
  }
  return records.filter((row) => !(row.length === 1 && row[0] === ""));
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const [header, ...body] = parseRecords(text.replace(/^﻿/, ""));
  if (!header) throw new Error("CSV has no header row");
  const rows = body.map((values, line) => {
    if (values.length !== header.length) {
      throw new Error(`CSV row ${line + 2} has ${values.length} fields, the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, column) => [name, values[column] === "" ? null : values[column]!])) as CsvRow;
  });
  return { header, rows };
}
