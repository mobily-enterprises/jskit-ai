import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import { registerJskitMessages, setJskitI18n } from "@jskit-ai/kernel/client/i18n";
import { flattenCatalog } from "@jskit-ai/kernel/shared/i18n";
import en from "../locales/en.json" with { type: "json" };
import { toUiErrorMessage, toUiFieldErrors } from "../src/client/composables/support/errorMessageHelpers.js";
import {
  formatCrudListDateFilterChipLabel,
  formatDateOnlyDisplay
} from "../src/client/support/crudListDateFilterSupport.js";

// A server package's catalog, as the generated bootstrap registers it.
const SERVER_CATALOG = {
  jskit: {
    users: {
      username: {
        taken: "Username {username} is already taken."
      }
    }
  }
};
registerJskitMessages(SERVER_CATALOG);

// A test language with every http-web key and the server codes above translated.
function testLanguageMessages() {
  const messages = {};
  const flat = {
    ...flattenCatalog(en),
    ...flattenCatalog(SERVER_CATALOG),
    "jskit.errors.not_found": "Not found."
  };
  for (const [key, message] of Object.entries(flat)) {
    let target = messages;
    const segments = key.split(".");
    for (const segment of segments.slice(0, -1)) {
      target = target[segment] ||= {};
    }
    target[segments.at(-1)] = `[xx] ${message}`;
  }
  return messages;
}

async function withTestLanguage(run, locale = "xx") {
  setJskitI18n(createI18n({ legacy: false, locale, messages: { [locale]: testLanguageMessages() } }));
  try {
    return await run();
  } finally {
    setJskitI18n(null);
  }
}

async function importCrudListScreen() {
  const componentUrl = new URL("../src/client/components/CrudListScreen.vue", import.meta.url).href;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(".vue")) return nextLoad(url, context);
      if (url !== componentUrl) {
        return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
      }
      const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
      return {
        format: "module", shortCircuit: true,
        source: compileScript(descriptor, { id: "crud-list-translation", inlineTemplate: true }).content
      };
    }
  });
  try {
    return (await import(componentUrl)).default;
  } finally {
    hooks.deregister();
  }
}

async function renderCrudListScreen(props) {
  const CrudListScreen = await importCrudListScreen();
  const app = createSSRApp({ render: () => h(CrudListScreen, props) });
  const router = createRouter({
    history: createMemoryHistory(), routes: [{ path: "/books", component: { render: () => null } }]
  });
  await router.push("/books");
  app.use(router);
  for (const name of ["VBtn", "VSheet", "VTable", "VTextField", "VSkeletonLoader", "VCheckboxBtn"]) {
    app.component(name, defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) }));
  }
  return renderToString(app);
}

test("API errors render through their code only when the server sent JSKIT's English", async () => {
  const coded = { status: 409, message: "Username ada is already taken.", code: "users.username.taken", params: { username: "ada" } };
  const appSentence = { status: 404, message: "Contact not found.", code: "not_found", params: {} };
  const generic = { status: 404, message: "Not found.", code: "not_found", params: {} };

  assert.equal(toUiErrorMessage(coded, "Unable to save."), "Username ada is already taken.");
  await withTestLanguage(() => {
    assert.equal(toUiErrorMessage(coded, "Unable to save."), "[xx] Username ada is already taken.");
    assert.equal(toUiErrorMessage(appSentence, "Unable to load."), "Contact not found.");
    assert.equal(toUiErrorMessage(generic), "[xx] Not found.");
    // Specific fallback copy still wins over generic transport wording.
    assert.equal(
      toUiErrorMessage({ status: 500, message: "Request failed with status 500." }, "Unable to save."),
      "Unable to save."
    );
    assert.equal(toUiErrorMessage({}), "[xx] Request failed.");
  });
});

test("field errors render through their codes field by field", async () => {
  const error = {
    fieldErrors: { username: "Username ada is already taken.", email: "Use your work email." },
    fieldErrorCodes: {
      username: { code: "users.username.taken", params: { username: "ada" } },
      email: { code: "users.username.taken", params: { username: "ada" } }
    }
  };

  assert.deepEqual(toUiFieldErrors(error), error.fieldErrors);
  await withTestLanguage(() => {
    assert.deepEqual(toUiFieldErrors(error), {
      username: "[xx] Username ada is already taken.",
      email: "Use your work email."
    });
  });
});

test("CRUD list chrome is English by default and follows the active language", async () => {
  const screen = {
    records: { hasMore: true, loadError: "" },
    listPrimaryAction: "/books/new",
    displayRows: [{ key: "1", recordKey: "1", record: { title: "Kindred" } }],
    resolveRecordTitle: (record) => record.title
  };

  const english = await renderCrudListScreen({ screen });
  for (const text of ["Refresh", "New record", "Load more"]) {
    assert.match(english, new RegExp(`>${text}<`, "u"));
  }

  await withTestLanguage(async () => {
    const translated = await renderCrudListScreen({ screen });
    for (const text of ["Refresh", "New record", "Load more"]) {
      assert.match(translated, new RegExp(`>\\[xx\\] ${text}<`, "u"));
    }
    const appKeyed = await renderCrudListScreen({ screen, createLabel: "jskit.http.crud.record" });
    assert.match(appKeyed, />\[xx\] Record</u);
  });
});

test("date filters format with the app's active language", async () => {
  const filter = { type: "dateRange", label: "jskit.http.crud.records" };
  await withTestLanguage(() => {
    assert.equal(formatDateOnlyDisplay("2026-04-18"), "18 Apr 2026");
    assert.equal(
      formatCrudListDateFilterChipLabel(filter, { from: "2026-05-04", to: "2026-05-10" }),
      "[xx] [xx] Records: 4 May 2026 to 10 May 2026"
    );
  }, "en-GB");
});
