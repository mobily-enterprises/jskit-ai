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

const RESOURCE_SOURCE = `import { createSchema } from "json-rest-schema";

const contactRecordSchema = createSchema({
  id: { type: "integer", required: true },
  firstName: { type: "string", required: true },
  vetId: {
    type: "integer",
    nullable: true,
    relation: {
      kind: "lookup",
      apiPath: "/vets",
      valueKey: "id",
      labelKey: "name"
    }
  }
});

const contactBodySchema = createSchema({
  firstName: { type: "string", maxLength: 120 },
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
    }
  }
});

const contactListSchema = createSchema({
  items: {
    type: "array",
    required: true,
    items: contactRecordSchema
  }
});

const resource = {
  operations: {
    list: {
      output: {
        schema: contactListSchema,
        mode: "replace"
      }
    },
    view: {
      output: {
        schema: contactRecordSchema,
        mode: "replace"
      }
    },
    create: {
      body: {
        schema: contactBodySchema,
        mode: "create"
      },
      output: {
        schema: contactRecordSchema,
        mode: "replace"
      }
    },
    patch: {
      body: {
        schema: contactBodySchema,
        mode: "patch"
      },
      output: {
        schema: contactRecordSchema,
        mode: "replace"
      }
    }
  }
};

export { resource };
`;

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-ui-field-"));
  try {
    await mkdir(path.join(appRoot, "node_modules"), { recursive: true });
    await symlink(
      JSON_REST_SCHEMA_PACKAGE_DIR,
      path.join(appRoot, "node_modules", "json-rest-schema"),
      "dir"
    );
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
const UI_EDIT_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:edit
UI_EDIT_FORM_FIELDS.push({ key: "firstName", component: "text" });
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
      /<v-autocomplete[\s\S]*resolveLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)/
    );
    assert.match(editSource, /:items="resolveLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)"/);
    assert.match(
      editSource,
      /\n {18}:items="resolveLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)"\n {18}:search="resolveLookupSearch\('vetId'\)"\n {18}@update:search="setLookupSearch\('vetId', \$event\)"\n {18}item-title="label"\n {18}item-value="value"\n {18}no-filter/
    );
    assert.match(editSource, /:search="resolveLookupSearch\('vetId'\)"/);
    assert.match(editSource, /@update:search="setLookupSearch\('vetId', \$event\)"/);
    assert.match(editSource, /:loading="resolveLookupLoading\('vetId'\)"/);
    assert.match(editSource, /UI_EDIT_FORM_FIELDS\.push\(\{[\s\S]*"key": "vetId"/);

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
      `const UI_EDIT_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:edit
UI_EDIT_FORM_FIELDS.push({ key: "firstName", component: "text" });
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
      /<v-autocomplete[\s\S]*resolveLookupItems\('vetId', \{ selectedValue: formState\.vetId, selectedRecord: addEdit\.resource\.data \}\)/
    );

    const addEditFieldsSource = await readFile(path.join(appRoot, addEditFieldsFile), "utf8");
    assert.match(addEditFieldsSource, /UI_EDIT_FORM_FIELDS\.push\(\{[\s\S]*"key": "vetId"/);
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
      `const UI_CREATE_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:new
const UI_EDIT_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:edit
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
    assert.equal((addEditFormSource.match(/resolveLookupItems\('vetId'/g) || []).length, 2);

    const addEditFieldsSource = await readFile(path.join(appRoot, addEditFieldsFile), "utf8");
    assert.match(addEditFieldsSource, /UI_CREATE_FORM_FIELDS\.push\(\{[\s\S]*"key": "vetId"/);
    assert.match(addEditFieldsSource, /UI_EDIT_FORM_FIELDS\.push\(\{[\s\S]*"key": "vetId"/);
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
