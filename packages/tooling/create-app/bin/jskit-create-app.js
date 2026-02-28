#!/usr/bin/env node
import { runCliEntrypoint } from "@jskit-ai/cli-entrypoint";
import { runCli } from "../src/shared/index.js";

await runCliEntrypoint(runCli);
