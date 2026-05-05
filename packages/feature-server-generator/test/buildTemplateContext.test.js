import assert from "node:assert/strict";
import test from "node:test";
import { buildTemplateContext } from "../src/server/buildTemplateContext.js";

test("buildTemplateContext emits json-rest provider and descriptor wiring", async () => {
  const context = await buildTemplateContext({
    options: {
      "feature-name": "Booking Engine",
      mode: "json-rest"
    }
  });

  assert.equal(context.__JSKIT_FEATURE_PROVIDER_DEPENDS_ON__, '"runtime.actions", "json-rest-api.core"');
  assert.match(context.__JSKIT_FEATURE_PROVIDER_REPOSITORY_IMPORT__, /INTERNAL_JSON_REST_API/);
  assert.match(context.__JSKIT_FEATURE_PROVIDER_REPOSITORY_REGISTRATION__, /feature\.booking-engine\.repository/);
  assert.equal(
    context.__JSKIT_FEATURE_PROVIDER_SERVICE_FACTORY_ARG__,
    '{ featureRepository: _scope.make("feature.booking-engine.repository") }'
  );
  assert.equal(context.__JSKIT_FEATURE_PROVIDER_BOOT_METHOD__, "  boot() {}");
  assert.match(context.__JSKIT_FEATURE_DESCRIPTOR_DEPENDS_ON_LINES__, /@jskit-ai\/json-rest-api-core/);
  assert.equal(context.__JSKIT_FEATURE_DESCRIPTOR_CAPABILITY_REQUIRES_LINES__, "");
  assert.equal(context.__JSKIT_FEATURE_DESCRIPTOR_LANE__, "default");
});

test("buildTemplateContext emits orchestrator service placeholders and enabled-surface actions", async () => {
  const context = await buildTemplateContext({
    options: {
      "feature-name": "Availability Engine",
      mode: "orchestrator"
    }
  });

  assert.equal(context.__JSKIT_FEATURE_PROVIDER_DEPENDS_ON__, '"runtime.actions"');
  assert.equal(context.__JSKIT_FEATURE_PROVIDER_REPOSITORY_IMPORT__, "");
  assert.equal(context.__JSKIT_FEATURE_PROVIDER_REPOSITORY_REGISTRATION__, "");
  assert.equal(context.__JSKIT_FEATURE_PROVIDER_SERVICE_FACTORY_ARG__, "{}");
  assert.equal(context.__JSKIT_FEATURE_ACTION_SURFACES_LINE__, '    surfacesFrom: "enabled",');
  assert.match(context.__JSKIT_FEATURE_SERVICE_GET_STATUS_BODY__, /orchestration logic/);
  assert.equal(context.__JSKIT_FEATURE_DESCRIPTOR_REPOSITORY_TOKEN_LINE__, "");
});

test("buildTemplateContext emits custom-knex route wiring and weird-custom lane metadata", async () => {
  const context = await buildTemplateContext({
    options: {
      "feature-name": "Invoice Rollup",
      mode: "custom-knex",
      surface: "ADMIN",
      "route-prefix": "Admin/Invoice Rollup"
    }
  });

  assert.equal(context.__JSKIT_FEATURE_PROVIDER_DEPENDS_ON__, '"runtime.actions", "runtime.database"');
  assert.match(context.__JSKIT_FEATURE_PROVIDER_REPOSITORY_IMPORT__, /createRepository/);
  assert.match(context.__JSKIT_FEATURE_PROVIDER_BOOT_METHOD__, /routeRelativePath: "admin\/invoice-rollup"/);
  assert.match(context.__JSKIT_FEATURE_PROVIDER_BOOT_METHOD__, /routeSurface: "admin"/);
  assert.equal(context.__JSKIT_FEATURE_ACTION_SURFACES_LINE__, '    surfaces: ["admin"],');
  assert.equal(context.__JSKIT_FEATURE_ROUTE_SURFACE_IMPORT__, ", normalizeSurfaceId");
  assert.equal(context.__JSKIT_FEATURE_ROUTE_SURFACE_LINE__, "      surface: normalizedRouteSurface,");
  assert.equal(context.__JSKIT_FEATURE_DESCRIPTOR_LANE__, "weird-custom");
  assert.equal(context.__JSKIT_FEATURE_DESCRIPTOR_CAPABILITY_REQUIRES_LINES__, "");
});
