import assert from "node:assert/strict";
import test from "node:test";
import { createComponentInteractionEmitter } from "./componentInteraction.js";

test("createComponentInteractionEmitter requires emit function", () => {
  assert.throws(
    () => createComponentInteractionEmitter(null),
    /expects emit to be a function/
  );
});

test("createComponentInteractionEmitter emits interaction payload", () => {
  const events = [];
  const helpers = createComponentInteractionEmitter((name, payload) => {
    events.push({
      name,
      payload
    });
  });

  helpers.emitInteraction("profile:submit", {
    id: 42
  });

  assert.deepEqual(events, [
    {
      name: "interaction",
      payload: {
        type: "profile:submit",
        id: 42
      }
    }
  ]);
});

test("createComponentInteractionEmitter emits action lifecycle for success", async () => {
  const events = [];
  const helpers = createComponentInteractionEmitter((name, payload) => {
    events.push({
      name,
      payload
    });
  });

  await helpers.invokeAction("save", {
    id: 1
  }, async () => {});

  assert.deepEqual(events, [
    {
      name: "action:started",
      payload: {
        action: "save",
        payload: {
          id: 1
        }
      }
    },
    {
      name: "action:succeeded",
      payload: {
        action: "save",
        payload: {
          id: 1
        }
      }
    }
  ]);
});

test("createComponentInteractionEmitter emits action failure and rethrows", async () => {
  const events = [];
  const helpers = createComponentInteractionEmitter((name, payload) => {
    events.push({
      name,
      payload
    });
  });

  await assert.rejects(
    () =>
      helpers.invokeAction("save", {
        id: 1
      }, async () => {
        throw new Error("boom");
      }),
    /boom/
  );

  assert.deepEqual(events, [
    {
      name: "action:started",
      payload: {
        action: "save",
        payload: {
          id: 1
        }
      }
    },
    {
      name: "action:failed",
      payload: {
        action: "save",
        payload: {
          id: 1
        },
        message: "boom"
      }
    }
  ]);
});
