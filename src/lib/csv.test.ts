import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("returns an empty field as null, not an empty string", () => {
    expect(parseCsv("a,b,c\n1,,3\n").rows).toEqual([{ a: "1", b: null, c: "3" }]);
  });

  it("keeps commas and doubled quotes inside quoted fields", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n').rows).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });

  it("handles CRLF line endings and a byte-order mark", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n").rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("rejects a row with the wrong number of fields", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/row 2 has 3 fields/);
  });

  it("reads the client's transactions file with its two unknown arrival dates as null", () => {
    const text = readFileSync(path.join(process.cwd(), "assets", "seed-data", "transactions.csv"), "utf8");
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.estimated_arrival === null).map((row) => row.transaction_id)).toEqual(["TXN-9003", "TXN-9004"]);
  });
});
