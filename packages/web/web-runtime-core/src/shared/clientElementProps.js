import { computed } from "vue";

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }

  return normalized;
}

function resolveVariant(variant, config = {}) {
  const resolved = {};
  const source = toRecord(variant);

  for (const [key, rule] of Object.entries(config)) {
    const supported = Array.isArray(rule?.supported) ? rule.supported : [];
    const fallback = rule?.fallback;
    if (supported.length < 1) {
      const normalized = String(source[key] || "")
        .trim()
        .toLowerCase();
      resolved[key] = normalized || fallback;
      continue;
    }

    resolved[key] = normalizeVariantValue(source[key], supported, fallback);
  }

  return resolved;
}

function resolveFeatures(features, defaults = {}) {
  const resolved = {};
  const source = toRecord(features);

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (defaultValue === true) {
      resolved[key] = source[key] !== false;
      continue;
    }

    if (defaultValue === false) {
      resolved[key] = source[key] === true;
      continue;
    }

    resolved[key] = Boolean(source[key]);
  }

  return resolved;
}

function mergeCopy(defaultCopy, copy) {
  const base = defaultCopy && typeof defaultCopy === "object" ? defaultCopy : {};
  return {
    ...base,
    ...toRecord(copy)
  };
}

function useClientElementProps({ props, defaultCopy = {}, variantConfig = {}, featureDefaults = {} } = {}) {
  const copyText = computed(() => mergeCopy(defaultCopy, props?.copy));
  const resolvedVariant = computed(() => resolveVariant(props?.variant, variantConfig));
  const resolvedFeatures = computed(() => resolveFeatures(props?.features, featureDefaults));

  return {
    toRecord,
    copyText,
    resolvedVariant,
    resolvedFeatures
  };
}

export {
  useClientElementProps,
  toRecord,
  normalizeVariantValue,
  resolveVariant,
  resolveFeatures,
  mergeCopy
};
