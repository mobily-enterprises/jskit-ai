import assert from "node:assert/strict";
import test from "node:test";
import {
  describeShellOutletTargets,
  discoverShellOutletTargetsFromVueSource,
  findShellOutletTargetById,
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
      <ShellOutlet target="shell-layout:top-left" />
      <ShellOutlet
        target="shell-layout:primary-menu"
        default
        default-link-component-token="local.main.ui.surface-aware-menu-link-item"
      />
      <ShellOutlet target="shell-layout:secondary-menu" />
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
  assert.equal(discovered.targets[1].defaultLinkComponentToken, "local.main.ui.surface-aware-menu-link-item");
  assert.equal(
    describeShellOutletTargets(discovered.targets),
    "shell-layout:top-left, shell-layout:primary-menu, shell-layout:secondary-menu"
  );
  assert.deepEqual(
    findShellOutletTargetById(discovered.targets, " shell-layout : primary-menu "),
    discovered.targets[1]
  );
});

test("discoverShellOutletTargetsFromVueSource throws for duplicate targets", () => {
  const source = `
    <template>
      <ShellOutlet target="shell-layout:top-right" />
      <ShellOutlet target="shell-layout:top-right" />
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
      <ShellOutlet target="shell-layout:primary-menu" default />
      <ShellOutlet target="shell-layout:secondary-menu" default />
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
      <ShellOutlet target="shell-layout:primary-menu" default="false" />
      <ShellOutlet target="shell-layout:secondary-menu" />
    </template>
  `;

  const discovered = discoverShellOutletTargetsFromVueSource(source, { context: "ShellLayout.vue" });
  assert.equal(discovered.defaultTargetId, "");
});

test("discoverShellOutletTargetsFromVueSource rejects split outlet attributes", () => {
  const source = `
    <template>
      <ShellOutlet target="shell-layout:primary-menu" host="other-host" position="primary-menu" />
    </template>
  `;

  assert.throws(
    () => discoverShellOutletTargetsFromVueSource(source, { context: "ShellLayout.vue" }),
    /must declare ShellOutlet targets with "target" only/
  );
});
