#!/usr/bin/env node
import { runVoiceCli } from "../src/cli.js";

runVoiceCli().catch((error) => {
  process.stderr.write(`[assistant-voice] ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
