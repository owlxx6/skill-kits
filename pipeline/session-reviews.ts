import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { errorMessage } from "./lib/errors";
import { createGitHubClient } from "./lib/github";
import { publication } from "./lib/license";
import {
  ANSWERS_FILE,
  buildReviewPackets,
  importSessionReviews,
  listReviewedFingerprints,
  MANIFEST_FILE,
  readSessionReviewFile,
  RUBRIC_FILE,
  shortlistForKit,
  writeReviewPackets,
} from "./lib/session-reviews";
import { buildCandidateRows, saveSkillFiles, writeCandidates } from "./lib/session-export";
import { readSafetyCache, safetyCleared } from "./lib/skill-safety";
import { ConfigSchema, KitsSchema, RepoMetaSchema, SkillRecordSchema } from "./lib/schemas";
import { readJsonFile, readYamlFile, resolvePaths, writeJsonFile } from "./lib/store";

// Reviews written in a local agent session. Docs: docs/SESSION-REVIEWS.md.
//
//   npx tsx pipeline/session-reviews.ts export --kit resume-career [--limit 25] [--out .session-reviews]
//   npx tsx pipeline/session-reviews.ts export --ids "owner/repo:path,owner/repo:other"
//   npx tsx pipeline/session-reviews.ts import .session-reviews/reviews.json [--replace] [--dry-run]
//   npx tsx pipeline/session-reviews.ts candidates --kits web-app,ui-design [--out .session-reviews/candidates]
//   npx tsx pipeline/session-reviews.ts files "owner/repo:path" [--out .session-reviews/files]

if (existsSync(".env")) process.loadEnvFile(".env");

const USAGE = `Usage:
  session-reviews export --kit <kit id> [--limit 25] [--out .session-reviews]
  session-reviews export --ids <skill id>[,<skill id>...] [--out .session-reviews]
  session-reviews import <answers.json>... [--replace] [--dry-run]
  session-reviews candidates --kits <kit id>[,<kit id>...] [--out .session-reviews/candidates]
  session-reviews files <skill id>... [--out .session-reviews/files]`;

const DEFAULT_OUT = ".session-reviews";
const DEFAULT_LIMIT = 25;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    kit: { type: "string" },
    kits: { type: "string" },
    ids: { type: "string" },
    limit: { type: "string" },
    out: { type: "string", default: DEFAULT_OUT },
    replace: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
