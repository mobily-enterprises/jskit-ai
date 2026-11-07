// Whether a value is a plain object: a json-rest-api payload, resource
// definition or option bag, not an array, class instance or null.
function isPlainJsonRestObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export { isPlainJsonRestObject };
