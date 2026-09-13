import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

// Application-owned, in-memory composition for bounded files. The format is an
// explicit application decision, never guessed from an untrusted filename.
export function encodeDataFile(format, value) {
  if (format === "json") {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError("Supply a JSON-serializable value.");
    return new TextEncoder().encode(text);
  }
  // CSV is an array of row arrays, including any header row. Preserve strings
  // rather than guessing numeric types or discarding leading zeroes.
  if (format === "csv") return new TextEncoder().encode(stringify(value));
  // Parquet requires native columnData: [{ name, type, data }]. The application
  // supplies its explicit schema; do not infer a schema from an empty table.
  if (format === "parquet") return new Uint8Array(parquetWriteBuffer({ columnData: value }));
  throw new TypeError("Choose json, csv or parquet.");
}

export async function decodeDataFile(format, bytes, { maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Supply file bytes as Uint8Array.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.byteLength > maxBytes) {
    throw new RangeError("File exceeds the application's in-memory parsing limit.");
  }
  if (format === "parquet") return parquetReadObjects({
    file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (format === "json") return JSON.parse(text);
  if (format === "csv") return parse(text, { bom: true });
  throw new TypeError("Choose json, csv or parquet.");
}
