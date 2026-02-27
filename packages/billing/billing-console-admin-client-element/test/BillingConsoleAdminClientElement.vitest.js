import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const plansPath = path.resolve(baseDir, "../src/shared/ConsoleBillingPlansClientElement.vue");
const productsPath = path.resolve(baseDir, "../src/shared/ConsoleBillingProductsClientElement.vue");

describe("Billing console admin client elements", () => {
  it("contains plans table/dialog contract markers", () => {
    const source = readFileSync(plansPath, "utf8");

    expect(source.includes("Billing plans")).toBe(true);
    expect(source.includes("state.createDialogOpen")).toBe(true);
    expect(source.includes("state.editDialogOpen")).toBe(true);
    expect(source.includes("state.providerPriceOptions")).toBe(true);
    expect(source.includes("actions.submitCreatePlan")).toBe(true);
    expect(source.includes("actions.saveEditedPlan")).toBe(true);
  });

  it("contains products table/dialog contract markers", () => {
    const source = readFileSync(productsPath, "utf8");

    expect(source.includes("Billing products")).toBe(true);
    expect(source.includes("state.createDialogOpen")).toBe(true);
    expect(source.includes("state.editDialogOpen")).toBe(true);
    expect(source.includes("state.providerPriceOptions")).toBe(true);
    expect(source.includes("actions.submitCreateProduct")).toBe(true);
    expect(source.includes("actions.saveEditedProduct")).toBe(true);
  });
});
