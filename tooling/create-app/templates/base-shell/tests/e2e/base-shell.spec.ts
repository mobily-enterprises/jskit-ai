import { expect, test } from "@playwright/test";
import { runGeneratedAppSmoke } from "@jskit-ai/jskit-cli/test/playwright";

runGeneratedAppSmoke({ test, expect, expectedText: "Ready" });
