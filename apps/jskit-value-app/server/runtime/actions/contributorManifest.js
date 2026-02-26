import { composeActionContributors } from "../../framework/composeActions.js";

function createActionContributors(dependencies = {}, options = {}) {
  return composeActionContributors(dependencies, options);
}

export { createActionContributors };
