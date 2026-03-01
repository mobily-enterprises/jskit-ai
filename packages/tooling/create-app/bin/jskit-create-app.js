#!/usr/bin/env node
import { runCliEntrypoint } from "../src/shared/cliEntrypoint.js";
import { runCli } from "../src/shared/index.js";

await runCliEntrypoint(runCli);
