import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverShellOutletTargetsFromVueSource,
  normalizeShellOutletTargetId
} from "./shellLayoutTargets.js";

test("normalizeShellOutletTargetId validates host:position tokens", () => {
  assert.equal(normalizeShellOutletTargetId("shell-layout:primary-menu"), "shell-layout:primary-menu");
  assert.equal(normalizeShellOutletTargetId(" shell-layout : primary-menu "), "shell-layout:primary-menu");
  assert.equal(normalizeShellOutletTargetId(""), "");
  assert.equal(normalizeShellOutletTargetId("shell-layout"), "");
  assert.equal(normalizeShellOutletTargetId("shell-layout:"), "");
});

test("discoverShellOutletTargetsFromVueSource resolves legal targets and one default", () => {
  const source = `
    <template>
      <ShellOutlet host="shell-layout" position="top-left" />
      <ShellOutlet host="shell-layout" position="primary-menu" default />
      <ShellOutlet host="shell-layout" position="secondary-menu" />
    </template>
  `;

  const discovered = discoverShellOutletTargetsFromVueSource(source, {
    context: "ShellLayout.vue"
  });

  assert.equal(discovered.defaultTargetId, "shell-layout:primary-menu");
  assert.deepEqual(
    discovered.targets.map((entry) => entry.id),
    ["shell-layout:top-left", "shell-layout:primary-menu", "shell-layout:secondary-menu"]
  );
});

test("discoverShellOutletTargetsFromVueSource throws for duplicate targets", () => {
  const source = `
    <template>
      <ShellOutlet host="shell-layout" position="top-right" />
      <ShellOutlet host="shell-layout" position="top-right" />
    </template>
  `;

  assert.throws(
    () => discoverShellOutletTargetsFromVueSource(source, { context: "ShellLayout.vue" }),
    /duplicate ShellOutlet target/
  );
});

test("discoverShellOutletTargetsFromVueSource throws for multiple defaults", () => {
  const source = `
    <template>
      <ShellOutlet host="shell-layout" position="primary-menu" default />
      <ShellOutlet host="shell-layout" position="secondary-menu" default />
    </template>
  `;

  assert.throws(
    () => discoverShellOutletTargetsFromVueSource(source, { context: "ShellLayout.vue" }),
    /multiple default ShellOutlet targets/
  );
});

test("discoverShellOutletTargetsFromVueSource ignores disabled default markers", () => {
  const source = `
    <template>
      <ShellOutlet host="shell-layout" position="primary-menu" default="false" />
      <ShellOutlet host="shell-layout" position="secondary-menu" />
    </template>
  `;

  const discovered = discoverShellOutletTargetsFromVueSource(source, { context: "ShellLayout.vue" });
  assert.equal(discovered.defaultTargetId, "");
});
