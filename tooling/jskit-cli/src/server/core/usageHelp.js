import {
  listOverviewCommandDescriptors,
  resolveCommandDescriptor,
  shouldShowCommandHelpOnBareInvocation
} from "./commandCatalog.js";
import {
  createColorFormatter,
  writeWrappedLines
} from "../shared/outputFormatting.js";

function appendSeparatedBlocks(lines = [], blocks = []) {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  for (const [index, block] of normalizedBlocks.entries()) {
    if (index > 0) {
      lines.push("");
    }
    const lineList = Array.isArray(block) ? block : [block];
    for (const line of lineList) {
      lines.push(line);
    }
  }
}

function writeHelpLines(stream, lines = []) {
  writeWrappedLines({
    stdout: stream,
    lines
  });
}

function printTopLevelHelp(stream = process.stderr) {
  const color = createColorFormatter(stream);
  const lines = [];
  lines.push(color.heading("JSKit CLI"));
  lines.push("");
  lines.push("Use: jskit help <command> for command-specific usage.");
  lines.push("");
  lines.push(color.heading("Available commands:"));
  for (const entry of listOverviewCommandDescriptors()) {
    lines.push(`  ${color.item(entry.command.padEnd(16, " "))} ${entry.summary}`);
  }
  lines.push("");
  lines.push(color.heading("Generator quick starts:"));
  lines.push("  substantial non-CRUD server feature:");
  lines.push(`    ${color.item("jskit generate feature-server-generator scaffold booking-engine")}`);
  lines.push("  non-persistent workflow/orchestrator:");
  lines.push(`    ${color.item("jskit generate feature-server-generator scaffold availability-engine --mode orchestrator")}`);
  writeHelpLines(stream, lines);
}

function printCommandHelp(stream = process.stderr, command = "") {
  const entry = resolveCommandDescriptor(command);
  if (!entry) {
    printTopLevelHelp(stream);
    return;
  }

  const color = createColorFormatter(stream);
  const lines = [];
  lines.push(`Command: ${color.emphasis(entry.command)}`);
  lines.push("");

  let sectionNumber = 1;

  lines.push(color.heading(`${sectionNumber++}) Minimal use`));
  lines.push(`   ${entry.minimalUse}`);
  if (entry.parameters.length > 0) {
    lines.push(color.heading("   Parameters:"));
    appendSeparatedBlocks(
      lines,
      entry.parameters.map((parameter) => `   - ${parameter.name}: ${parameter.description}`)
    );
  }
  lines.push("");

  lines.push(color.heading(`${sectionNumber++}) Defaults`));
  appendSeparatedBlocks(
    lines,
    entry.defaults.map((defaultLine) => `   - ${defaultLine}`)
  );
  lines.push("");

  const examples = Array.isArray(entry.examples) ? entry.examples : [];
  if (examples.length > 0) {
    lines.push(color.heading(`${sectionNumber++}) Examples`));
    appendSeparatedBlocks(
      lines,
      examples.map((example) => {
        const block = [];
        const label = String(example?.label || "").trim();
        if (label) {
          block.push(`   - ${color.item(label)}`);
        }
        for (const line of Array.isArray(example?.lines) ? example.lines : []) {
          block.push(`     ${line}`);
        }
        return block;
      })
    );
    lines.push("");
  }

  lines.push(color.heading(`${sectionNumber++}) Full use`));
  lines.push(`   ${entry.fullUse}`);
  writeHelpLines(stream, lines);
}

function printUsage(stream = process.stderr, { command = "" } = {}) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    printTopLevelHelp(stream);
    return;
  }

  printCommandHelp(stream, normalizedCommand);
}

export {
  printUsage,
  shouldShowCommandHelpOnBareInvocation
};
