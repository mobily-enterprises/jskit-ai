import { createNodeVueFastifyScriptsConfig } from "@jskit-ai/app-scripts";

const ARTIFACTS_DIR = ".artifacts";

export default createNodeVueFastifyScriptsConfig({
  internalDistDir: `${ARTIFACTS_DIR}/dist/internal`,
  publicDistDir: `${ARTIFACTS_DIR}/dist/public`,
  guardrails: {
    apiContracts: {
      routeProvider: {
        exportName: "buildRoutes"
      }
    },
    processEnv: {
      excludedDirNames: [
        ".git",
        "node_modules",
        "tests",
        "dist",
        "dist-internal",
        "dist-public",
        "coverage",
        ".vite",
        ARTIFACTS_DIR
      ]
    }
  }
});
