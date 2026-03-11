import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../container/lib/container.js";
import {
  registerBootstrapPayloadContributor,
  resolveBootstrapPayloadContributors,
  resolveBootstrapPayload
} from "./bootstrapContributors.js";

test("registerBootstrapPayloadContributor + resolveBootstrapPayloadContributors register canonical contributors", () => {
  const app = createContainer();

  registerBootstrapPayloadContributor(app, "test.bootstrap.alpha", () => ({
    contributorId: "alpha",
    contribute() {
      return {
        alpha: true
      };
    }
  }));

  const contributors = resolveBootstrapPayloadContributors(app);
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].contributorId, "alpha");
  assert.equal(typeof contributors[0].contribute, "function");
});

test("resolveBootstrapPayload applies contributors in deterministic token order", async () => {
  const app = createContainer();
  const calls = [];

  registerBootstrapPayloadContributor(app, "test.bootstrap.zeta", () => ({
    contributorId: "zeta",
    contribute({ payload, workspaceSlug }) {
      calls.push({
        contributorId: "zeta",
        payload,
        workspaceSlug
      });
      return {
        last: true
      };
    }
  }));

  registerBootstrapPayloadContributor(app, "test.bootstrap.alpha", () => ({
    contributorId: "alpha",
    contribute({ payload, workspaceSlug }) {
      calls.push({
        contributorId: "alpha",
        payload,
        workspaceSlug
      });
      return {
        first: true
      };
    }
  }));

  const payload = await resolveBootstrapPayload(app, {
    workspaceSlug: "acme"
  });

  assert.deepEqual(calls, [
    {
      contributorId: "alpha",
      payload: {},
      workspaceSlug: "acme"
    },
    {
      contributorId: "zeta",
      payload: {
        first: true
      },
      workspaceSlug: "acme"
    }
  ]);
  assert.deepEqual(payload, {
    first: true,
    last: true
  });
});

test("resolveBootstrapPayload ignores non-object contributions", async () => {
  const app = createContainer();

  registerBootstrapPayloadContributor(app, "test.bootstrap.noop", () => ({
    contributorId: "noop",
    contribute() {
      return null;
    }
  }));
  registerBootstrapPayloadContributor(app, "test.bootstrap.ok", () => ({
    contributorId: "ok",
    contribute() {
      return {
        ok: true
      };
    }
  }));

  const payload = await resolveBootstrapPayload(app, {
    ignored: true
  });
  assert.deepEqual(payload, {
    ok: true
  });
});
