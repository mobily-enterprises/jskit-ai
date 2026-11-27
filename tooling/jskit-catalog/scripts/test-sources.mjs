// The test-source part of plain `jskit check` (not written yet).

/** @param {{ projectRoot: string }} _input */
async function checkTestSources(_input) {
  return { ok: true, findings: [], files: 0 };
}

function formatTestSourcesReport(result) {
  return `JSKIT test sources: ${result.files} file(s) read.`;
}

export { checkTestSources, formatTestSourcesReport };
