// Objects found frozen all the way down. Freezing cannot be undone, so an object never leaves this set.
const deepFrozenObjects = new WeakSet();

function isFrozenThroughout(node, checked) {
  if (node === null || typeof node !== "object" || deepFrozenObjects.has(node) || checked.has(node)) return true;
  if (!Object.isFrozen(node)) return false;
  checked.add(node);
  return Reflect.ownKeys(node).every((key) => {
    const property = Object.getOwnPropertyDescriptor(node, key);
    return !Object.hasOwn(property, "value") || isFrozenThroughout(property.value, checked);
  });
}

/**
 * True when `value` is not an object, or it and every object its own data properties hold are frozen. Such a value
 * can never change, so what is computed from it can be kept by identity. Accessors are not called.
 */
function isDeepFrozen(value) {
  if (value === null || typeof value !== "object" || deepFrozenObjects.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  const checked = new Set();
  if (!isFrozenThroughout(value, checked)) return false;
  for (const node of checked) deepFrozenObjects.add(node);
  return true;
}

export { isDeepFrozen };
