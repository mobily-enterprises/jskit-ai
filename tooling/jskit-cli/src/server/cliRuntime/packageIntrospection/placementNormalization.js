import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";

function normalizePlacementOutlets(value) {
  const outlets = [];
  const source = ensureArray(value);
  for (const entry of source) {
    const record = ensureObject(entry);
    const host = String(record.host || "").trim();
    const position = String(record.position || "").trim();
    if (!host || !position) {
      continue;
    }

    const surfaces = [...new Set(ensureArray(record.surfaces).map((item) => String(item || "").trim()).filter(Boolean))];
    const description = String(record.description || "").trim();
    const sourceLabel = String(record.source || "").trim();
    outlets.push(
      Object.freeze({
        host,
        position,
        surfaces: Object.freeze(surfaces),
        description,
        source: sourceLabel
      })
    );
  }

  return Object.freeze(
    [...outlets].sort((left, right) => {
      const hostCompare = left.host.localeCompare(right.host);
      if (hostCompare !== 0) {
        return hostCompare;
      }
      return left.position.localeCompare(right.position);
    })
  );
}

function normalizePlacementContributions(value) {
  const contributions = [];
  for (const entry of ensureArray(value)) {
    const record = ensureObject(entry);
    const id = String(record.id || "").trim();
    const host = String(record.host || "").trim();
    const position = String(record.position || "").trim();
    if (!id || !host || !position) {
      continue;
    }

    const surfaces = [...new Set(ensureArray(record.surfaces).map((item) => String(item || "").trim()).filter(Boolean))];
    const componentToken = String(record.componentToken || "").trim();
    const when = String(record.when || "").trim();
    const description = String(record.description || "").trim();
    const source = String(record.source || "").trim();
    const parsedOrder = Number(record.order);
    const order = Number.isFinite(parsedOrder) ? Math.trunc(parsedOrder) : null;
    contributions.push(
      Object.freeze({
        id,
        host,
        position,
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
      const hostCompare = left.host.localeCompare(right.host);
      if (hostCompare !== 0) {
        return hostCompare;
      }
      const positionCompare = left.position.localeCompare(right.position);
      if (positionCompare !== 0) {
        return positionCompare;
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

export {
  normalizePlacementContributions,
  normalizePlacementOutlets
};
