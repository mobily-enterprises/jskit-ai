export { RbacServiceProvider } from "./providers/RbacServiceProvider.js";
import {
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  hasPermission,
  listManifestPermissions,
  loadRbacManifest,
  manifestIncludesPermission,
  normalizeManifest,
  resolveRolePermissions
} from "./lib/rbac.js";

export const __testable__ = Object.freeze({
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  hasPermission,
  listManifestPermissions,
  loadRbacManifest,
  manifestIncludesPermission,
  normalizeManifest,
  resolveRolePermissions
});
