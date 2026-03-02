import { createAccountFlows } from "./lib/accountFlows.js";
import { createOauthFlows } from "./lib/oauthFlows.js";
import { createPasswordSecurityFlows } from "./lib/passwordSecurityFlows.js";

function createService(options = {}) {
  const dependencies = options && typeof options === "object" ? options : {};
  const accountFlowsService = createAccountFlows(dependencies);
  const oauthFlowsService = createOauthFlows(dependencies);
  const passwordSecurityService = createPasswordSecurityFlows(dependencies);

  return {
    accountFlowsService,
    oauthFlowsService,
    passwordSecurityService
  };
}

export { createService };
