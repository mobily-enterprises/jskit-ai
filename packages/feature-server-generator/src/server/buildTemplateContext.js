function splitTextIntoWords(value) {
  const normalized = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/u)
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
}

function wordsToPascal(words = []) {
  return words
    .map((entry) => {
      const value = String(entry || "").trim().toLowerCase();
      if (!value) {
        return "";
      }
      return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
    })
    .join("");
}

function wordsToKebab(words = []) {
  return words
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .join("-");
}

function wordsToCamel(words = []) {
  const pascal = wordsToPascal(words);
  if (!pascal) {
    return "";
  }
  return `${pascal.slice(0, 1).toLowerCase()}${pascal.slice(1)}`;
}

function normalizeFeatureName(value) {
  const normalized = wordsToKebab(splitTextIntoWords(value));
  if (!normalized) {
    throw new Error("feature-server-generator requires option feature-name.");
  }
  return normalized;
}

function normalizeSurfaceId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoutePrefix(value) {
  return String(value || "")
    .split("/")
    .map((segment) => {
      const normalizedSegment = String(segment || "").trim();
      if (!normalizedSegment) {
        return "";
      }
      if (normalizedSegment.startsWith(":")) {
        return normalizedSegment;
      }
      return wordsToKebab(splitTextIntoWords(normalizedSegment));
    })
    .filter(Boolean)
    .join("/");
}

function quoteArray(values = []) {
  return values.map((entry) => JSON.stringify(String(entry || ""))).join(", ");
}

function buildProviderContext({ featureName, mode, routePrefix, surface }) {
  const featureToken = `feature.${featureName}`;
  const isJsonRest = mode === "json-rest";
  const isCustomKnex = mode === "custom-knex";
  const hasRoutes = Boolean(routePrefix);

  const dependsOn = ["runtime.actions"];
  if (isJsonRest) {
    dependsOn.push("json-rest-api.core");
  }
  if (isCustomKnex) {
    dependsOn.push("runtime.database");
  }

  let repositoryImport = "";
  let repositoryRegistration = "";
  let serviceFactoryArg = "{}";
  if (isJsonRest) {
    repositoryImport = [
      'import { INTERNAL_JSON_REST_API } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";',
      'import { createRepository } from "./repository.js";'
    ].join("\n");
    repositoryRegistration = [
      `    app.singleton("${featureToken}.repository", (scope) => {`,
      "      return createRepository({",
      "        api: scope.make(INTERNAL_JSON_REST_API)",
      "      });",
      "    });",
      ""
    ].join("\n");
    serviceFactoryArg = `{ featureRepository: _scope.make("${featureToken}.repository") }`;
  } else if (isCustomKnex) {
    repositoryImport = 'import { createRepository } from "./repository.js";';
    repositoryRegistration = [
      `    app.singleton("${featureToken}.repository", (scope) => {`,
      "      return createRepository({",
      '        knex: scope.make("jskit.database.knex")',
      "      });",
      "    });",
      ""
    ].join("\n");
    serviceFactoryArg = `{ featureRepository: _scope.make("${featureToken}.repository") }`;
  }

  let routeImport = "";
  let bootMethod = "  boot() {}";
  if (hasRoutes) {
    const routeLines = [
      "  boot(app) {",
      "    registerRoutes(app, {",
      `      routeRelativePath: ${JSON.stringify(routePrefix)},`
    ];
    if (surface) {
      routeLines.push(`      routeSurface: ${JSON.stringify(surface)}`);
    }
    routeLines.push("    });");
    routeLines.push("  }");
    routeImport = 'import { registerRoutes } from "./registerRoutes.js";';
    bootMethod = routeLines.join("\n");
  }

  return Object.freeze({
    "__JSKIT_FEATURE_PROVIDER_DEPENDS_ON__": quoteArray(dependsOn),
    "__JSKIT_FEATURE_PROVIDER_REPOSITORY_IMPORT__": repositoryImport,
    "__JSKIT_FEATURE_PROVIDER_ROUTE_IMPORT__": routeImport,
    "__JSKIT_FEATURE_PROVIDER_REPOSITORY_REGISTRATION__": repositoryRegistration,
    "__JSKIT_FEATURE_PROVIDER_SERVICE_FACTORY_ARG__": serviceFactoryArg,
    "__JSKIT_FEATURE_PROVIDER_BOOT_METHOD__": bootMethod
  });
}

function buildActionsContext({ surface }) {
  const surfacesLine = surface
    ? `    surfaces: [${JSON.stringify(surface)}],`
    : '    surfacesFrom: "enabled",';

  return Object.freeze({
    "__JSKIT_FEATURE_ACTION_SURFACES_LINE__": surfacesLine
  });
}

