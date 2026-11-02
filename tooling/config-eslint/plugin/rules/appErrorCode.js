import { createReporter, keyName, ruleMeta } from "../support.js";

// The kernel's error classes and where each takes its options: AppError and DomainError take (status, message,
// options), ConflictError and NotFoundError (message, options). Their default codes ("APP_ERROR", "domain_error",
// "conflict", "not_found") would be shared by every sentence that leaves its code out.
const KERNEL_ERRORS = Object.freeze({
  AppError: { message: 1, options: 2 },
  DomainError: { message: 1, options: 2 },
  ConflictError: { message: 0, options: 1 },
  NotFoundError: { message: 0, options: 1 }
});

function objectHasKey(node, name) {
  return node?.type === "ObjectExpression" && node.properties.some((property) => property.type === "Property" && keyName(property) === name);
}

function hasSpread(node) {
  return node?.type === "ObjectExpression" && node.properties.some((property) => property.type === "SpreadElement");
}

// Whether a class body fixes its own code: a `code:` property whose value is a literal, or `this.code = …`. A code
// that only falls back to a default (`code: options.code || "x"`) is not its own.
function setsOwnCode(classBody, sourceCode) {
  const text = sourceCode.getText(classBody);
  return /\bcode\s*:\s*["'`]/u.test(text) || /this\.code\s*=/u.test(text);
}

function parameterIndex(parameters, name) {
  return parameters.findIndex((parameter) => (parameter.type === "AssignmentPattern" ? parameter.left : parameter).name === name);
}

// The constructor's `super(…)` call, made as a statement of its own.
function superCall(constructor) {
  const statement = constructor?.value.body.body.find((member) => member.type === "ExpressionStatement" &&
    member.expression.type === "CallExpression" && member.expression.callee.type === "Super");
  return statement?.expression ?? null;
}

// Whether a destructured parameter's rest element (`{ approval, ...options }`) reaches `super` as the options it passes
// on, as they are (`options`) or spread (`{ ...options, details }`). The caller's code is then among them.
function forwardsRest(target, superOptions) {
  const rest = target.type === "ObjectPattern" ? target.properties.find((property) => property.type === "RestElement") : null;
  const name = rest?.argument.type === "Identifier" ? rest.argument.name : "";
  if (!name || !superOptions) {
    return false;
  }
  if (superOptions.type === "Identifier") {
    return superOptions.name === name;
  }
  return superOptions.type === "ObjectExpression" && superOptions.properties.some((property) => property.type === "SpreadElement" &&
    property.argument.type === "Identifier" && property.argument.name === name);
}

// The parameter that holds a call's options: one named `options`, one that destructures `code` (`{ code }`), or one
// whose rest element the constructor forwards to `super` as its options (`superOptions`, the argument `super` takes
// them in).
function optionsIndex(parameters, superOptions) {
  return parameters.findIndex((parameter) => {
    const target = parameter.type === "AssignmentPattern" ? parameter.left : parameter;
    return target.name === "options" ||
      (target.type === "ObjectPattern" && target.properties.some((property) => property.type === "Property" && keyName(property) === "code")) ||
      forwardsRest(target, superOptions);
  });
}

// The error classes this module declares over a kernel error class, by name: whether each fixes its own code, and
// where a call passes a code (a `code` parameter) or the options that hold one. A class without a constructor takes
// its parent's arguments.
function localErrorClasses(program, sourceCode) {
  const classes = new Map();
  const declarations = program.body.map((statement) => (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration")
    ? statement.declaration
    : statement);
  for (let grew = true; grew;) {
    grew = false;
    for (const declaration of declarations) {
      const name = declaration?.type === "ClassDeclaration" ? declaration.id?.name : "";
      const parentName = declaration?.superClass?.type === "Identifier" ? declaration.superClass.name : "";
      const parent = KERNEL_ERRORS[parentName] ? { ownCode: false, code: -1, options: KERNEL_ERRORS[parentName].options } : classes.get(parentName);
      if (!name || classes.has(name) || !parent) {
        continue;
      }
      const constructor = declaration.body.body.find((member) => member.type === "MethodDefinition" && member.kind === "constructor");
      const parameters = constructor?.value.params;
      classes.set(name, {
        ownCode: setsOwnCode(declaration.body, sourceCode) || parent.ownCode,
        code: parameters ? parameterIndex(parameters, "code") : parent.code,
        options: parameters ? optionsIndex(parameters, superCall(constructor)?.arguments[parent.options] ?? null) : parent.options
      });
      grew = true;
    }
  }
  return classes;
}

// Whether a call passes a code where the class takes one: the options argument holds `code` (or may, as a variable
// or a spread), or a `code` parameter receives an argument.
function passesCode(node, { code, options }) {
  if (code >= 0 && node.arguments.length > code) {
    return true;
  }
  if (options < 0) {
    return false;
  }
  const argument = node.arguments[options];
  return Boolean(argument) && (argument.type !== "ObjectExpression" || objectHasKey(argument, "code") || hasSpread(argument));
}

function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

// A refusal meant for the caller is an AppError with its own code: one code per distinct sentence, so a client can
// tell refusals apart and show each in the user's language. The kernel's classes, and this module's subclasses of
// them, are checked; a subclass that fixes its own code needs none at the call.
const appErrorCode = Object.freeze({
  meta: ruleMeta("Require each AppError refusal to carry its own code.", {
    missingCode: "new {{name}}(…) has no code, so it shares {{name}}'s default code with every other refusal. Give it its own code: { code: \"<package>.<area>.<refusal>\" }.",
    sharedCode: "Code \"{{code}}\" already names another sentence on line {{line}}. Give each refusal its own code, or keep the shared code and add messageCode."
  }, "refusals-carry-their-own-code"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "app-error-code");
    const localClasses = localErrorClasses(sourceCode.ast, sourceCode);
    const sentences = new Map();
    function checkSharedCode(node, options, message) {
      const codeProperty = options?.type === "ObjectExpression"
        ? options.properties.find((property) => property.type === "Property" && keyName(property) === "code")
        : null;
      const code = literalText(codeProperty?.value);
      const sentence = literalText(message);
      if (code === null || sentence === null || objectHasKey(options, "messageCode")) {
        return;
      }
      const first = sentences.get(code);
      if (!first) {
        sentences.set(code, { sentence, line: node.loc.start.line });
      } else if (first.sentence !== sentence) {
        report(node, "shared-code", "sharedCode", { code, line: first.line });
      }
    }
    return {
      NewExpression(node) {
        const name = node.callee.type === "Identifier" ? node.callee.name : "";
        const kernel = KERNEL_ERRORS[name];
        const local = localClasses.get(name);
        if (kernel) {
          if (!passesCode(node, { code: -1, options: kernel.options })) {
            report(node, "missing-code", "missingCode", { name });
            return;
          }
          checkSharedCode(node, node.arguments[kernel.options], node.arguments[kernel.message]);
          return;
        }
        if (local && !local.ownCode && !passesCode(node, local)) {
          report(node, "missing-code", "missingCode", { name });
        }
      }
    };
  }
});

export { appErrorCode };
