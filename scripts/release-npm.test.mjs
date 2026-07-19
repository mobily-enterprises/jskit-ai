import assert from "node:assert/strict";
import test from "node:test";
import { updateDescriptorTextForPackage } from "./release-npm.mjs";

test("release descriptor updates cover direct and conditional JSKIT dependency versions", () => {
  const source = `
export default {
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.1",
        '@jskit-ai/kernel': '0.1.2',
        "@jskit-ai/database-runtime": {
          version: "0.1.3",
          when: { option: "mode", notEquals: "orchestrator" }
        },
        '@jskit-ai/database-runtime': {
          'version': '0.1.4',
          when: { option: 'mode', equals: 'json-rest' }
        }
      }
    }
  }
};
`;

  const kernelUpdated = updateDescriptorTextForPackage(
    source,
    "@jskit-ai/kernel",
    "0.1.120"
  );
  const fullyUpdated = updateDescriptorTextForPackage(
    kernelUpdated,
    "@jskit-ai/database-runtime",
    "0.1.119"
  );

  assert.match(fullyUpdated, /"@jskit-ai\/kernel": "0\.1\.120"/u);
  assert.match(fullyUpdated, /'@jskit-ai\/kernel': '0\.1\.120'/u);
  assert.equal(
    fullyUpdated.match(/(?:"version"|'version'|version):?\s*["']0\.1\.119["']/gu)?.length,
    2
  );
  assert.match(fullyUpdated, /notEquals: "orchestrator"/u);
  assert.match(fullyUpdated, /equals: 'json-rest'/u);
});

test("release descriptor updates leave other package versions unchanged", () => {
  const source = `
export default {
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.119",
        "@jskit-ai/http-runtime": {
          version: "0.1.117",
          when: { option: "transport", equals: "http" }
        }
      }
    }
  }
};
`;

  const updated = updateDescriptorTextForPackage(source, "@jskit-ai/kernel", "0.1.120");

  assert.match(updated, /"@jskit-ai\/kernel": "0\.1\.120"/u);
  assert.match(updated, /version: "0\.1\.117"/u);
});
