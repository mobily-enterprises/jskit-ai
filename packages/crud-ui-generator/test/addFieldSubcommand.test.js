import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runGeneratorSubcommand } from "../src/server/subcommands/addField.js";

const JSON_REST_SCHEMA_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../../node_modules/json-rest-schema/package.json", import.meta.url))
);
const KERNEL_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../kernel/package.json", import.meta.url))
);
const RESOURCE_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../resource-core/package.json", import.meta.url))
);
const RESOURCE_CRUD_CORE_PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL("../../resource-crud-core/package.json", import.meta.url))
);

const RESOURCE_SOURCE = `import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "contacts",
  tableName: "contacts",
  schema: {
    firstName: {
      type: "string",
      required: true,
      maxLength: 120,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    },
    vetId: {
      type: "integer",
      nullable: true,
      relation: {
        kind: "lookup",
        apiPath: "/vets",
        valueKey: "id",
        labelKey: "name"
      },
      ui: {
        formControl: "autocomplete"
      },
      operations: {
        output: { required: false },
        create: { required: false },
        patch: { required: false }
      }
    }
  },
  crudOperations: ["list", "view", "create", "patch"]
});

export { resource };
`;

async function linkTestPackage(appRoot, packageName, packageDir) {
  const nodeModulesDir = path.join(appRoot, "node_modules");
  const targetPath = path.join(nodeModulesDir, packageName);
  await mkdir(nodeModulesDir, { recursive: true });
  await mkdir(path.dirname(targetPath), { recursive: true });
  await symlink(packageDir, targetPath, "dir");
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-ui-field-"));
  try {
    await linkTestPackage(appRoot, "json-rest-schema", JSON_REST_SCHEMA_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/kernel", KERNEL_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/resource-core", RESOURCE_CORE_PACKAGE_DIR);
    await linkTestPackage(appRoot, "@jskit-ai/resource-crud-core", RESOURCE_CRUD_CORE_PACKAGE_DIR);
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeAppFile(appRoot, relativePath, source) {
  const absolutePath = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
  return absolutePath;
}

test("field patches edit screen using resource metadata and anchors", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    const editFile = "src/pages/admin/crm/contacts/[recordId]/edit.vue";

    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);
    await writeAppFile(
      appRoot,
      editFile,
      `<template>
  <v-row>
    <!-- jskit:crud-ui-fields:edit -->
  </v-row>
</template>
<script setup>
import { resource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
const UI_EDIT_FORM_FIELDS = [
  { key: "firstName", component: "text" },
  // jskit:crud-ui-form-fields:edit
];
</script>
`
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "edit", editFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [editFile]);
    const editSource = await readFile(path.join(appRoot, editFile), "utf8");
    assert.match(
      editSource,
      /<v-autocomplete[\s\S]*fieldLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)/
    );
    assert.match(editSource, /:items="fieldLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)"/);
    assert.match(
      editSource,
      /\n {12}:items="fieldLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)"\n {12}:search="fieldLookupSearch\('vetId'\)"\n {12}@update:search="setFieldLookupSearch\('vetId', \$event\)"\n {12}item-title="label"\n {12}item-value="value"\n {12}no-filter/
    );
    assert.match(editSource, /:search="fieldLookupSearch\('vetId'\)"/);
    assert.match(editSource, /@update:search="setFieldLookupSearch\('vetId', \$event\)"/);
    assert.match(editSource, /:loading="fieldLookupLoading\('vetId'\)"/);
    assert.doesNotMatch(editSource, /UI_EDIT_FORM_FIELDS\.push/);
    assert.match(editSource, /const UI_EDIT_FORM_FIELDS = \[[\s\S]*key: "vetId"[\s\S]*\/\/ jskit:crud-ui-form-fields:edit/);

    const second = await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "edit", editFile],
      options: {}
    });
    assert.deepEqual(second.touchedFiles, []);
  });
});

test("field patches generated shared add/edit component targets from wrapper page", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    const editFile = "src/pages/admin/crm/contacts/[recordId]/edit.vue";
    const addEditFormFile = "src/pages/admin/crm/contacts/_components/ContactAddEditForm.vue";
    const addEditFieldsFile = "src/pages/admin/crm/contacts/_components/ContactAddEditFormFields.js";

    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);
    await writeAppFile(
      appRoot,
      editFile,
      `<template>
  <ContactAddEditForm />
</template>
<script setup>
import { resource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
// jskit:crud-ui-fields-target ../_components/ContactAddEditForm.vue
// jskit:crud-ui-form-fields-target ../_components/ContactAddEditFormFields.js
</script>
`
    );
    await writeAppFile(
      appRoot,
      addEditFormFile,
      `<template>
  <v-row>
    <!-- jskit:crud-ui-fields:edit -->
  </v-row>
</template>
`
    );
    await writeAppFile(
      appRoot,
      addEditFieldsFile,
      `const UI_EDIT_FORM_FIELDS = [
  { key: "firstName", component: "text" },
  // jskit:crud-ui-form-fields:edit
];
`
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "edit", editFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [addEditFormFile, addEditFieldsFile]);

    const addEditFormSource = await readFile(path.join(appRoot, addEditFormFile), "utf8");
    assert.match(
      addEditFormSource,
      /<v-autocomplete[\s\S]*fieldLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)/
    );

    const addEditFieldsSource = await readFile(path.join(appRoot, addEditFieldsFile), "utf8");
    assert.doesNotMatch(addEditFieldsSource, /UI_EDIT_FORM_FIELDS\.push/);
    assert.match(addEditFieldsSource, /const UI_EDIT_FORM_FIELDS = \[[\s\S]*key: "vetId"[\s\S]*\/\/ jskit:crud-ui-form-fields:edit/);
  });
});

