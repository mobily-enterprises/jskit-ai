import ts from "typescript";

const SKIPPED_MODIFIERS = new Set([ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword, ts.SyntaxKind.DeclareKeyword]);

function isFunctionLike(node) {
  return Boolean(node) && (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) && Boolean(node.body);
}

function unwrapExpression(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )) {
    current = current.expression;
  }
  return current;
}

// The canonical start (spec Decision 6): the first token of the tree-sitter
// function node, excluding decorators and the export/default wrapper that
// tree-sitter places outside the function node. Leading comments are trivia.
function canonicalStart(node) {
  const sourceFile = node.getSourceFile();
  const modifiers = node.modifiers || [];
  let skippedEnd = -1;
  for (const modifier of modifiers) {
    if (ts.isDecorator(modifier) || SKIPPED_MODIFIERS.has(modifier.kind)) {
      skippedEnd = modifier.end;
      continue;
    }
    return modifier.getStart(sourceFile);
  }
  return skippedEnd < 0 ? node.getStart(sourceFile) : ts.skipTrivia(sourceFile.text, skippedEnd);
}

function point(sourceFile, position) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: line + 1, column: character + 1 };
}

function functionKind(node) {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return "method";
  }
  if (ts.isArrowFunction(node)) {
    return "arrow";
  }
  return ts.isFunctionExpression(node) ? "closure" : "function";
}

function propertyNameText(name, sourceFile) {
  if (!name) {
    return "";
  }
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sourceFile);
}

// The name a function is declared or bound under; "" when anonymous.
function functionName(node) {
  const sourceFile = node.getSourceFile();
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (node.name) {
    return propertyNameText(node.name, sourceFile);
  }
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) {
    parent = parent.parent;
  }
  if (!parent) {
    return "";
  }
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name) {
    return ts.isObjectBindingPattern(parent.name) || ts.isArrayBindingPattern(parent.name) ? "" : propertyNameText(parent.name, sourceFile);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && unwrapExpression(parent.right) === node) {
    const target = parent.left;
    if (ts.isIdentifier(target)) {
      return target.text;
    }
    if (ts.isPropertyAccessExpression(target)) {
      return target.name.text;
    }
  }
  if (ts.isExportAssignment(parent)) {
    return "default";
  }
  return "";
}

// The enclosing class, or the variable an enclosing object literal is bound to.
function functionContainer(node) {
  const parent = ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent) ? node.parent.parent : node.parent;
  if (parent && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) {
    return parent.name?.text || (ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name) ? parent.parent.name.text : undefined);
  }
  if (parent && ts.isObjectLiteralExpression(parent)) {
    let holder = parent.parent;
    while (holder && (ts.isParenthesizedExpression(holder) || ts.isAsExpression(holder) || ts.isCallExpression(holder))) {
      holder = holder.parent;
    }
    if (holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
      return holder.name.text;
    }
  }
  return undefined;
}

function isTopLevelDeclaration(node) {
  if (ts.isFunctionDeclaration(node)) {
    return ts.isSourceFile(node.parent);
  }
  const declaration = node.parent;
  return Boolean(declaration) && ts.isVariableDeclaration(declaration) &&
    declaration.initializer === node &&
    ts.isVariableStatement(declaration.parent?.parent) &&
    ts.isSourceFile(declaration.parent.parent.parent);
}

// Every function-like with a body in one script, plus the file's top-level
// `module` function (`fn:<path>#module`, 1:1 to the end of the file).
// Positions are 1-based and cover the original file.
function collectFileFunctions({ file, hash, sourceFile, checker }) {
  const records = [];
  const nodes = [];
  const end = point(sourceFile, Math.max(1, sourceFile.text.length - (sourceFile.text.endsWith("\n") ? 1 : 0)));
  const moduleRecord = {
    id: `fn:${file}#module`,
    resolution: "resolved",
    file,
    name: "",
    kind: "module",
    start: { line: 1, column: 1 },
    end,
    evidence: [{ path: file, hash, start: { line: 1, column: 1 }, end }]
  };
  const exported = new Set();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? safeAliased(checker, symbol) : symbol;
    for (const declaration of target?.declarations || []) {
      exported.add(declaration);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        exported.add(unwrapExpression(declaration.initializer));
      }
    }
  }
  const visit = (node) => {
    if (isFunctionLike(node)) {
      const startPosition = canonicalStart(node);
      const start = point(sourceFile, startPosition);
      const finish = point(sourceFile, node.end);
      const container = functionContainer(node);
      const record = {
        id: `fn:${file}#${start.line}:${start.column}`,
        resolution: "resolved",
        file,
        name: functionName(node),
        kind: functionKind(node),
        ...(container ? { container } : {}),
        ...(isTopLevelDeclaration(node) && exported.has(node) ? { exported: true } : {}),
        start,
        end: finish,
        evidence: [{ path: file, hash, start, end: finish }]
      };
      records.push(record);
      nodes.push({ node, record, startPosition });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  // An empty file has no code, so no module function either.
  const module = sourceFile.text.length ? moduleRecord : null;
  return { module, functions: module ? [module, ...records] : records, nodes };
}

function safeAliased(checker, symbol) {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

export { collectFileFunctions, isFunctionLike, point, safeAliased, unwrapExpression };
