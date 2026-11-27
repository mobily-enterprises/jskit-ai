import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { computed, ref } from "vue";
import { createShellPageActionsRegistry, resolveFoldedPageActions } from "../src/client/support/pageActions.js";

function action(label, { primary = false, overflow = false } = {}) {
  return { id: label, state: computed(() => ({ label, primary, overflow })), attrs: {}, activate() {}, anchor: null };
}

function menuLabels(registry) {
  return registry.menuEntries.value.map((entry) => entry.state.value.label);
}

test("a compact top app bar keeps only the primary action, and wider bars every action", () => {
  const isCompact = ref(true);
  const registry = createShellPageActionsRegistry({ isCompact });
  const releases = ["Edit", "Share"].map((label) => registry.register(action(label)).release);
  assert.deepEqual(menuLabels(registry), ["Edit", "Share"], "a compact bar keeps its place for the account avatar");
  assert.equal(registry.hasPrimary.value, false);

  const save = registry.register(action("Save", { primary: true }));
  assert.deepEqual(menuLabels(registry), ["Edit", "Share"], "the primary action takes the place");
  assert.equal(registry.hasPrimary.value, true);

  isCompact.value = false;
  assert.deepEqual(menuLabels(registry), [], "wider windows show every action");
  assert.equal(registry.hasPrimary.value, true);

  save.release();
  releases.forEach((release) => release());
  assert.deepEqual(menuLabels(registry), []);
  assert.equal(registry.hasPrimary.value, false);
});

test("overflow actions go to the menu at every width, in bar order, and an overflow primary action takes no place", () => {
  const isCompact = ref(false);
  const registry = createShellPageActionsRegistry({ isCompact });
  const edit = action("Edit");
  const duplicate = action("Duplicate", { overflow: true });
  registry.register(edit);
  registry.register(duplicate);
  registry.register(action("Delete"));
  assert.deepEqual(menuLabels(registry), ["Duplicate"]);
  assert.equal(registry.inMenu(duplicate), true);
  assert.equal(registry.inMenu(edit), false);

  registry.register(action("Publish", { primary: true, overflow: true }));
  assert.equal(registry.hasPrimary.value, false);
  isCompact.value = true;
  assert.deepEqual(menuLabels(registry), ["Edit", "Duplicate", "Delete", "Publish"]);
});

test("a wider bar folds its last actions that don't fit into the menu, in bar order, and never the primary one", () => {
  const isCompact = ref(false);
  const registry = createShellPageActionsRegistry({ isCompact });
  const [edit, share, duplicate, save, archive] = [
    action("Edit"),
    action("Share"),
    action("Duplicate", { overflow: true }),
    action("Save", { primary: true }),
    action("Archive")
  ];
  [edit, share, duplicate, save, archive].forEach((entry) => registry.register(entry));
  assert.deepEqual(registry.foldable.value.map((entry) => entry.state.value.label), ["Edit", "Share", "Archive"]);

  registry.fold(1);
  assert.deepEqual(menuLabels(registry), ["Duplicate", "Archive"]);
  assert.equal(registry.inMenu(archive), true);
  assert.equal(registry.inMenu(share), false);
  registry.fold(2);
  assert.deepEqual(menuLabels(registry), ["Share", "Duplicate", "Archive"], "the menu keeps bar order");
  registry.fold(5);
  assert.deepEqual(menuLabels(registry), ["Edit", "Share", "Duplicate", "Archive"], "the primary action stays in the bar");
  assert.equal(registry.inMenu(save), false);

  registry.fold(0);
  isCompact.value = true;
  assert.deepEqual(menuLabels(registry), ["Edit", "Share", "Duplicate", "Archive"], "a compact bar keeps its own rule");
});

test("a wider bar folds as few of its last actions as leave the rest and the overflow button beside the whole title", () => {
  // 400px beside the title for four 100px actions; the overflow button is 48px.
  const bar = { room: 400, fixed: 0, actions: [100, 100, 100, 100], menuButton: 48, menuShown: false };
  assert.equal(resolveFoldedPageActions(bar), 0, "four actions that fit to the pixel, with no menu");
  assert.equal(resolveFoldedPageActions({ ...bar, room: 399 }), 1, "one pixel short: the last action and the button");
  assert.equal(resolveFoldedPageActions({ ...bar, room: 348 }), 1, "three actions and the button, to the pixel");
  assert.equal(resolveFoldedPageActions({ ...bar, room: 347 }), 2);
  assert.equal(resolveFoldedPageActions({ ...bar, menuShown: true }), 1, "the menu's own actions need the button too");
  assert.equal(resolveFoldedPageActions({ ...bar, room: 400, fixed: 120 }), 2, "the primary action takes its width first");
  assert.equal(resolveFoldedPageActions({ ...bar, room: 20 }), 4, "too little room: every one folds");
  assert.equal(resolveFoldedPageActions({ ...bar, room: -50 }), 4, "a title wider than the bar");
  assert.equal(resolveFoldedPageActions({ ...bar, actions: [] }), 0);
});

test("ShellPageAction forwards its attributes to the button in each form and registers with the bar", async () => {
  const filename = new URL("../src/client/components/ShellPageAction.vue", import.meta.url);
  const source = await readFile(filename, "utf8");
  assert.match(source, /defineOptions\(\{ inheritAttrs: false \}\)/u);
  assert.match(source, /v-bind="mergeProps\(attrs, tooltipProps\)"/u);
  assert.match(source, /v-else\s+v-bind="attrs"/u);
  for (const prop of ["color", "download", "replace", "overflow"]) {
    assert.match(source, new RegExp(`\\n  ${prop}: \\{`, "u"), `${prop} is a prop`);
  }
  for (const file of ["ShellPageAction.vue", "ShellPageActionsTarget.vue", "ShellPrimaryAction.vue"]) {
    const componentPath = new URL(`../src/client/components/${file}`, import.meta.url);
    const { descriptor, errors } = parse(await readFile(componentPath, "utf8"), { filename: componentPath.pathname });
    assert.deepEqual(errors, [], file);
    const script = compileScript(descriptor, { id: file });
    const compiled = compileTemplate({
      id: file,
      filename: componentPath.pathname,
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings }
    });
    assert.deepEqual(compiled.errors, [], file);
  }
  const target = await readFile(new URL("../src/client/components/ShellPageActionsTarget.vue", import.meta.url), "utf8");
  assert.match(target, /<v-list v-if="!slots\.menu" role="menu"/u);
  assert.match(target, /v-bind="itemProps\(entry\)"\s+role="menuitem"/u);
  assert.match(target, /mergeProps\(entry\.attrs, \{/u);
  const primary = await readFile(new URL("../src/client/components/ShellPrimaryAction.vue", import.meta.url), "utf8");
  assert.match(primary, /<v-fab\s+v-if="isCompact \|\| isMedium"[\s\S]*\bapp\b[\s\S]*\bextended\b/u);
  assert.match(primary, /<ShellPageActions v-else>\s*<ShellPageAction[\s\S]*\bprimary\b/u);
});
