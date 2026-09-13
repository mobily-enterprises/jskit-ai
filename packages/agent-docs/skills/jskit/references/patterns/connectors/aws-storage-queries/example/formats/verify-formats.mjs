import assert from "node:assert/strict";
import test from "node:test";
import { encodeDataFile, decodeDataFile } from "./data-formats.js";

test("JSON retains structured values and rejects malformed content", async () => {
  const value = { name: "Málaga", enabled: true, count: 2, values: [null, "001"] };
  assert.deepEqual(await decodeDataFile("json", encodeDataFile("json", value)), value);
  await assert.rejects(decodeDataFile("json", new TextEncoder().encode('{"bad":')), SyntaxError);
});

test("CSV retains quoted commas, quotes, newlines, empty cells and leading zeroes", async () => {
  const rows = [["id", "description"], ["001", 'comma, quote " and\nnewline'], ["002", ""]];
  assert.deepEqual(await decodeDataFile("csv", encodeDataFile("csv", rows)), rows);
  await assert.rejects(decodeDataFile("csv", new TextEncoder().encode('"unterminated')), /Quote Not Closed/);
});

test("Parquet creates an actual file and reads explicit typed nullable columns", async () => {
  const encoded = encodeDataFile("parquet", [
    { name: "name", type: "STRING", data: ["Málaga", "Sydney"] },
    { name: "count", type: "INT32", data: [3, null] },
    { name: "active", type: "BOOLEAN", data: [true, false] }
  ]);
  assert.equal(new TextDecoder().decode(encoded.slice(0, 4)), "PAR1");
  const padded = new Uint8Array(encoded.length + 6);
  padded.set(encoded, 3);
  assert.deepEqual(await decodeDataFile("parquet", padded.subarray(3, -3)), [
    { name: "Málaga", count: 3, active: true }, { name: "Sydney", count: null, active: false }
  ]);
  await assert.rejects(decodeDataFile("parquet", encoded.slice(0, 12)));
});

test("native composition rejects invalid UTF-8, excess bytes and unknown formats", async () => {
  await assert.rejects(decodeDataFile("csv", new Uint8Array([255])), TypeError);
  await assert.rejects(decodeDataFile("json", new Uint8Array(9), { maxBytes: 8 }), RangeError);
  await assert.rejects(decodeDataFile("xml", new Uint8Array()), TypeError);
  assert.throws(() => encodeDataFile("xml", []), TypeError);
});
