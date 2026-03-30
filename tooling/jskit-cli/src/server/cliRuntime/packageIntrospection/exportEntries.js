import path from "node:path";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import { fileExists } from "../ioAndMigrations.js";
import { normalizeRelativePosixPath } from "../localPackageSupport.js";

function collectPackageExportEntries(exportsField) {
  const entries = [];
  const normalizeExportSubpath = (subpath) => {
    const normalized = String(subpath || ".").trim() || ".";
    if (normalized === "." || normalized === "./") {
      return {
        normalized: ".",
        segments: []
      };
    }

    const withoutPrefix = normalized.startsWith("./") ? normalized.slice(2) : normalized;
    const segments = withoutPrefix.split("/").map((value) => String(value || "").trim()).filter(Boolean);
    return {
      normalized: normalized.startsWith("./") ? normalized : `./${withoutPrefix}`,
      segments
    };
  };

  const resolveSubpathSortPriority = (subpath) => {
    const normalized = normalizeExportSubpath(subpath);
    const firstSegment = String(normalized.segments[0] || "").trim();
    if (firstSegment === "client") {
      return 0;
    }
    if (firstSegment === "server") {
      return 1;
    }
    if (firstSegment === "shared") {
      return 2;
    }
    if (normalized.normalized === ".") {
      return 3;
    }
    return 10;
  };

  const appendEntry = (subpath, conditions, target) => {
    const normalizedSubpath = String(subpath || ".").trim() || ".";
    const normalizedTarget = String(target || "").trim();
    if (!normalizedTarget) {
      return;
    }
    const normalizedConditions = ensureArray(conditions).map((value) => String(value || "").trim()).filter(Boolean);
    entries.push({
      subpath: normalizedSubpath,
      condition: normalizedConditions.length > 0 ? normalizedConditions.join(".") : "default",
      target: normalizedTarget
    });
  };

  const visit = (subpath, value, conditionStack = []) => {
    if (typeof value === "string") {
      appendEntry(subpath, conditionStack, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(subpath, item, conditionStack);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [conditionName, nested] of Object.entries(value)) {
      visit(subpath, nested, [...conditionStack, conditionName]);
    }
  };

  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    visit(".", exportsField, []);
  } else if (exportsField && typeof exportsField === "object") {
    const root = ensureObject(exportsField);
    const rootKeys = Object.keys(root);
    const hasSubpathKeys = rootKeys.some((key) => key.startsWith("."));
    if (hasSubpathKeys) {
      for (const [subpath, value] of Object.entries(root)) {
        visit(subpath, value, []);
      }
    } else {
      visit(".", root, []);
    }
  }

  const deduplicated = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.subpath}::${entry.condition}::${entry.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(entry);
  }
  return deduplicated.sort((left, right) => {
    const leftPriority = resolveSubpathSortPriority(left.subpath);
    const rightPriority = resolveSubpathSortPriority(right.subpath);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftParts = normalizeExportSubpath(left.subpath);
    const rightParts = normalizeExportSubpath(right.subpath);
    const leftRoot = String(leftParts.segments[0] || "");
    const rightRoot = String(rightParts.segments[0] || "");
    const rootComparison = leftRoot.localeCompare(rightRoot);
    if (rootComparison !== 0) {
      return rootComparison;
    }

    const depthComparison = leftParts.segments.length - rightParts.segments.length;
    if (depthComparison !== 0) {
      return depthComparison;
    }

    const subpathComparison = left.subpath.localeCompare(right.subpath);
    if (subpathComparison !== 0) {
      return subpathComparison;
    }
    const conditionComparison = left.condition.localeCompare(right.condition);
    if (conditionComparison !== 0) {
      return conditionComparison;
    }
    return left.target.localeCompare(right.target);
  });
}

async function describePackageExports({ packageRoot, packageJson }) {
  const rootDir = String(packageRoot || "").trim();
  if (!rootDir) {
    return [];
  }

  const exportsField = ensureObject(packageJson).exports;
  const entries = collectPackageExportEntries(exportsField);
  const records = [];

  for (const entry of entries) {
    const subpath = String(entry.subpath || ".").trim() || ".";
    const condition = String(entry.condition || "default").trim() || "default";
    const target = String(entry.target || "").trim();
    const isPattern = subpath.includes("*") || target.includes("*");
    const isRelativeTarget = target.startsWith("./");
    let targetExists = null;
    if (isRelativeTarget && !isPattern) {
      const absoluteTargetPath = path.resolve(rootDir, target);
      targetExists = await fileExists(absoluteTargetPath);
    }

    let targetType = "external";
    if (isPattern) {
      targetType = "pattern";
    } else if (isRelativeTarget) {
      targetType = "file";
    }

    records.push({
      subpath,
      condition,
      target,
      targetType,
      targetExists
    });
  }

  return records;
}

function formatPackageSubpathImport(packageId, subpath) {
  const normalizedPackageId = String(packageId || "").trim();
  const normalizedSubpath = String(subpath || "").trim();
  if (!normalizedPackageId) {
    return normalizedSubpath;
  }
  if (!normalizedSubpath || normalizedSubpath === ".") {
    return normalizedPackageId;
  }
  if (normalizedSubpath.startsWith("./")) {
    return `${normalizedPackageId}/${normalizedSubpath.slice(2)}`;
  }
  if (normalizedSubpath.startsWith("/")) {
    return `${normalizedPackageId}${normalizedSubpath}`;
  }
  return `${normalizedPackageId}/${normalizedSubpath}`;
}

function deriveCanonicalExportTargetForSubpath(subpath) {
  const normalizedSubpath = String(subpath || "").trim();
  if (!normalizedSubpath) {
    return "";
  }
  if (normalizedSubpath === ".") {
    return "./src/index.js";
  }
  if (!normalizedSubpath.startsWith("./")) {
    return "";
  }

  const bareSubpath = normalizedSubpath.slice(2);
  if (!bareSubpath) {
    return "";
  }
  if (bareSubpath === "client" || bareSubpath === "server" || bareSubpath === "shared") {
    return `./src/${bareSubpath}/index.js`;
  }

  const roots = ["client", "server", "shared"];
  for (const root of roots) {
    if (!bareSubpath.startsWith(`${root}/`)) {
      continue;
    }
    const suffix = bareSubpath.slice(root.length + 1);
    if (!suffix) {
      return "";
    }
    const hasJsExtension = /\.(?:c|m)?js$/.test(suffix);
    const normalizedSuffix = hasJsExtension ? suffix : `${suffix}.js`;
    return `./src/${root}/${normalizedSuffix}`;
  }

  return "";
}

function shouldShowPackageExportTarget({ subpath, target, targetType }) {
  if (String(targetType || "").trim() !== "file") {
    return true;
  }

  const canonicalTarget = deriveCanonicalExportTargetForSubpath(subpath);
  if (!canonicalTarget) {
    return true;
  }

  const normalizeTarget = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const withoutPrefix = raw.startsWith("./") ? raw.slice(2) : raw;
    return `./${normalizeRelativePosixPath(withoutPrefix)}`;
  };

  return normalizeTarget(target) !== normalizeTarget(canonicalTarget);
}

export {
  describePackageExports,
  formatPackageSubpathImport,
  shouldShowPackageExportTarget
};
