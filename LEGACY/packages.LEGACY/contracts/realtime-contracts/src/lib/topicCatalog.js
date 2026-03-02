function normalizeTopic(topicValue) {
  return String(topicValue || "").trim();
}

const TOPIC_SCOPES = Object.freeze({
  WORKSPACE: "workspace",
  USER: "user"
});

function normalizePermission(permissionValue) {
  return String(permissionValue || "").trim();
}

function normalizeSurface(surfaceValue) {
  return String(surfaceValue || "")
    .trim()
    .toLowerCase();
}

function normalizeStringArray(values, normalizer) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => normalizer(value)).filter(Boolean))];
}

function normalizeTopicScope(scopeValue) {
  const normalizedScope = String(scopeValue || "")
    .trim()
    .toLowerCase();
  if (normalizedScope === TOPIC_SCOPES.USER) {
    return TOPIC_SCOPES.USER;
  }

  return TOPIC_SCOPES.WORKSPACE;
}

function normalizeRequiredPermissionBySurface(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }

  const entries = Object.entries(value)
    .map(([surface, permissions]) => {
      const normalizedSurface = normalizeSurface(surface);
      if (!normalizedSurface) {
        return null;
      }

      const normalizedPermissions = normalizeStringArray(permissions, normalizePermission);
      return [normalizedSurface, Object.freeze(normalizedPermissions)];
    })
    .filter(Boolean);
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeTopicRule(topicRule) {
  const source = topicRule && typeof topicRule === "object" ? topicRule : {};
  return Object.freeze({
    scope: normalizeTopicScope(source.scope),
    subscribeSurfaces: Object.freeze(normalizeStringArray(source.subscribeSurfaces, normalizeSurface)),
    requiredAnyPermission: Object.freeze(normalizeStringArray(source.requiredAnyPermission, normalizePermission)),
    requiredAnyPermissionBySurface: normalizeRequiredPermissionBySurface(source.requiredAnyPermissionBySurface)
  });
}

function createTopicCatalog(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error("createTopicCatalog requires a topic definition object.");
  }

  const entries = Object.entries(definition)
    .map(([topic, rule]) => {
      const normalizedTopic = normalizeTopic(topic);
      if (!normalizedTopic) {
        return null;
      }
      return [normalizedTopic, normalizeTopicRule(rule)];
    })
    .filter(Boolean);

  return Object.freeze(Object.fromEntries(entries));
}

function listTopics(catalog) {
  if (!catalog || typeof catalog !== "object") {
    return [];
  }
  return Object.keys(catalog);
}

function getTopicRule(catalog, topicValue) {
  const topic = normalizeTopic(topicValue);
  if (!topic) {
    return null;
  }
  return catalog?.[topic] || null;
}

function resolveTopicScope(catalog, topicValue) {
  const topicRule = getTopicRule(catalog, topicValue);
  if (!topicRule || typeof topicRule !== "object") {
    return "";
  }

  return normalizeTopicScope(topicRule.scope);
}

function isWorkspaceScopedTopic(catalog, topicValue) {
  return resolveTopicScope(catalog, topicValue) === TOPIC_SCOPES.WORKSPACE;
}

function isUserScopedTopic(catalog, topicValue) {
  return resolveTopicScope(catalog, topicValue) === TOPIC_SCOPES.USER;
}

function isSupportedTopic(catalog, topicValue) {
  return Boolean(getTopicRule(catalog, topicValue));
}

function isTopicAllowedForSurface(catalog, topicValue, surfaceValue) {
  const topicRule = getTopicRule(catalog, topicValue);
  if (!topicRule) {
    return false;
  }

  const normalizedSurface = normalizeSurface(surfaceValue);
  if (!normalizedSurface) {
    return false;
  }

  const subscribeSurfaces = Array.isArray(topicRule.subscribeSurfaces) ? topicRule.subscribeSurfaces : [];
  if (subscribeSurfaces.length < 1) {
    return true;
  }

  return subscribeSurfaces.includes(normalizedSurface);
}

function listTopicsForSurface(catalog, surfaceValue) {
  return listTopics(catalog).filter((topic) => isTopicAllowedForSurface(catalog, topic, surfaceValue));
}

function resolveRequiredPermissions(catalog, topicValue, surfaceValue) {
  const topicRule = getTopicRule(catalog, topicValue);
  if (!topicRule || typeof topicRule !== "object") {
    return [];
  }

  const surfaceMap =
    topicRule.requiredAnyPermissionBySurface && typeof topicRule.requiredAnyPermissionBySurface === "object"
      ? topicRule.requiredAnyPermissionBySurface
      : null;
  const normalizedSurface = normalizeSurface(surfaceValue);
  if (surfaceMap && normalizedSurface) {
    const surfacedPermissions = Array.isArray(surfaceMap[normalizedSurface]) ? surfaceMap[normalizedSurface] : null;
    if (surfacedPermissions) {
      return surfacedPermissions;
    }
  }

  return Array.isArray(topicRule.requiredAnyPermission) ? topicRule.requiredAnyPermission : [];
}

function hasTopicPermission(catalog, topicValue, permissions, surfaceValue = "") {
  if (!isSupportedTopic(catalog, topicValue)) {
    return false;
  }

  const requiredAnyPermission = resolveRequiredPermissions(catalog, topicValue, surfaceValue);
  if (requiredAnyPermission.length < 1) {
    return true;
  }

  const permissionSet = new Set(
    (Array.isArray(permissions) ? permissions : []).map((permission) => normalizePermission(permission)).filter(Boolean)
  );
  if (permissionSet.has("*")) {
    return true;
  }

  return requiredAnyPermission.some((permission) => permissionSet.has(normalizePermission(permission)));
}

export {
  TOPIC_SCOPES,
  normalizeTopicScope,
  createTopicCatalog,
  listTopics,
  getTopicRule,
  resolveTopicScope,
  isWorkspaceScopedTopic,
  isUserScopedTopic,
  isSupportedTopic,
  isTopicAllowedForSurface,
  listTopicsForSurface,
  resolveRequiredPermissions,
  hasTopicPermission
};
