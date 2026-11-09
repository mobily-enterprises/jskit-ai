import { Buffer } from "node:buffer";
import { RestApiValidationError } from "json-rest-api";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// A blob field (`type: "blob"`, with the `maxBytes` defineTableResource requires) is a value the process holds whole:
// a write takes bytes within the limit, a read answers it only when its fields name it, and no read holds an unbounded
// number of them or answers them as JSON.

// The most bytes of named blobs one page of queryPages() holds: its pages shrink until their blobs fit.
const BLOB_PAGE_BYTES = 16 * 1024 * 1024;

/**
 * The resource's blob fields.
 * @param {{ schema: Record<string, any> }} resource
 * @returns {string[]}
 */
function blobFields(resource) {
  return Object.keys(resource.schema).filter((field) => resource.schema[field]?.type === "blob");
}

/**
 * A write's data with each blob value checked, before any statement: null, or a Buffer or Uint8Array (answered as a
 * Buffer, as every driver takes it) of at most the field's maxBytes. Anything else is a validation error on the field
 * (422 at the HTTP edge).
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {Record<string, unknown>} data The write's own copy of its attributes, which this changes in place.
 */
function checkBlobValues(resource, data) {
  for (const field of blobFields(resource)) {
    const value = data[field];
    if (value === undefined || value === null) {
      continue;
    }
    const refuse = (rule, message) => {
      throw new RestApiValidationError(`${resource.name}.${field} ${message}`, { fields: [field], violations: [{ field, rule, message }] });
    };
    if (!(value instanceof Uint8Array)) {
      refuse("blob", "is a blob, whose value is a Buffer or a Uint8Array.");
    }
    const { maxBytes } = resource.schema[field];
    if (value.byteLength > maxBytes) {
      refuse("max_bytes", `holds at most ${maxBytes} bytes; this value has ${value.byteLength}.`);
    }
    if (!Buffer.isBuffer(value)) {
      data[field] = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
  }
  return data;
}

/**
 * The blob fields a read's `fields` names, of the resource (a list of names, or its entry in a sparse fieldset) and of
 * any other resource a sparse fieldset names, each as `{ label, maxBytes }`.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} fields
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} resourceNamed
 */
function namedBlobs(resource, fields, resourceNamed) {
  const lists = Array.isArray(fields) ? [[resource, fields]]
    : isRecord(fields) ? Object.entries(fields).map(([name, list]) => [name === resource.name ? resource : resourceNamed(name), String(list).split(",")])
      : [];
  return lists.flatMap(([table, list]) => (table === null ? [] : list
    .map((field) => String(field).trim())
    .filter((field) => table.schema[field]?.type === "blob")
    .map((field) => ({ label: `${table.name}.${field}`, maxBytes: table.schema[field].maxBytes }))));
}

/**
 * Refuses blob fields in a read that reads every matching row at once (queryAll, lockWhere, claim), before anything runs.
 * @param {string} name The resource's name.
 * @param {string} caller The handle method, for the message.
 * @param {ReadonlyArray<{ label: string }>} blobs
 */
function refuseBlobsInBulk(name, caller, blobs) {
  if (blobs.length > 0) {
    throw new TypeError(
      `${name}.${caller}() reads every matching row at once, so it reads no blob (${blobs.map(({ label }) => label).join(", ")}): ` +
        "read blobs a page at a time with queryPages(), whose pages hold at most 16 MiB of them, or one record's with get()."
    );
  }
}

/**
 * Refuses blob fields in a JSON:API read, whose JSON holds no binary: a 400, since a client's sparse fieldset names them.
 * @param {string} name The resource's name.
 * @param {ReadonlyArray<{ label: string }>} blobs
 */
function refuseBlobsInJson(name, blobs) {
  if (blobs.length > 0) {
    const fields = blobs.map(({ label }) => label).join(", ");
    throw new AppError(
      400,
      `${name} answers JSON:API documents, whose JSON holds no binary, so their fields name no blob (${fields}). ` +
        "A route of its own serves a blob: it reads it with get(id, { fields }) and answers it as the response body.",
      { code: "JSON_API_FIELDSET_INVALID", messageCode: "resource.blobFields", messageParams: { fields } }
    );
  }
}

/**
 * The page size of a queryPages() read: `serverPageSize`, or fewer rows, at least one, when the read names blobs, so
 * one page's blobs fit BLOB_PAGE_BYTES.
 * @param {ReadonlyArray<{ maxBytes: number }>} blobs
 * @param {number} serverPageSize
 */
function blobPageSize(blobs, serverPageSize) {
  const bytes = blobs.reduce((sum, { maxBytes }) => sum + maxBytes, 0);
  return bytes > 0 ? Math.max(1, Math.min(serverPageSize, Math.floor(BLOB_PAGE_BYTES / bytes))) : serverPageSize;
}

export { blobFields, blobPageSize, checkBlobValues, namedBlobs, refuseBlobsInBulk, refuseBlobsInJson };
