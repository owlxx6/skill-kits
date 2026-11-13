import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";

export async function readYamlFile<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(file, "utf8");
  const result = schema.safeParse(parseYaml(raw));
  if (!result.success) throw new Error(`${file} is invalid: ${result.error.message}`);
  return result.data;
}

export async function readJsonFile<T>(file: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  const result = schema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error(`${file} is invalid: ${result.error.message}`);
  return result.data;
}

export async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export interface Paths {
  sources: string;
  kits: string;
  config: string;
  curation: string;
  candidates: string;
  repos: string;
  skills: string;
  triage: string;
  reviewsDir: string;
  runInfo: string;
  catalog: string;
  summary: string;
}

// A dry run writes everything under .dry-run/ so it never touches the committed cache.
export function resolvePaths(root: string, dryRun: boolean): Paths {
  const data = path.join(root, "data");
  const out = dryRun ? path.join(root, ".dry-run") : root;
  const cache = dryRun ? path.join(out, "cache") : path.join(data, "cache");
  return {
    sources: path.join(data, "sources.yaml"),
    kits: path.join(data, "kits.yaml"),
    config: path.join(data, "config.yaml"),
    curation: path.join(data, "curation.yaml"),
    candidates: path.join(cache, "candidates.json"),
    repos: path.join(cache, "repos.json"),
    skills: path.join(cache, "skills.json"),
    triage: path.join(cache, "triage.json"),
    reviewsDir: path.join(cache, "reviews"),
    runInfo: path.join(out, "pipeline-run.json"),
    catalog: path.join(out, "catalog.json"),
    summary: path.join(out, "pipeline-summary.md"),
  };
}
