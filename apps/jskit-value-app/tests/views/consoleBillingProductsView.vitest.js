import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const viewPath = path.join(rootDir, "src/views/console/ConsoleBillingProductsView.vue");

describe("ConsoleBillingProductsView", () => {
  it("renders console billing products package component directly", () => {
    const source = readFileSync(viewPath, "utf8");

    expect(source.includes('from "@jskit-ai/billing-console-admin-client-element/client"')).toBe(true);
    expect(source.includes('<ConsoleBillingProductsClientElement :meta="meta" :state="state" :actions="actions" />')).toBe(true);
  });
});
