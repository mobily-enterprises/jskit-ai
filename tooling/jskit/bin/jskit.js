#!/usr/bin/env node
import { runCliEntrypoint } from "../src/server/cliEntrypoint.js";
import { runCli } from "../src/server/index.js";

await runCliEntrypoint(runCli);
