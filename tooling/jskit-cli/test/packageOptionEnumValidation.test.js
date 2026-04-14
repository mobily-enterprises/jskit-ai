import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import {
  resolvePackageOptions,
  validateInlineOptionValuesForPackage
} from "../src/server/cliRuntime/packageOptions.js";

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

test("validateInlineOptionValuesForPackage accepts enum and csv-enum values from descriptor metadata", async () => {
  const packageEntry = {
    packageId: "@demo/enum-generator",
    descriptor: {
      options: {
        "ownership-filter": {
          validationType: "enum",
          allowedValues: ["auto", "public", "user"]
        },
        operations: {
          validationType: "csv-enum",
          allowedValues: ["list", "view", "edit"]
        }
      }
    }
  };

  await validateInlineOptionValuesForPackage(packageEntry, {
    "ownership-filter": "USER",
    operations: "list,EDIT"
  });
});

test("validateInlineOptionValuesForPackage rejects unsupported enum and csv-enum values", async () => {
  const packageEntry = {
    packageId: "@demo/enum-generator",
    descriptor: {
      options: {
        "ownership-filter": {
          validationType: "enum",
          allowedValues: ["auto", "public", "user"]
        },
        operations: {
          validationType: "csv-enum",
          allowedValues: ["list", "view", "edit"]
        }
      }
    }
  };

  await assert.rejects(
    () => validateInlineOptionValuesForPackage(packageEntry, { "ownership-filter": "workspace" }),
    /--ownership-filter must be one of: auto, public, user\./
  );
  await assert.rejects(
    () => validateInlineOptionValuesForPackage(packageEntry, { operations: "list,delete" }),
    /--operations includes unsupported value\(s\): delete\. Allowed values: list, view, edit\./
  );
});

test("resolvePackageOptions offers descriptor-backed choices for required enum options", async () => {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  const stdout = new CaptureOutput();
  stdin.end("2\n");

  const packageEntry = {
    packageId: "@demo/enum-generator",
    descriptor: {
      options: {
        "ownership-filter": {
          required: true,
          inputType: "text",
          validationType: "enum",
          allowedValues: ["auto", "public", "user"],
          promptLabel: "Ownership filter"
        }
      }
    }
  };

  const resolved = await resolvePackageOptions(packageEntry, {}, { stdin, stdout }, {});

  assert.equal(resolved["ownership-filter"], "public");
  const output = stdout.toString();
  assert.match(output, /Ownership filter/);
  assert.match(output, /1\) auto/);
  assert.match(output, /2\) public/);
  assert.match(output, /3\) user/);
});
