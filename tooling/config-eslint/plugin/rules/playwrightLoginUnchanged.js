import { compactText, keyName, ruleMeta } from "../support.js";

const LOGIN_VARIABLE = "PLAYWRIGHT_STORAGE_STATE";
// playwright.config.mjs, playwright.local.config.js and the like.
const PLAYWRIGHT_CONFIG = /(?:^|[\\/])playwright(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/u;
// What a storage state file holds: working on either means the config has the state's contents.
const STATE_CONTENTS = new Set(["cookies", "origins"]);
const TEST_STATEMENTS = new Set(["IfStatement", "WhileStatement", "DoWhileStatement", "ForStatement"]);
const COMPARISONS = new Set(["===", "!==", "==", "!="]);
// The authentication guide explains the managed host's login state, under Verification.
const AUTHENTICATION_GUIDE_URL = "https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/authentication";

function memberName(node) {
  return node.computed ? node.property.value : node.property.name;
}

function isCallOf(node, name) {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name;
}

function shortText(sourceCode, node) {
  const text = compactText(sourceCode, node);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// A managed host signs the suite in and supplies that login state as a file path in PLAYWRIGHT_STORAGE_STATE, already
// fitted to the tested site. The config hands the path to `use.storageState` unchanged: String(), .trim() and a
// fallback (`|| ""`, `?? undefined`, a conditional) keep it unchanged, and testing it decides nothing about its
// contents. Passing it anywhere else (readFileSync, JSON.parse, a helper) or working on cookies or origins copies
// host logic into the app and hides a host defect behind it. The finding cannot be excused by a readable-check
// comment: the host's own runner refuses such configs too.
const playwrightLoginUnchanged = Object.freeze({
  meta: ruleMeta("Require a Playwright config to pass the managed host's login state on unchanged.", {
    changedLogin: "{{use}} reads or changes the login state in PLAYWRIGHT_STORAGE_STATE. The login state belongs to the host. Pass process.env.PLAYWRIGHT_STORAGE_STATE unchanged to use.storageState. If tests run signed out with it, that is a host defect: report it with the evidence; do not work around it."
  }, "verification", AUTHENTICATION_GUIDE_URL),
  create(context) {
    if (!PLAYWRIGHT_CONFIG.test(context.filename)) {
      return {};
    }
    const sourceCode = context.sourceCode;
    let readsLogin = false;
    let contents = null;
    const report = (node) => context.report({ node, messageId: "changedLogin", data: { use: shortText(sourceCode, node) } });

    // Every read of a variable that holds the login, followed like the login itself.
    function followVariable(declarator, name) {
      const variable = sourceCode.getDeclaredVariables(declarator).find((candidate) => candidate.name === name);
      for (const reference of variable?.references || []) {
        if (reference.isRead()) {
          follow(reference.identifier);
        }
      }
    }

    // Follows the login value from `node` to where it ends up, reporting the first place it is not passed on unchanged.
    function follow(node) {
      const parent = node.parent;
      if (parent.type === "ChainExpression") {
        return follow(parent);
      }
      if (parent.type === "LogicalExpression") {
        // `login && …` only tests it; `login || ""`, `login ?? undefined` and `fallback || login` may be it.
        return parent.operator === "&&" && parent.left === node ? undefined : follow(parent);
      }
      if (parent.type === "ConditionalExpression") {
        return parent.test === node ? undefined : follow(parent);
      }
      if ((TEST_STATEMENTS.has(parent.type) && parent.test === node) ||
        (parent.type === "UnaryExpression" && parent.operator === "!") ||
        (parent.type === "BinaryExpression" && COMPARISONS.has(parent.operator)) || isCallOf(parent, "Boolean")) {
        return undefined;
      }
      if (isCallOf(parent, "String") && parent.arguments[0] === node) {
        return follow(parent);
      }
      if (parent.type === "MemberExpression" && parent.object === node && memberName(parent) === "trim" &&
        parent.parent.type === "CallExpression" && parent.parent.callee === parent && parent.parent.arguments.length === 0) {
        return follow(parent.parent);
      }
      if (parent.type === "VariableDeclarator" && parent.init === node && parent.id.type === "Identifier") {
        return followVariable(parent, parent.id.name);
      }
      if (parent.type === "Property" && parent.value === node && !parent.computed && keyName(parent) === "storageState") {
        return undefined;
      }
      if (parent.type === "AssignmentExpression" && parent.right === node && parent.left.type === "MemberExpression" &&
        memberName(parent.left) === "storageState") {
        return undefined;
      }
      return report(parent);
    }

    return {
      MemberExpression(node) {
        if (memberName(node) === LOGIN_VARIABLE) {
          readsLogin = true;
          follow(node);
        } else if (!contents && STATE_CONTENTS.has(memberName(node))) {
          contents = node;
        }
      },
      // const { PLAYWRIGHT_STORAGE_STATE } = process.env, with or without a new name or a default.
      Property(node) {
        if (!contents && STATE_CONTENTS.has(keyName(node))) {
          contents = node;
        }
        if (node.parent.type !== "ObjectPattern" || keyName(node) !== LOGIN_VARIABLE) {
          return;
        }
        readsLogin = true;
        const target = node.value.type === "AssignmentPattern" ? node.value.left : node.value;
        const declarator = node.parent.parent;
        if (target.type !== "Identifier" || declarator.type !== "VariableDeclarator") {
          report(node);
          return;
        }
        followVariable(declarator, target.name);
      },
      // A variable named cookies or origins; member and key names were met first, by their own nodes.
      Identifier(node) {
        if (!contents && STATE_CONTENTS.has(node.name)) {
          contents = node;
        }
      },
      "Program:exit"() {
        if (readsLogin && contents) {
          report(contents);
        }
      }
    };
  }
});

export { playwrightLoginUnchanged };
