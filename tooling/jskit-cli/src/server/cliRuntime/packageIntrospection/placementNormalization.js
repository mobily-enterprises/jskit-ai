import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import {
  normalizePlacementKind,
  normalizePlacementOwnerId,
  normalizePlacementTopologyDefinition,
  normalizeShellOutletTargetId,
  resolvePlacementTargetReference
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";

function normalizePlacementOutlets(value) {
  const outlets = [];
  const source = ensureArray(value);
  for (const entry of source) {
    const record = ensureObject(entry);
    const target = normalizeShellOutletTargetId(record.target);
    if (!target) {
      continue;
    }

    const surfaces = [...new Set(ensureArray(record.surfaces).map((item) => String(item || "").trim()).filter(Boolean))];
    const description = String(record.description || "").trim();
    const sourceLabel = String(record.source || "").trim();
    outlets.push(
      Object.freeze({
        target,
        surfaces: Object.freeze(surfaces),
        description,
        source: sourceLabel
      })
    );
  }

  return Object.freeze(
    [...outlets].sort((left, right) => {
      return left.target.localeCompare(right.target);
    })
  );
}

function normalizePlacementContributions(value) {
  const contributions = [];
  for (const entry of ensureArray(value)) {
    const record = ensureObject(entry);
    const id = String(record.id || "").trim();
    const targetReference = resolvePlacementTargetReference(record.target);
    if (!id || !targetReference?.id) {
      continue;
    }

    const surfaces = [...new Set(ensureArray(record.surfaces).map((item) => String(item || "").trim()).filter(Boolean))];
    const kind = normalizePlacementKind(record.kind) || (String(record.componentToken || "").trim() ? "component" : "link");
    const componentToken = String(record.componentToken || "").trim();
    const when = String(record.when || "").trim();
    const description = String(record.description || "").trim();
    const source = String(record.source || "").trim();
    const owner = normalizePlacementOwnerId(record.owner);
    const parsedOrder = Number(record.order);
    const order = Number.isFinite(parsedOrder) ? Math.trunc(parsedOrder) : null;
    contributions.push(
      Object.freeze({
        id,
        target: targetReference.id,
        targetType: targetReference.type,
        owner,
        kind,
        surfaces: Object.freeze(surfaces),
        order,
        componentToken,
        when,
        description,
        source
      })
    );
  }

  return Object.freeze(
    [...contributions].sort((left, right) => {
      const targetCompare = left.target.localeCompare(right.target);
      if (targetCompare !== 0) {
        return targetCompare;
      }
      const leftOrder = Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY;
      const rightOrder = Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    })
  );
}

function normalizePlacementTopology(value, { context = "package placement topology" } = {}) {
  return normalizePlacementTopologyDefinition(value, { context }).placements;
}

export {
  normalizePlacementContributions,
  normalizePlacementOutlets,
  normalizePlacementTopology
};
