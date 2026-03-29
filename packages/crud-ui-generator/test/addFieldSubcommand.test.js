import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/addField.js";

const RESOURCE_SOURCE = `const contactRecordSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    firstName: { type: "string" },
    vetId: { type: ["integer", "null"] }
  },
  additionalProperties: false
};

const contactBodySchema = {
  type: "object",
  properties: {
    firstName: { type: "string", maxLength: 120 },
    vetId: { type: ["integer", "null"] }
  },
  additionalProperties: false
};

const CONTACT_FIELD_META = [];

const contactResource = {
  operations: {
    list: {
      outputValidator: {
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: contactRecordSchema
            }
          },
          additionalProperties: false
        }
      }
    },
    view: {
      outputValidator: {
        schema: contactRecordSchema
      }
    },
    create: {
      bodyValidator: {
        schema: contactBodySchema
      },
      outputValidator: {
        schema: contactRecordSchema
      }
    },
    patch: {
      bodyValidator: {
        schema: contactBodySchema
      },
      outputValidator: {
        schema: contactRecordSchema
      }
    }
  },
  fieldMeta: CONTACT_FIELD_META
};

CONTACT_FIELD_META.push({
  key: "vetId",
  relation: {
    kind: "lookup",
    apiPath: "/vets",
    valueKey: "id",
    labelKey: "name"
  }
});

export { contactResource };
`;

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-ui-add-field-"));
  try {
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

test("add-field patches edit screen using resource metadata and anchors", async () => {
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
import { contactResource as uiResource } from "/packages/contacts/src/shared/contactResource.js";
const UI_EDIT_FORM_FIELDS = [];
// jskit:crud-ui-form-fields:edit
UI_EDIT_FORM_FIELDS.push({ key: "firstName", component: "text" });
</script>
`
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-field",
      args: ["vetId", "edit", editFile],
      options: {}
    });

    assert.deepEqual(result.touchedFiles, [editFile]);
    const editSource = await readFile(path.join(appRoot, editFile), "utf8");
    assert.match(
      editSource,
      /<v-autocomplete[\s\S]*resolveLookupItems\("vetId", \{ selectedValue: formRuntime\.form\.vetId, selectedRecord: formRuntime\.addEdit\.resource\.data \}\)/
    );
    assert.match(editSource, /:items='resolveLookupItems\("vetId", \{ selectedValue: formRuntime\.form\.vetId, selectedRecord: formRuntime\.addEdit\.resource\.data \}\)'/);
    assert.match(editSource, /:search='resolveLookupSearch\("vetId"\)'/);
    assert.match(editSource, /@update:search='setLookupSearch\("vetId", \$event\)'/);
    assert.match(editSource, /:loading='resolveLookupLoading\("vetId"\)'/);
    assert.match(editSource, /UI_EDIT_FORM_FIELDS\.push\(\{[\s\S]*"key": "vetId"/);

    const second = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-field",
      args: ["vetId", "edit", editFile],
      options: {}
    });
    assert.deepEqual(second.touchedFiles, []);
  });
});

test("add-field patches list screen when resource-file is passed explicitly", async () => {
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
      subcommand: "add-field",
      args: ["vetId", "list", listFile],
      options: {
        "resource-file": resourceFile,
        "resource-export": "contactResource"
      }
    });

    assert.deepEqual(result.touchedFiles, [listFile]);
    const listSource = await readFile(path.join(appRoot, listFile), "utf8");
    assert.match(listSource, /<th>Vet Id<\/th>/);
    assert.match(
      listSource,
      /records\.resolveFieldDisplay\(record, \{ key: "vetId", relation: \{ kind: "lookup", valueKey: "id", labelKey: "name", containerKey: "lookups" \} \}\)/
    );
  });
});
