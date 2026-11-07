// Local sign-in's timestamps: read from any stored or given form, and refused when they are not dates.

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {unknown} value
 * @returns {Date}
 */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid local auth DB timestamp.");
  }
  return date;
}

export { nowIso, toDate };
