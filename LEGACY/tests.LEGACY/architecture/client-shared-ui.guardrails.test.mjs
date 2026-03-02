import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const UI_PACKAGES = Object.freeze([
  {
    name: "@jskit-ai/billing-plan-client-element",
    path: "packages/billing/billing-plan-client-element",
    component: "BillingPlanClientElement"
  },
  {
    name: "@jskit-ai/chat-client-element",
    path: "packages/chat/chat-client-element",
    component: "ChatClientElement"
  },
  {
    name: "@jskit-ai/assistant-client-element",
    path: "packages/ai-agent/assistant-client-element",
    component: "AssistantClientElement"
  },
  {
    name: "@jskit-ai/profile-client-element",
    path: "packages/users/profile-client-element",
    component: "ProfileClientElement"
  }
]);

const DIRECT_APP_USAGE_RULES = Object.freeze([
  {
    file: "apps/jskit-value-app/src/views/workspace-billing/WorkspaceBillingView.vue",
    requiredImport: "@jskit-ai/billing-plan-client-element"
  },
  {
    file: "apps/jskit-value-app/src/views/chat/ChatView.vue",
    requiredImport: "@jskit-ai/chat-client-element"
  },
  {
    file: "apps/jskit-value-app/src/views/assistant/AssistantView.vue",
    requiredImport: "@jskit-ai/assistant-client-element"
  },
  {
    file: "apps/jskit-value-app/src/views/settings/profile/SettingsProfileForm.vue",
    requiredImport: "@jskit-ai/profile-client-element"
  }
]);

const DUPLICATION_MARKER_RULES = Object.freeze([
  {
    file: "apps/jskit-value-app/src/views/chat/ChatView.vue",
    forbiddenMarkers: ["chat-message-panel", "chat-composer-shell"]
  },
  {
    file: "apps/jskit-value-app/src/views/assistant/AssistantView.vue",
    forbiddenMarkers: ["assistant-history-card", "assistant-tools-card"]
  },
  {
    file: "apps/jskit-value-app/src/views/workspace-billing/WorkspaceBillingView.vue",
    forbiddenMarkers: ["billing-plan-current-card", "billing-plan-scheduled-card", "billing-plan-change-card"]
  },
  {
    file: "apps/jskit-value-app/src/views/settings/profile/SettingsProfileForm.vue",
    forbiddenMarkers: ["profile-client-card", "Save profile", "Replace avatar"]
  }
]);

function readSource(relativePath) {
  return readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function listFilesRecursive(rootDir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files.push(absolutePath);
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

test("shared-ui guardrail: client-element package paths exist", () => {
  const missing = UI_PACKAGES.map((entry) => entry.path).filter((relativePath) => {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    return !existsSync(absolutePath);
  });

  assert.deepEqual(missing, []);
});

test("shared-ui guardrail: app views use package imports directly", () => {
  const violations = [];

  for (const rule of DIRECT_APP_USAGE_RULES) {
    const absolutePath = path.join(ROOT_DIR, rule.file);
    if (!existsSync(absolutePath)) {
      violations.push(`${rule.file} is missing`);
      continue;
    }

    const source = readSource(rule.file);
    if (!source.includes(rule.requiredImport)) {
      violations.push(`${rule.file} must import ${rule.requiredImport}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("shared-ui guardrail: app wrappers do not reintroduce package-owned canonical markers", () => {
  const violations = [];

  for (const rule of DUPLICATION_MARKER_RULES) {
    const source = readSource(rule.file);
    for (const marker of rule.forbiddenMarkers) {
      if (source.includes(marker)) {
        violations.push(`${rule.file} contains forbidden package-owned marker: ${marker}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("shared-ui guardrail: package README files include Customization and Eject sections", () => {
  const violations = [];

  for (const pkg of UI_PACKAGES) {
    const readmePath = `${pkg.path}/README.md`;
    if (!existsSync(path.join(ROOT_DIR, readmePath))) {
      violations.push(`${readmePath} is missing`);
      continue;
    }

    const source = readSource(readmePath);
    if (!/\n##\s+Customization\b/.test(source)) {
      violations.push(`${readmePath} must include a "Customization" section`);
    }
    if (!/\n##\s+Eject\b/.test(source)) {
      violations.push(`${readmePath} must include an "Eject" section`);
    }
  }

  assert.deepEqual(violations, []);
});

test("shared-ui guardrail: package tests include slot/variant and emits coverage", () => {
  const violations = [];

  for (const pkg of UI_PACKAGES) {
    const testDir = path.join(ROOT_DIR, pkg.path, "test");
    if (!existsSync(testDir)) {
      violations.push(`${pkg.path}/test is missing`);
      continue;
    }

    const testFiles = listFilesRecursive(testDir).filter((filePath) => filePath.endsWith(".js") || filePath.endsWith(".mjs"));
    if (testFiles.length < 1) {
      violations.push(`${pkg.path}/test must contain test files`);
      continue;
    }

    const mergedSource = testFiles
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n\n");

    const hasSlotsOrVariantCoverage = /(slot|slots|variant)/i.test(mergedSource);
    const hasEmitsCoverage = /(emitted\(|emit|emits)/i.test(mergedSource);

    if (!hasSlotsOrVariantCoverage) {
      violations.push(`${pkg.path}/test must include at least one slots/variant test`);
    }
    if (!hasEmitsCoverage) {
      violations.push(`${pkg.path}/test must include at least one emits test`);
    }
  }

  assert.deepEqual(violations, []);
});