function buildServiceContext({ featureName, mode }) {
  const featureToken = `feature.${featureName}`;
  const isPersistent = mode === "json-rest" || mode === "custom-knex";
  if (!isPersistent) {
    return Object.freeze({
      "__JSKIT_FEATURE_SERVICE_REPOSITORY_GUARD__": "  void featureRepository;",
      "__JSKIT_FEATURE_SERVICE_GET_STATUS_BODY__": [
        "      void options;",
        "      return {",
        `        ok: true,`,
        `        feature: ${JSON.stringify(featureName)},`,
        `        mode: ${JSON.stringify(mode)},`,
        "        customized: false,",
        "        input,",
        '        message: "Replace createService().getStatus() with feature-specific orchestration logic."',
        "      };"
      ].join("\n"),
      "__JSKIT_FEATURE_SERVICE_EXECUTE_BODY__": [
        "      void options;",
        "      return {",
        "        accepted: false,",
        `        feature: ${JSON.stringify(featureName)},`,
        `        mode: ${JSON.stringify(mode)},`,
        "        customized: false,",
        "        input,",
        '        message: "Replace createService().execute() with feature-specific orchestration logic."',
        "      };"
      ].join("\n")
    });
  }

  return Object.freeze({
    "__JSKIT_FEATURE_SERVICE_REPOSITORY_GUARD__": [
      "  if (!featureRepository) {",
      `    throw new TypeError("createService requires ${featureToken}.repository.");`,
      "  }"
    ].join("\n"),
    "__JSKIT_FEATURE_SERVICE_GET_STATUS_BODY__": [
      "      return featureRepository.getStatus(input, {",
      "        context: options?.context || null",
      "      });"
    ].join("\n"),
    "__JSKIT_FEATURE_SERVICE_EXECUTE_BODY__": [
      "      return featureRepository.execute(input, {",
      "        context: options?.context || null,",
      "        trx: options?.trx || null",
      "      });"
    ].join("\n")
  });
}

function buildRouteContext({ surface }) {
  const routeSurfaceImport = surface ? ", normalizeSurfaceId" : "";
  const routeSurfaceNormalizerLine = surface
    ? "  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);"
    : "  void routeSurface;";
  const routeSurfaceLine = surface ? "      surface: normalizedRouteSurface," : "";

  return Object.freeze({
    "__JSKIT_FEATURE_ROUTE_SURFACE_IMPORT__": routeSurfaceImport,
    "__JSKIT_FEATURE_ROUTE_SURFACE_NORMALIZER_LINE__": routeSurfaceNormalizerLine,
    "__JSKIT_FEATURE_ROUTE_SURFACE_LINE__": routeSurfaceLine
  });
}

function buildDescriptorContext({ featureName, mode }) {
  const isJsonRest = mode === "json-rest";
  const isCustomKnex = mode === "custom-knex";
  const isPersistent = isJsonRest || isCustomKnex;
  const dependsOnLines = [];
  if (isJsonRest) {
    dependsOnLines.push('    "@jskit-ai/json-rest-api-core"');
  }
  if (isCustomKnex) {
    dependsOnLines.push('    "@jskit-ai/database-runtime"');
  }

  const descriptorDependsOnLines = dependsOnLines.length > 0
    ? `,\n${dependsOnLines.join(",\n")}`
    : "";
  const descriptorRepositoryTokenLine = isPersistent ? `,\n          "feature.${featureName}.repository"` : "";
  const lane = isCustomKnex ? "weird-custom" : "default";

  return Object.freeze({
    "__JSKIT_FEATURE_DESCRIPTOR_DEPENDS_ON_LINES__": descriptorDependsOnLines,
    "__JSKIT_FEATURE_DESCRIPTOR_CAPABILITY_REQUIRES_LINES__": "",
    "__JSKIT_FEATURE_DESCRIPTOR_REPOSITORY_TOKEN_LINE__": descriptorRepositoryTokenLine,
    "__JSKIT_FEATURE_DESCRIPTOR_LANE__": lane
  });
}

async function buildTemplateContext({ options = {} } = {}) {
  const featureName = normalizeFeatureName(options["feature-name"]);
  const mode = String(options.mode || "json-rest").trim() || "json-rest";
  const routePrefix = normalizeRoutePrefix(options["route-prefix"]);
  const surface = normalizeSurfaceId(options.surface);
  const context = {
    "__JSKIT_FEATURE_NAME_KEBAB__": featureName,
    "__JSKIT_FEATURE_NAME_PASCAL__": wordsToPascal(splitTextIntoWords(featureName)),
    "__JSKIT_FEATURE_NAME_CAMEL__": wordsToCamel(splitTextIntoWords(featureName))
  };

  return Object.freeze({
    ...context,
    ...buildProviderContext({
      featureName,
      mode,
      routePrefix,
      surface
    }),
    ...buildActionsContext({ surface }),
    ...buildServiceContext({ featureName, mode }),
    ...buildRouteContext({ surface }),
    ...buildDescriptorContext({ featureName, mode })
  });
}

export { buildTemplateContext };
