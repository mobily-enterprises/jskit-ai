// The UUID form providers give account, tenant, site and resource IDs.

/** A hyphenated hexadecimal UUID in either case, for building larger patterns. */
const UUID_SOURCE = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}";
const uuidPattern = new RegExp(`^${UUID_SOURCE}$`, "u");

/**
 * A UUID in its hyphenated hexadecimal form.
 * @param {unknown} value
 */
const isUuid = (value) => typeof value === "string" && uuidPattern.test(value);

export { UUID_SOURCE, isUuid };
