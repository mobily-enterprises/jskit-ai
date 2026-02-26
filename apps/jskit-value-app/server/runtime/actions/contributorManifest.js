import { composeActionContributors } from "../../framework/composeActions.js";

function createActionContributors(dependencies = {}) {
  return composeActionContributors(dependencies);
}

export { createActionContributors };
