// What local sign-in's table records share: their values as stored and read back, and one-record reads and writes on a
// table resource handle.

import { nowIso, toDate } from "./dateTimes.js";

// One page of one record: a lookup by a unique field.
const FIRST = Object.freeze({ size: 1 });

// The ISO text written for a required timestamp: the value, or the fallback (now) when it has none.
function requiredDateTime(value, fallback = nowIso()) {
  return toDate(value || fallback).toISOString();
}

function optionalDateTime(value) {
  return value ? toDate(value).toISOString() : null;
}

function readDateTime(value, fallback = "") {
  if (!value) {
    return fallback;
  }
  return toDate(value).toISOString();
}

function text(value) {
  return String(value || "");
}

/**
 * The record a unique field's value finds, or null; an empty value finds none.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {string} field
 * @param {unknown} value
 * @param {object} options
 */
async function findOne(handle, field, value, options) {
  const wanted = text(value);
  if (!wanted) {
    return null;
  }
  const { records } = await handle.query({ filters: { [field]: wanted }, page: FIRST }, options);
  return records[0] || null;
}

/**
 * The record with this id, or null; an empty id finds none.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {object} options
 */
async function findById(handle, id, options) {
  const wanted = text(id);
  return wanted ? handle.get(wanted, {}, { ...options, missing: "skip" }) : null;
}

/**
 * Deletes the record with this id and answers 1, or 0 when it is missing: one DELETE, so of two concurrent deletes
 * only one answers 1.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {object} options
 */
async function deleteById(handle, id, options) {
  const wanted = text(id);
  return wanted && (await handle.delete(wanted, { ...options, missing: "skip" })) !== null ? 1 : 0;
}

/**
 * Writes the record with this id: patches it when it exists, creates it otherwise. An upsert would keep the later of
 * two first writes at once, so two first failed sign-ins of an email would count once; this create instead fails the
 * later one with a duplicate entry, and the backend runs that call again on the row the first one made.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {string} id
 * @param {Record<string, unknown>} attributes
 * @param {object} options
 */
async function replaceById(handle, id, attributes, options) {
  if (await handle.get(id, {}, { ...options, missing: "skip" })) {
    await handle.patch(id, attributes, { ...options, returning: "none" });
  } else {
    await handle.create({ id, ...attributes }, { ...options, returning: "none" });
  }
}

/**
 * Patches an existing record and answers it after the change; null when it is missing, which fails no transaction.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {unknown} id
 * @param {Record<string, unknown>} changes
 * @param {object} options
 */
async function patchExisting(handle, id, changes, options) {
  const wanted = text(id);
  return wanted ? handle.patch(wanted, changes, { ...options, missing: "skip" }) : null;
}

export { deleteById, findById, findOne, optionalDateTime, patchExisting, readDateTime, replaceById, requiredDateTime, text };
