import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { computed, ref } from "vue";
import { createShellPageActionsRegistry } from "../src/client/support/pageActions.js";

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
