import { MODULE_ENABLEMENT_MODES } from "./descriptor.js";
import { addDiagnosticForMode, normalizeMode } from "./compositionMode.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";

function normalizeMountPath(path) {
  const normalized = String(path || "").trim();
  if (!normalized) {
    throw new TypeError("Mount path must be a non-empty string.");
  }

  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const squashed = prefixed.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }
  return squashed;
}

function resolveMounts({
  modules = [],
  overrides = {},
  reservedPaths = [],
  mode = MODULE_ENABLEMENT_MODES.strict,
  diagnostics
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const collector = diagnostics || createDiagnosticsCollector();

  const mountsByKey = {};
  const keyOwners = new Map();
  const pathOwners = new Map();
  const normalizedReservedPaths = new Set((Array.isArray(reservedPaths) ? reservedPaths : []).map(normalizeMountPath));

  for (const module of modules) {
    for (const mount of module.mounts || []) {
      const key = mount.key;

      if (keyOwners.has(key)) {
        addDiagnosticForMode(collector, normalizedMode, {
          code: "MODULE_MOUNT_KEY_CONFLICT",
          moduleId: module.id,
          message: `Mount key \"${key}\" is already declared by \"${keyOwners.get(key)}\".`
        });

        if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
          throwOnDiagnosticErrors(collector, "Mount resolution failed.");
        }

        continue;
      }

      const rawOverride = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
      const hasOverride = rawOverride != null && String(rawOverride || "").trim() !== "";

      if (hasOverride && mount.allowOverride === false) {
        addDiagnosticForMode(collector, normalizedMode, {
          code: "MODULE_MOUNT_OVERRIDE_FORBIDDEN",
          moduleId: module.id,
          message: `Mount key \"${key}\" does not allow overrides.`
        });

        if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
          throwOnDiagnosticErrors(collector, "Mount resolution failed.");
        }
      }

      const effectivePath = hasOverride && mount.allowOverride !== false ? rawOverride : mount.defaultPath;
      const normalizedPath = normalizeMountPath(effectivePath);

      if (normalizedReservedPaths.has(normalizedPath)) {
        addDiagnosticForMode(collector, normalizedMode, {
          code: "MODULE_MOUNT_RESERVED_PATH_CONFLICT",
          moduleId: module.id,
          message: `Mount key \"${key}\" resolves to reserved path \"${normalizedPath}\".`,
          details: {
            key,
            path: normalizedPath
          }
        });

        if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
          throwOnDiagnosticErrors(collector, "Mount resolution failed.");
        }

        continue;
      }

      if (pathOwners.has(normalizedPath)) {
        addDiagnosticForMode(collector, normalizedMode, {
          code: "MODULE_MOUNT_PATH_CONFLICT",
          moduleId: module.id,
          message: `Mount path \"${normalizedPath}\" is already claimed by \"${pathOwners.get(normalizedPath)}\".`
        });

        if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
          throwOnDiagnosticErrors(collector, "Mount resolution failed.");
        }

        continue;
      }

      const aliases = [];
      for (const alias of mount.aliases || []) {
        const normalizedAlias = normalizeMountPath(alias);
        if (normalizedAlias === normalizedPath) {
          continue;
        }

        if (normalizedReservedPaths.has(normalizedAlias) || pathOwners.has(normalizedAlias)) {
          addDiagnosticForMode(collector, normalizedMode, {
            code: "MODULE_MOUNT_ALIAS_CONFLICT",
            moduleId: module.id,
            message: `Mount alias \"${normalizedAlias}\" for key \"${key}\" collides with an existing or reserved path.`,
            details: {
              key,
              alias: normalizedAlias
            }
          });

          if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
            throwOnDiagnosticErrors(collector, "Mount resolution failed.");
          }

          continue;
        }

        aliases.push(normalizedAlias);
      }

      keyOwners.set(key, module.id);
      pathOwners.set(normalizedPath, key);
      for (const alias of aliases) {
        pathOwners.set(alias, key);
      }

      mountsByKey[key] = {
        key,
        moduleId: module.id,
        defaultPath: normalizeMountPath(mount.defaultPath),
        path: normalizedPath,
        surface: mount.surface,
        allowOverride: mount.allowOverride !== false,
        aliases
      };
    }
  }

  const paths = {};
  for (const [path, key] of pathOwners.entries()) {
    paths[path] = key;
  }

  return {
    mode: normalizedMode,
    mountsByKey,
    paths,
    diagnostics: collector
  };
}

const __testables = {
  normalizeMode,
  normalizeMountPath
};

export { resolveMounts, __testables };
