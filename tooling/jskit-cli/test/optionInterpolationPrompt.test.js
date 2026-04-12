import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { promptForRequiredOption } from "../src/server/shared/optionInterpolation.js";

class CaptureOutput extends Writable {
  constructor() {
    super();
    this.isTTY = true;
    this.chunks = [];
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk).toString("utf8"));
    callback();
  }

  toString() {
    return this.chunks.join("");
  }
}

test("promptForRequiredOption shows numbered choices for enabled-surface-id options", async () => {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  const stdout = new CaptureOutput();

  stdin.end("2\n");

  const answer = await promptForRequiredOption({
    ownerType: "package",
    ownerId: "@demo/assistant",
    optionName: "settings-surface",
    optionSchema: {
      required: true,
      promptLabel: "Which enabled surface should host the assistant settings UI?",
      validationType: "enabled-surface-id"
    },
    promptChoices: [
      { value: "home", label: "home (Home)" },
      { value: "admin", label: "admin (Admin)" }
    ],
    stdin,
    stdout
  });

  assert.equal(answer, "admin");
  const output = stdout.toString();
  assert.match(output, /Which enabled surface should host the assistant settings UI\?/);
  assert.match(output, /1\) home \(Home\)/);
  assert.match(output, /2\) admin \(Admin\)/);
  assert.match(output, /Select a surface by number or id:/);
});
