import YAML from "yaml";
import { CI_STEP_PHASE_BEFORE_VERIFY } from "./contract.js";

const JSKIT_CI_WORKFLOW_RELATIVE_PATH = ".github/workflows/jskit-verify.yml";
const LEGACY_CI_WORKFLOW_RELATIVE_PATH = ".github/workflows/verify.yml";
const GENERATED_WORKFLOW_HEADER = [
  "# Generated and managed by JSKIT. Run `npx jskit app sync-ci` to regenerate.",
  "# Put application-specific CI in a separate workflow; edits to this file are not merged.",
  ""
].join("\n");
const LEGACY_VERIFY_WORKFLOW_HASH = "9f274b8400ca51004446f98a9cf55e74180f11b016ee48b60f6d86e3b434bdb6";

function quoteDockerOptionValue(value) {
  return JSON.stringify(String(value || ""));
}

function renderGithubServiceOptions(service = {}) {
  const healthCheck = service?.healthCheck;
  if (!healthCheck || typeof healthCheck !== "object") {
    return "";
  }
  const options = [`--health-cmd=${quoteDockerOptionValue(healthCheck.command)}`];
  if (healthCheck.interval) {
    options.push(`--health-interval=${healthCheck.interval}`);
  }
  if (healthCheck.timeout) {
    options.push(`--health-timeout=${healthCheck.timeout}`);
  }
  if (healthCheck.retries) {
    options.push(`--health-retries=${healthCheck.retries}`);
  }
  return options.join(" ");
}

function renderGithubService(service = {}) {
  const rendered = {
    image: service.image
  };
  if (Object.keys(service.environment || {}).length > 0) {
    rendered.env = service.environment;
  }
  if (Array.isArray(service.ports) && service.ports.length > 0) {
    rendered.ports = service.ports;
  }
  const options = renderGithubServiceOptions(service);
  if (options) {
    rendered.options = options;
  }
  return rendered;
}

function buildGithubWorkflowDocument(model = {}) {
  const beforeVerifySteps = (Array.isArray(model.steps) ? model.steps : [])
    .filter((step) => step.phase === CI_STEP_PHASE_BEFORE_VERIFY)
    .map((step) => ({
      id: step.id,
      name: step.label,
      run: step.command
    }));
  const steps = [
    {
      id: "checkout",
      name: "Checkout",
      uses: "actions/checkout@v4"
    },
    {
      id: "setup-node",
      name: "Setup Node",
      uses: "actions/setup-node@v4",
      with: {
        "node-version": 20,
        cache: "npm"
      }
    },
    {
      id: "install-dependencies",
      name: "Install dependencies",
      run: "npm ci"
    },
    ...beforeVerifySteps,
    {
      id: "verify",
      name: "Run verification",
      run: "npm run verify"
    }
  ];
  const verifyJob = {
    "runs-on": "ubuntu-latest"
  };
  if (Object.keys(model.environment || {}).length > 0) {
    verifyJob.env = model.environment;
  }
  if (Array.isArray(model.services) && model.services.length > 0) {
    verifyJob.services = Object.fromEntries(
      model.services.map((service) => [service.id, renderGithubService(service)])
    );
  }
  verifyJob.steps = steps;

  return {
    name: "JSKIT Verify",
    on: {
      pull_request: null,
      push: {
        branches: ["main"]
      }
    },
    permissions: {
      contents: "read"
    },
    jobs: {
      verify: verifyJob
    }
  };
}

function renderGithubWorkflow(model = {}) {
  return `${GENERATED_WORKFLOW_HEADER}${YAML.stringify(buildGithubWorkflowDocument(model), {
    lineWidth: 0
  })}`;
}

function parseGithubWorkflow(source = "") {
  return YAML.parse(String(source || ""));
}

export {
  GENERATED_WORKFLOW_HEADER,
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  LEGACY_CI_WORKFLOW_RELATIVE_PATH,
  LEGACY_VERIFY_WORKFLOW_HASH,
  buildGithubWorkflowDocument,
  parseGithubWorkflow,
  renderGithubServiceOptions,
  renderGithubWorkflow
};
