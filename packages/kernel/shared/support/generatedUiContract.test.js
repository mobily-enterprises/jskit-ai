import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_UI_NAVIGATION_ROLE_OPTION,
  GENERATED_UI_NAVIGATION_ROLE_VALUES,
  GENERATED_UI_SURFACE_PROFILES,
  assertGeneratedUiSourceContract,
  buildGeneratedUiScreenClassName,
  collectGeneratedUiSourceContractIssues,
  inferGeneratedUiNavigationRole,
  isGeneratedUiNoLinkNavigationRole,
  normalizeGeneratedUiNavigationRole,
  resolveGeneratedUiSurfaceProfile,
  resolveGeneratedUiNavigationRoleLinkPlacement,
  shouldCreateGeneratedUiNavigationLink
} from "./generatedUiContract.js";

test("generated UI navigation role metadata is descriptor-ready", () => {
  assert.deepEqual(
    GENERATED_UI_NAVIGATION_ROLE_VALUES,
    ["primary", "secondary", "utility", "detail", "workflow", "none"]
  );
  assert.equal(GENERATED_UI_NAVIGATION_ROLE_OPTION.validationType, "enum");
  assert.deepEqual(GENERATED_UI_NAVIGATION_ROLE_OPTION.allowedValues, GENERATED_UI_NAVIGATION_ROLE_VALUES);
  assert.equal(GENERATED_UI_NAVIGATION_ROLE_OPTION.defaultValue, "primary");
});

test("generated UI surface profiles map app, operator, and settings density", () => {
  assert.deepEqual(Object.keys(GENERATED_UI_SURFACE_PROFILES), ["task", "operator", "settings"]);
  assert.equal(resolveGeneratedUiSurfaceProfile("").id, "task");
  assert.equal(resolveGeneratedUiSurfaceProfile("operator").id, "operator");
  assert.equal(resolveGeneratedUiSurfaceProfile("operator").density, "compact");
  assert.equal(resolveGeneratedUiSurfaceProfile("settings").id, "settings");
  assert.equal(
    buildGeneratedUiScreenClassName("generated-page-screen d-flex", {
      surfaceProfile: "operator"
    }),
    "generated-ui-screen generated-ui-screen--operator generated-page-screen d-flex"
  );
});

test("normalizeGeneratedUiNavigationRole defaults and validates roles", () => {
  assert.equal(normalizeGeneratedUiNavigationRole(""), "primary");
  assert.equal(normalizeGeneratedUiNavigationRole(" Secondary "), "secondary");
  assert.throws(
    () => normalizeGeneratedUiNavigationRole("drawer"),
    /navigation-role must be one of: primary, secondary, utility, detail, workflow, none/
  );
});

test("generated UI navigation roles resolve semantic link placements", () => {
  assert.equal(resolveGeneratedUiNavigationRoleLinkPlacement({}), "");
  assert.equal(resolveGeneratedUiNavigationRoleLinkPlacement({ "navigation-role": "secondary" }), "shell.secondary-nav");
  assert.equal(resolveGeneratedUiNavigationRoleLinkPlacement({ "navigation-role": "utility" }), "shell.global-actions");
  assert.equal(
    resolveGeneratedUiNavigationRoleLinkPlacement({
      "navigation-role": "secondary",
      "link-placement": "settings.sections"
    }),
    "settings.sections"
  );
});

