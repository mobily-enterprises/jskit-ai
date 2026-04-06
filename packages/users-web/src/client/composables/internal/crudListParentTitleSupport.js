import {
  normalizeCrudLookupContainerKey,
  resolveCrudLookupApiPathFromNamespace,
  resolveCrudLookupFieldKeyFromRouteParam
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveLookupFieldDisplayValue, resolveRecordTitle } from "../crud/crudLookupFieldLabelSupport.js";
import { resolveRouteParamNamesInOrder, toRouteParamValue } from "../support/routeTemplateHelpers.js";

function singularizeLabel(value = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }
  if (normalizedValue.endsWith("ies")) {
    return `${normalizedValue.slice(0, -3)}y`;
  }
  if (normalizedValue.endsWith("s") && !normalizedValue.endsWith("ss")) {
    return normalizedValue.slice(0, -1);
  }
  return normalizedValue;
}

function toTitleLabel(value = "") {
  const normalizedValue = normalizeText(value)
    .replace(/Id$/u, "")
    .replace(/[_-]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  if (!normalizedValue) {
    return "";
  }

  return normalizedValue
    .split(/\s+/u)
    .filter(Boolean)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function resolveEntityLabel(routeParamKey = "", relationNamespace = "") {
  const routeLabel = singularizeLabel(toTitleLabel(routeParamKey));
  if (routeLabel) {
    return routeLabel;
  }

  const namespaceLabel = singularizeLabel(toTitleLabel(relationNamespace));
  if (namespaceLabel) {
    return namespaceLabel;
  }

  return "Record";
}

function resolveLookupFieldMeta(resource = {}, fieldKey = "") {
  const normalizedFieldKey = normalizeText(fieldKey);
  if (!normalizedFieldKey) {
    return null;
  }

  const entries = Array.isArray(resource?.fieldMeta) ? resource.fieldMeta : [];
  for (const entry of entries) {
    if (normalizeText(entry?.key) !== normalizedFieldKey) {
      continue;
    }

    const relation = entry?.relation;
    if (!relation || normalizeText(relation.kind).toLowerCase() !== "lookup") {
      return null;
    }

    return entry;
  }

  return null;
}

function resolveCrudListParentDescriptor({ resource = {}, route = null, recordIdParam = "recordId" } = {}) {
  const orderedRouteParamNames = resolveRouteParamNamesInOrder(route);
  if (orderedRouteParamNames.length < 1) {
    return null;
  }

  const normalizedRecordIdParam = normalizeText(recordIdParam) || "recordId";
  for (const routeParamKey of [...orderedRouteParamNames].reverse()) {
    if (routeParamKey === "workspaceSlug" || routeParamKey === normalizedRecordIdParam) {
      continue;
    }

    const fieldKey = resolveCrudLookupFieldKeyFromRouteParam(resource, routeParamKey);
    if (!fieldKey) {
      continue;
    }

    const fieldMeta = resolveLookupFieldMeta(resource, fieldKey);
    if (!fieldMeta) {
      continue;
    }

    const relation = fieldMeta.relation || {};
    const relationNamespace = normalizeText(relation.namespace);
    const containerKey = normalizeCrudLookupContainerKey(relation.containerKey, {
      defaultValue: resource?.contract?.lookup?.containerKey || "lookups"
    });

    return Object.freeze({
      fieldKey,
      routeParamKey,
      relationNamespace,
      entityLabel: resolveEntityLabel(routeParamKey, relationNamespace),
      labelKey: normalizeText(relation.labelKey),
      fieldDescriptor: Object.freeze({
        key: fieldKey,
        relation: Object.freeze({
          kind: "lookup",
          valueKey: normalizeText(relation.valueKey) || "id",
          labelKey: normalizeText(relation.labelKey),
          containerKey
        })
      }),
      apiUrlTemplate: relationNamespace
        ? `${resolveCrudLookupApiPathFromNamespace(relationNamespace)}/:${routeParamKey}`
        : ""
    });
  }

  return null;
}

function resolveCrudListParentTitleFromItems(items = [], descriptor = null) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!descriptor?.fieldDescriptor) {
    return "";
  }

  for (const item of sourceItems) {
    const resolvedTitle = normalizeText(resolveLookupFieldDisplayValue(item, descriptor.fieldDescriptor));
    if (resolvedTitle) {
      return resolvedTitle;
    }
  }

  return "";
}

function resolveCrudListParentRecordTitle(record = {}, descriptor = null) {
  const resolvedTitle = resolveRecordTitle(record, {
    fallbackKey: normalizeText(descriptor?.labelKey),
    defaultValue: ""
  });
  if (resolvedTitle && resolvedTitle !== "-") {
    return resolvedTitle;
  }

  const entityLabel = normalizeText(descriptor?.entityLabel) || "Record";
  const recordId = toRouteParamValue(record?.id);
  if (recordId) {
    return `${entityLabel} #${recordId}`;
  }

  return "";
}

export {
  resolveCrudListParentDescriptor,
  resolveCrudListParentRecordTitle,
  resolveCrudListParentTitleFromItems
};
