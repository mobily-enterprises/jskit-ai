import { createNodeVueFastifyScriptsConfig } from "@jskit-ai/app-scripts";

const preset = createNodeVueFastifyScriptsConfig();

export default {
  guardrails: preset.guardrails,
  tasks: {
    server: preset.tasks.server,
    start: preset.tasks.start,
    dev: preset.tasks.dev,
    build: preset.tasks.build,
    preview: preset.tasks.preview,
    lint: preset.tasks.lint,
    "lint:process-env": preset.tasks["lint:process-env"],
    test: preset.tasks.test,
    "test:client": preset.tasks["test:client"]
  }
};
