import { MODULE_ENABLEMENT_MODES } from "./descriptor.js";
import { normalizeMode } from "./compositionMode.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";

function normalizeString(value) {
  return String(value || "").trim();
}

function assertUniqueModuleIds(modules = [], { mode = MODULE_ENABLEMENT_MODES.strict, diagnostics } = {}) {
  const normalizedMode = normalizeMode(mode);
  const collector = diagnostics || createDiagnosticsCollector();
  const seen = new Set();

  for (const module of modules) {
    const id = normalizeString(module?.id);
    if (!id) {
      addDiagnosticForMode(collector, normalizedMode, {
        code: "MODULE_ID_MISSING",
        message: "Module id is required for conflict validation."
      });
      continue;
    }

    if (seen.has(id)) {
      addDiagnosticForMode(collector, normalizedMode, {
        code: "MODULE_ID_CONFLICT",
        moduleId: id,
        message: `Duplicate module id \"${id}\" detected.`
      });
    }

    seen.add(id);
  }

  if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
    throwOnDiagnosticErrors(collector, "Module id conflict validation failed.");
  }

  return {
    diagnostics: collector
  };
}

function buildConflictReport(items, { keySelector, missingCode, conflictCode }) {
  const seenByKey = new Map();
  const conflicts = [];
  const uniqueItems = [];

  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeString(keySelector(item));
    if (!key) {
      conflicts.push({
        code: missingCode,
        item
      });
      continue;
    }

    if (!seenByKey.has(key)) {
      seenByKey.set(key, item);
      uniqueItems.push(item);
      continue;
    }

    conflicts.push({
      code: conflictCode,
      key,
      winner: seenByKey.get(key),
      contender: item
    });
  }

  return {
    uniqueItems,
    conflicts
  };
}

function detectRouteConflicts(routes = []) {
  return buildConflictReport(routes, {
    keySelector: (route) => `${normalizeString(route?.method).toUpperCase()} ${normalizeString(route?.path)}`,
    missingCode: "ROUTE_KEY_MISSING",
    conflictCode: "ROUTE_CONFLICT"
  });
}

function detectActionConflicts(actions = []) {
  return buildConflictReport(actions, {
    keySelector: (action) => normalizeString(action?.id),
    missingCode: "ACTION_ID_MISSING",
    conflictCode: "ACTION_CONFLICT"
  });
}

function detectTopicConflicts(topics = []) {
  return buildConflictReport(topics, {
    keySelector: (topic) => normalizeString(topic?.topic || topic?.id),
    missingCode: "TOPIC_ID_MISSING",
    conflictCode: "TOPIC_CONFLICT"
  });
}

function resolveConflicts({
  modules = [],
  routes = [],
  actions = [],
  topics = [],
  mode = MODULE_ENABLEMENT_MODES.strict,
  diagnostics
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const collector = diagnostics || createDiagnosticsCollector();

  assertUniqueModuleIds(modules, {
    mode: normalizedMode,
    diagnostics: collector
  });

  const routeReport = detectRouteConflicts(routes);
  const actionReport = detectActionConflicts(actions);
  const topicReport = detectTopicConflicts(topics);

  const allConflicts = [...routeReport.conflicts, ...actionReport.conflicts, ...topicReport.conflicts];

  for (const conflict of allConflicts) {
    const level = normalizedMode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn";
    collector.add({
      code: conflict.code,
      moduleId: conflict.contender?.moduleId,
      message: conflict.key
        ? `Conflict detected for key \"${conflict.key}\".`
        : `Conflict detected for ${conflict.code}.`,
      details: conflict,
      level
    });
  }

  throwOnDiagnosticErrors(collector, "Conflict validation failed.");

  return {
    mode: normalizedMode,
    routes: routeReport.uniqueItems,
    actions: actionReport.uniqueItems,
    topics: topicReport.uniqueItems,
    diagnostics: collector
  };
}

const __testables = {
  normalizeMode,
  buildConflictReport
};

export {
  resolveConflicts,
  detectRouteConflicts,
  detectActionConflicts,
  detectTopicConflicts,
  assertUniqueModuleIds,
  __testables
};
