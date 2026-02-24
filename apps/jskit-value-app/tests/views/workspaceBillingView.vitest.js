import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const billingViewPath = path.join(rootDir, "src/views/workspace-billing/WorkspaceBillingView.vue");

function readBillingViewSource() {
  return readFileSync(billingViewPath, "utf8");
}

describe("WorkspaceBillingView template", () => {
  it("imports and renders package billing elements directly", () => {
    const source = readBillingViewSource();

    expect(source.includes('from "@jskit-ai/billing-plan-client-element"')).toBe(true);
    expect(source.includes('from "@jskit-ai/billing-commerce-client-element"')).toBe(true);
    expect(source.includes("<BillingPlanClientElement :meta=\"meta\" :state=\"state\" :actions=\"actions\" />")).toBe(true);
    expect(source.includes("<BillingCommerceClientElement :meta=\"meta\" :state=\"state\" :actions=\"actions\" />")).toBe(
      true
    );
    expect(source.includes("<v-card-title class=\"text-subtitle-2 font-weight-bold\">Current plan</v-card-title>")).toBe(
      false
    );
    expect(source.includes("<v-card-title class=\"text-subtitle-2 font-weight-bold\">Scheduled change</v-card-title>")).toBe(
      false
    );
    expect(source.includes("<v-card-title class=\"text-subtitle-2 font-weight-bold\">Change core plan</v-card-title>")).toBe(
      false
    );
  });

  it("renders plan package element before commerce package element", () => {
    const source = readBillingViewSource();
    const planElementIndex = source.indexOf("<BillingPlanClientElement");
    const commerceElementIndex = source.indexOf("<BillingCommerceClientElement");

    expect(planElementIndex).toBeGreaterThan(-1);
    expect(commerceElementIndex).toBeGreaterThan(-1);
    expect(commerceElementIndex).toBeGreaterThan(planElementIndex);
  });
});
