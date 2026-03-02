function parseImportSpecifiers(sourceText) {
  const specifiers = [];
  const importExportPattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of sourceText.matchAll(importExportPattern)) {
    specifiers.push(String(match[1] || ""));
  }

  for (const match of sourceText.matchAll(dynamicImportPattern)) {
    specifiers.push(String(match[1] || ""));
  }

  return specifiers;
}

export { parseImportSpecifiers };