const [command, ...args] = positionals;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!["export", "import", "candidates", "files"].includes(command ?? "")) fail(USAGE);
  const root = process.cwd();
  const paths = resolvePaths(root, false);
  const config = await readYamlFile(paths.config, ConfigSchema);
  const kits = await readYamlFile(paths.kits, KitsSchema);
  const repos = await readJsonFile(paths.repos, z.array(RepoMetaSchema), []);
  const skills = await readJsonFile(paths.skills, z.array(SkillRecordSchema), []);
  // The safety reports of the last extraction decide for the skills that need the scan.
  const safetyReports = readSafetyCache(await readJsonFile(paths.safety, z.unknown(), undefined));
  const isSafetyCleared = safetyCleared(safetyReports);
  const ineligibility = (skill: (typeof skills)[number]): string | null => {
    const status = publication(skill, config.filter.allowedLicenses, isSafetyCleared);
    return status.status === "publishable" ? null : status.reason;
  };
  const reviewed = await listReviewedFingerprints(paths.reviewsDir);

  if (command === "candidates") {
    const requested = (values.kits ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (requested.length === 0) fail(`Give --kits <id>[,<id>...]. Kits: ${kits.map((entry) => entry.id).join(", ")}`);
    const out = path.resolve(root, values.out === DEFAULT_OUT ? `${DEFAULT_OUT}/candidates` : (values.out ?? DEFAULT_OUT));
    const rows = buildCandidateRows({
      skills,
      repos,
      kits,
      requested,
      reviewed,
      allowed: config.filter.allowedLicenses,
      safety: safetyReports,
      isSafetyCleared,
    });
    await writeCandidates(out, rows, { generatedAt: new Date().toISOString(), kits: requested });
    console.log(`${rows.length} candidates written to ${out} (candidates.json, candidates.csv)`);
    for (const kit of requested) {
      const own = rows.filter((row) => row.kits.some((entry) => entry.kit === kit));
      const ok = own.filter((row) => row.eligibility.status === "publishable").length;
      console.log(`  ${kit}: ${own.length} mention it, ${ok} publishable now, ${own.filter((row) => row.reviewed).length} already reviewed`);
    }
    return;
  }

  if (command === "files") {
    if (args.length === 0) fail(USAGE);
    const out = path.resolve(root, values.out === DEFAULT_OUT ? `${DEFAULT_OUT}/files` : (values.out ?? DEFAULT_OUT));
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const repoByName = new Map(repos.map((repo) => [repo.fullName, repo]));
    const gh = createGitHubClient(process.env.GITHUB_TOKEN);
    let failures = 0;
    for (const id of args) {
      const skill = byId.get(id);
      const repo = skill ? repoByName.get(skill.repo) : undefined;
      if (!skill || !repo) {
        console.error(`${id}: unknown skill or repository no longer listed`);
        failures += 1;
        continue;
      }
      try {
        const saved = await saveSkillFiles(gh, repo, skill, out);
        console.log(`${id}: ${saved.files.length} files in ${saved.dir}${saved.skipped.length > 0 ? ` (${saved.skipped.length} skipped: see ${skill.fingerprint}.index.json)` : ""}`);
      } catch (error) {
        console.error(`${id}: ${errorMessage(error)}`);
        failures += 1;
      }
    }
    if (failures > 0) process.exit(1);
    return;
  }

  if (command === "export") {
    const out = path.resolve(root, values.out ?? DEFAULT_OUT);
    let selected: typeof skills;
    if (values.ids !== undefined) {
      const wanted = values.ids.split(",").map((id) => id.trim()).filter(Boolean);
      const byId = new Map(skills.map((skill) => [skill.id, skill]));
      const unknown = wanted.filter((id) => !byId.has(id));
      if (unknown.length > 0) fail(`Unknown skill ids: ${unknown.join(", ")}`);
      selected = wanted.map((id) => byId.get(id) as (typeof skills)[number]);
      for (const skill of selected) {
        const why = ineligibility(skill);
        if (why !== null) console.warn(`${skill.id}: cannot be published (${why}), not exported`);
      }
      selected = selected.filter((skill) => ineligibility(skill) === null);
    } else {
      const kit = kits.find((candidate) => candidate.id === values.kit);
      if (!kit) fail(`Give --kit <id> or --ids. Kits: ${kits.map((entry) => entry.id).join(", ")}`);
      const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
      if (!Number.isInteger(limit) || limit < 1) fail("--limit must be a positive integer");
      const shortlist = shortlistForKit(skills, repos, kit, reviewed, (skill) => ineligibility(skill) === null, limit);
      selected = shortlist.map((entry) => entry.skill);
      console.log(`${selected.length} skills shortlisted for ${kit.id} (keyword hits, then stars)`);
    }
    const gh = createGitHubClient(process.env.GITHUB_TOKEN);
    const { packets, failed } = await buildReviewPackets(gh, repos, selected, kits);
    await writeReviewPackets(out, packets, kits, {
      generatedAt: new Date().toISOString(),
      ...(values.kit === undefined ? {} : { kit: values.kit }),
      failed,
    });
    console.log(`${packets.length} packets written to ${out} (${failed.length} failed)`);
    for (const entry of failed) console.warn(`${entry.id}: ${entry.reason}`);
    console.log(`Read ${RUBRIC_FILE} and the packets, then write ${ANSWERS_FILE} (see ${MANIFEST_FILE}).`);
    return;
  }

  if (args.length === 0) fail(USAGE);
  const dryRun = values["dry-run"] ?? false;
  const entries = (await Promise.all(args.map((file) => readSessionReviewFile(path.resolve(root, file))))).flat();
  const results = await importSessionReviews(entries, {
    skills,
    kits,
    ineligibility,
    existing: reviewed,
    replace: values.replace ?? false,
    now: new Date(),
    ...(dryRun
      ? {}
      : { save: (record) => writeJsonFile(path.join(paths.reviewsDir, `${record.fingerprint}.json`), record) }),
  });
  for (const result of results) {
    console.log(`${result.status.padEnd(8)} ${result.id}${result.reason ? `: ${result.reason}` : ""}`);
  }
  const rejected = results.filter((result) => result.status === "rejected").length;
  console.log(`${results.length - rejected} ${dryRun ? "valid" : "saved"}, ${rejected} rejected`);
  if (rejected > 0) process.exit(1);
}

try {
  await main();
} catch (error) {
  console.error(`session-reviews failed: ${errorMessage(error)}`);
  process.exit(1);
}
