import ts from "typescript";
import { isFunctionLike, safeAliased, unwrapExpression } from "./functions.js";

const MAX_DEPTH = 8;

function isClassLike(node) {
  return Boolean(node) && (ts.isClassDeclaration(node) || ts.isClassExpression(node));
}

function isBareSpecifier(specifier) {
  return typeof specifier === "string" && !specifier.startsWith(".") && !specifier.startsWith("/");
}

// Symbol and declaration helpers over one loaded call program.
function createSymbols(context) {
  const { checker, fileOf, resolveImport } = context;

  function symbolAt(node) {
    if (!node) {
      return undefined;
    }
    const parent = node.parent;
    if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return checker.getShorthandAssignmentValueSymbol(parent);
    }
    return checker.getSymbolAtLocation(node);
  }

  function resolved(symbol) {
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? safeAliased(checker, symbol) : symbol;
  }

  function declarationOf(node) {
    const symbol = resolved(symbolAt(node));
    return symbol?.valueDeclaration || symbol?.declarations?.[0] || null;
  }

  // The import an identifier is bound to: { specifier, imported }, or null.
  function importOf(identifier) {
    const symbol = symbolAt(identifier);
    if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) {
      return null;
    }
    const declaration = symbol.declarations?.[0];
    if (!declaration) {
      return null;
    }
    let importDeclaration = declaration;
    while (importDeclaration && !ts.isImportDeclaration(importDeclaration)) {
      importDeclaration = importDeclaration.parent;
    }
    if (!importDeclaration || !ts.isStringLiteralLike(importDeclaration.moduleSpecifier)) {
      return null;
    }
    let imported = "default";
    if (ts.isImportSpecifier(declaration)) {
      imported = (declaration.propertyName || declaration.name).text;
    } else if (ts.isNamespaceImport(declaration)) {
      imported = "*";
    }
    return { specifier: importDeclaration.moduleSpecifier.text, imported, file: fileOf(declaration) };
  }

  // A package import that does not resolve to declared project source.
  function isPackageImport(identifier) {
    const binding = importOf(identifier);
    return Boolean(binding) && isBareSpecifier(binding.specifier) && !resolveImport(binding.file, binding.specifier);
  }

  function isImportOf(identifier, packagePrefix, names) {
    const binding = importOf(identifier);
    return Boolean(binding) &&
      (binding.specifier === packagePrefix || binding.specifier.startsWith(`${packagePrefix}/`)) &&
      names.includes(binding.imported);
  }

  // The project function (or class) a declaration ultimately names.
  function declarationImplementations(declaration, depth = 0) {
    if (!declaration || depth > MAX_DEPTH) {
      return [];
    }
    if (isFunctionLike(declaration) || isClassLike(declaration)) {
      return fileOf(declaration) ? [declaration] : [];
    }
    if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration)) {
      return expressionImplementations(declaration.initializer, depth + 1);
    }
    if (ts.isShorthandPropertyAssignment(declaration)) {
      return symbolImplementations(checker.getShorthandAssignmentValueSymbol(declaration), depth + 1);
    }
    if (ts.isExportSpecifier(declaration) || ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)) {
      return symbolImplementations(checker.getSymbolAtLocation(declaration.name), depth + 1);
    }
    if (ts.isExportAssignment(declaration)) {
      return expressionImplementations(declaration.expression, depth + 1);
    }
    if (ts.isBinaryExpression(declaration) && declaration.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return expressionImplementations(declaration.right, depth + 1);
    }
    if ((ts.isPropertyAccessExpression(declaration) || ts.isElementAccessExpression(declaration)) &&
      ts.isBinaryExpression(declaration.parent) && declaration.parent.left === declaration) {
      return expressionImplementations(declaration.parent.right, depth + 1);
    }
    return [];
  }

  function expressionImplementations(expression, depth) {
    const value = unwrapExpression(expression);
    if (!value || depth > MAX_DEPTH) {
      return [];
    }
    if (isFunctionLike(value) || isClassLike(value)) {
      return fileOf(value) ? [value] : [];
    }
    if (ts.isIdentifier(value)) {
      return symbolImplementations(symbolAt(value), depth + 1);
    }
    if (ts.isPropertyAccessExpression(value)) {
      return symbolImplementations(checker.getSymbolAtLocation(value.name), depth + 1);
    }
    if (ts.isCallExpression(value)) {
      // A factory-returned closure: `fileArea: createFileArea(service)`.
      const declaration = checker.getTypeAtLocation(value).getSymbol()?.valueDeclaration;
      return declaration && isFunctionLike(declaration) && fileOf(declaration) ? [declaration] : [];
    }
    return [];
  }

  function symbolImplementations(symbol, depth = 0) {
    const target = resolved(symbol);
    const found = new Set();
    for (const declaration of target?.declarations || []) {
      for (const implementation of declarationImplementations(declaration, depth)) {
        found.add(implementation);
      }
    }
    return [...found];
  }

  // Whether a symbol's declarations all live in TypeScript's default libraries.
  function isLibrarySymbol(symbol) {
    const target = resolved(symbol);
    const declarations = target?.declarations || [];
    return declarations.length > 0 && declarations.every((declaration) => context.isLibrary(declaration));
  }

  // The leftmost identifier of a receiver chain, through calls and member access.
  function receiverRoot(expression) {
    let current = unwrapExpression(expression);
    while (current) {
      if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        current = unwrapExpression(current.expression);
      } else if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
        current = unwrapExpression(current.expression);
      } else if (ts.isAwaitExpression(current)) {
        current = unwrapExpression(current.expression);
      } else {
        return current;
      }
    }
    return null;
  }

  return {
    symbolAt,
    resolved,
    declarationOf,
    importOf,
    isPackageImport,
    isImportOf,
    symbolImplementations,
    expressionImplementations,
    isLibrarySymbol,
    receiverRoot
  };
}

export { createSymbols, isClassLike };
