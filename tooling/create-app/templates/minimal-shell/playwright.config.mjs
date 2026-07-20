import { defineConfig } from "@playwright/test";
import { createJskitPlaywrightConfig } from "@jskit-ai/jskit-cli/test/playwright";

export default defineConfig(createJskitPlaywrightConfig());
