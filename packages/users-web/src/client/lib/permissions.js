import {
  hasPermission,
  normalizePermissionList
} from "@jskit-ai/kernel/shared/support";

function toPermissionSet(values) {
  const normalized = normalizePermissionList(values);
  if (normalized.length < 1) {
    return new Set();
  }
  return new Set(normalized);
}

function arePermissionListsEqual(left, right) {
  const leftSet = toPermissionSet(left);
  const rightSet = toPermissionSet(right);
  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const permission of leftSet) {
    if (!rightSet.has(permission)) {
      return false;
    }
  }

  return true;
}

export {
  normalizePermissionList,
  arePermissionListsEqual,
  hasPermission
};