test("generated UI navigation role inference keeps detail and workflow routes out of primary nav", () => {
  assert.equal(inferGeneratedUiNavigationRole({}, { routePath: "/reports" }), "primary");
  assert.equal(inferGeneratedUiNavigationRole({}, { routePath: "/reports/[reportId]" }), "detail");
  assert.equal(inferGeneratedUiNavigationRole({}, { routePath: "/reports/[reportId]/activity" }), "primary");
  assert.equal(
    inferGeneratedUiNavigationRole({}, {
      dynamicRoutePolicy: "any",
      routePath: "/reports/[reportId]/activity"
    }),
    "detail"
  );
  assert.equal(inferGeneratedUiNavigationRole({}, { routePath: "/reports/new" }), "workflow");
  assert.equal(
    inferGeneratedUiNavigationRole({ "navigation-role": "primary" }, { routePath: "/reports/[reportId]" }),
    "primary"
  );
  assert.equal(
    shouldCreateGeneratedUiNavigationLink({}, {
      allowLinkTo: true,
      routePath: "/reports/[reportId]"
    }),
    false
  );
  assert.equal(
    shouldCreateGeneratedUiNavigationLink({ "navigation-role": "primary" }, {
      allowLinkTo: true,
      routePath: "/reports/[reportId]"
    }),
    true
  );
  assert.equal(
    shouldCreateGeneratedUiNavigationLink({ "link-placement": "shell.secondary-nav" }, {
      allowLinkTo: true,
      routePath: "/reports/[reportId]"
    }),
    true
  );
});

test("generated UI no-link roles reject conflicting link options", () => {
  assert.equal(isGeneratedUiNoLinkNavigationRole("detail"), true);
  assert.equal(shouldCreateGeneratedUiNavigationLink({ "navigation-role": "workflow" }), false);
  assert.equal(shouldCreateGeneratedUiNavigationLink({ "navigation-role": "primary" }), true);
  assert.throws(
    () => shouldCreateGeneratedUiNavigationLink({
      "navigation-role": "detail",
      "link-placement": "shell.primary-nav"
    }),
    /navigation-role "detail" cannot be combined with --link-placement/
  );
  assert.throws(
    () => shouldCreateGeneratedUiNavigationLink({
      "navigation-role": "none",
      "link-to": "./details"
    }, {
      allowLinkTo: true
    }),
    /navigation-role "none" cannot be combined with --link-placement or --link-to/
  );
});

test("generated UI source contract flags placeholder copy and missing profile hooks", () => {
  const issues = collectGeneratedUiSourceContractIssues(
    `<template>
  <section>
    <v-card>Replace this content</v-card>
  </section>
</template>`,
    {
      profile: "page"
    }
  );

  assert.deepEqual(
    issues.map((issue) => issue.id),
    [
      "replace-this-copy",
      "vuetify-card-shell",
      "shared-screen-class",
      "page-screen-title",
      "page-empty-state-sheet",
      "page-responsive-title-type",
      "page-compact-rules"
    ]
  );
});

test("generated UI source contract accepts compact-first CRUD detail structure", () => {
  assert.doesNotThrow(() => assertGeneratedUiSourceContract(
    `<template>
  <section class="generated-ui-screen generated-ui-screen--operator">
    <header class="ui-generator-form-header"></header>
    <v-sheet class="ui-generator-form-panel">
      <v-row class="ui-generator-form-fields"></v-row>
    </v-sheet>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
}

.ui-generator-form-fields :deep(.v-col) {
  min-width: 0;
}

@media (max-width: 640px) {
  .ui-generator-form-actions :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>`,
    {
      profile: "crud-detail",
      sourceName: "NewElement.vue"
    }
  ));
});

test("generated UI source contract accepts compact-first CRUD list structure", () => {
  assert.doesNotThrow(() => assertGeneratedUiSourceContract(
    `<template>
  <section class="generated-ui-screen generated-ui-screen--operator">
    <div class="ui-generator-list-cards d-md-none">
      <v-menu>Actions</v-menu>
    </div>
    <div class="ui-generator-list-table d-none d-md-block"></div>
    <h2>__JSKIT_UI_LIST_EMPTY_TITLE__</h2>
    <h2>__JSKIT_UI_LIST_LOAD_ERROR_TITLE__</h2>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
}

.ui-generator-list-header__actions :deep(.v-btn) {
  min-height: 48px;
}
</style>`,
    {
      profile: "crud-list",
      sourceName: "ListElement.vue"
    }
  ));
});

test("generated UI responsive smoke profile requires compact medium expanded checks", () => {
  assert.throws(
    () => assertGeneratedUiSourceContract("const width = 390; const selector = 'generated-ui-screen';", {
      profile: "responsive-smoke",
      sourceName: "tests/e2e/example.spec.ts"
    }),
    /missing:medium-viewport/
  );
});
