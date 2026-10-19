#!/usr/bin/env node
import { main } from "../src/release.mjs";

main().catch((error) => {
  process.stderr.write(`jskit-release failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
