import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { errorMessage } from "./lib/errors";
import { createGitHubClient } from "./lib/github";
import { createLlmClient } from "./lib/llm";
import { resolvePaths } from "./lib/store";
import { STEPS, type Step, runPipeline } from "./run";

// Local runs read secrets from .env. In GitHub Actions they come from the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false } },
});

const requested =
  positionals.length === 0 || positionals.includes("all") ? [...STEPS] : positionals;
const unknown = requested.filter((name) => !STEPS.includes(name as Step));
if (unknown.length > 0) {
  console.error(`Unknown step: ${unknown.join(", ")}. Use: all, ${STEPS.join(", ")}`);
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.warn("GITHUB_TOKEN is not set: GitHub allows only 60 API requests per hour without it.");
}

const root = process.cwd();
const dryRun = values["dry-run"] ?? false;
try {
  await runPipeline(
    { root, dryRun, steps: requested as Step[] },
    {
      gh: createGitHubClient(process.env.GITHUB_TOKEN),
      getLlm: createLlmClient,
      now: new Date(),
      log: (message) => console.log(message),
    },
  );
  if (requested.includes("summary")) console.log(`Summary file: ${resolvePaths(root, dryRun).summary}`);
} catch (error) {
  console.error(`Pipeline failed: ${errorMessage(error)}`);
  process.exit(1);
}