test("field patches both shared add/edit branches when markup snippets are identical", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    const newFile = "src/pages/admin/crm/contacts/new.vue";
    const editFile = "src/pages/admin/crm/contacts/[recordId]/edit.vue";
    const addEditFormFile = "src/pages/admin/crm/contacts/_components/ContactAddEditForm.vue";
    const addEditFieldsFile = "src/pages/admin/crm/contacts/_components/ContactAddEditFormFields.js";

    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);
    await writeAppFile(
      appRoot,
      newFile,
      `<template>
  <ContactAddEditForm />
</template>
<script setup>
import { resource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
// jskit:crud-ui-fields-target ./_components/ContactAddEditForm.vue
// jskit:crud-ui-form-fields-target ./_components/ContactAddEditFormFields.js
</script>
`
    );
    await writeAppFile(
      appRoot,
      editFile,
      `<template>
  <ContactAddEditForm />
</template>
<script setup>
import { resource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
// jskit:crud-ui-fields-target ../_components/ContactAddEditForm.vue
// jskit:crud-ui-form-fields-target ../_components/ContactAddEditFormFields.js
</script>
`
    );
    await writeAppFile(
      appRoot,
      addEditFormFile,
      `<template>
  <v-row>
    <template v-if="mode === 'new'">
      <!-- jskit:crud-ui-fields:new -->
    </template>
    <template v-else>
      <!-- jskit:crud-ui-fields:edit -->
    </template>
  </v-row>
</template>
`
    );
    await writeAppFile(
      appRoot,
      addEditFieldsFile,
      `const UI_CREATE_FORM_FIELDS = [
  // jskit:crud-ui-form-fields:new
];
const UI_EDIT_FORM_FIELDS = [
  // jskit:crud-ui-form-fields:edit
];
`
    );

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "new", newFile],
      options: {}
    });
    await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "edit", editFile],
      options: {}
    });

    const addEditFormSource = await readFile(path.join(appRoot, addEditFormFile), "utf8");
    assert.equal((addEditFormSource.match(/fieldLookupItems\('vetId'/g) || []).length, 2);

    const addEditFieldsSource = await readFile(path.join(appRoot, addEditFieldsFile), "utf8");
    assert.doesNotMatch(addEditFieldsSource, /UI_CREATE_FORM_FIELDS\.push/);
    assert.doesNotMatch(addEditFieldsSource, /UI_EDIT_FORM_FIELDS\.push/);
    assert.match(addEditFieldsSource, /const UI_CREATE_FORM_FIELDS = \[[\s\S]*key: "vetId"[\s\S]*\/\/ jskit:crud-ui-form-fields:new/);
    assert.match(addEditFieldsSource, /const UI_EDIT_FORM_FIELDS = \[[\s\S]*key: "vetId"[\s\S]*\/\/ jskit:crud-ui-form-fields:edit/);
  });
});

test("field rejects legacy form-field marker layouts instead of adding new push calls", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    const editFile = "src/pages/admin/crm/contacts/[recordId]/edit.vue";

    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);
    await writeAppFile(
      appRoot,
      editFile,
      `<template>
  <v-row>
    <!-- jskit:crud-ui-fields:edit -->
  </v-row>
</template>
<script setup>
import { resource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
const UI_EDIT_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:edit
UI_EDIT_FORM_FIELDS.push({ key: "firstName", component: "text" });
</script>
`
    );

    await assert.rejects(
      () => runGeneratorSubcommand({
        appRoot,
        subcommand: "field",
        args: ["vetId", "edit", editFile],
        options: {}
      }),
      /Run `jskit app migrate-source-mutations` before adding more generated form fields/
    );

    const editSource = await readFile(path.join(appRoot, editFile), "utf8");
    assert.match(editSource, /UI_EDIT_FORM_FIELDS\.push/);
    assert.doesNotMatch(editSource, /key: "vetId"/);
  });
});

test("field patches list screen when resource-file is passed explicitly", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    const listFile = "src/pages/admin/crm/contacts/index.vue";

    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);
    await writeAppFile(
      appRoot,
      listFile,
      `<template>
  <table>
    <thead>
      <tr>
        <!-- jskit:crud-ui-fields:list-header -->
      </tr>
    </thead>
    <tbody>
      <tr>
        <!-- jskit:crud-ui-fields:list-row -->
      </tr>
    </tbody>
  </table>
</template>
`
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "field",
      args: ["vetId", "list", listFile],
      options: {
        "resource-file": resourceFile,
      }
    });

    assert.deepEqual(result.touchedFiles, [listFile]);
    const listSource = await readFile(path.join(appRoot, listFile), "utf8");
    assert.match(listSource, /<th>Vet<\/th>/);
    assert.match(
      listSource,
      /records\.resolveFieldDisplay\(record, \{ key: "vetId", relation: \{ kind: "lookup", valueKey: "id", labelKey: "name", containerKey: "lookups" \} \}\)/
    );
  });
});
