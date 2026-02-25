import assert from "node:assert/strict";
import test from "node:test";

import { buildRepositoryConfig, repositoryConfig } from "../config/index.js";

test("repositoryConfig exposes expected subsystem slices and is deeply frozen", () => {
  assert.deepEqual(Object.keys(repositoryConfig), ["app", "chat", "social", "ai", "billing", "retention", "actions"]);

  assert.equal(Object.isFrozen(repositoryConfig), true);
  assert.equal(Object.isFrozen(repositoryConfig.app), true);
  assert.equal(Object.isFrozen(repositoryConfig.app.features), true);
  assert.equal(Object.isFrozen(repositoryConfig.chat), true);
  assert.equal(Object.isFrozen(repositoryConfig.social), true);
  assert.equal(Object.isFrozen(repositoryConfig.social.limits), true);
  assert.equal(Object.isFrozen(repositoryConfig.social.retry), true);
  assert.equal(Object.isFrozen(repositoryConfig.social.moderation), true);
  assert.equal(Object.isFrozen(repositoryConfig.ai), true);
  assert.equal(Object.isFrozen(repositoryConfig.billing), true);
  assert.equal(Object.isFrozen(repositoryConfig.billing.checkout), true);
  assert.equal(Object.isFrozen(repositoryConfig.retention), true);
  assert.equal(Object.isFrozen(repositoryConfig.retention.chat), true);
  assert.equal(Object.isFrozen(repositoryConfig.actions), true);
  assert.equal(Object.isFrozen(repositoryConfig.actions.assistant), true);
  assert.equal(Object.isFrozen(repositoryConfig.actions.internal), true);
});

test("buildRepositoryConfig returns a fresh frozen copy", () => {
  const a = buildRepositoryConfig();
  const b = buildRepositoryConfig();

  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.app, b.app);
  assert.notStrictEqual(a.chat, b.chat);
  assert.notStrictEqual(a.social, b.social);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(b), true);
});
