import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonFile, readYamlFile, resolvePaths, writeJsonFile } from "../pipeline/lib/store";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-kits-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("resolvePaths", () => {
  const root = "/some/root";

  it("keeps the YAML inputs identical in dry-run and real mode", () => {
    const dry = resolvePaths(root, true);
    const real = resolvePaths(root, false);
    for (const key of ["sources", "kits", "config", "curation"] as const) {
      expect(dry[key]).toBe(real[key]);
    }
  });

  it("puts every other dry-run path under .dry-run", () => {
    const dry = resolvePaths(root, true);
    const inputs = ["sources", "kits", "config", "curation"];
    for (const [key, value] of Object.entries(dry)) {
      if (inputs.includes(key)) continue;
      expect(value.startsWith(path.join(root, ".dry-run"))).toBe(true);
    }
  });

  it("uses data/cache for the cache and root for outputs in real mode", () => {
    const real = resolvePaths(root, false);
    const cache = path.join(root, "data", "cache");
    for (const key of ["candidates", "repos", "skills", "triage", "reviewsDir", "kitsHash"] as const) {
      expect(real[key].startsWith(cache)).toBe(true);
    }
    for (const key of ["catalog", "summary", "runInfo"] as const) {
      expect(path.dirname(real[key])).toBe(root);
    }
  });

  it("keeps the license cache in data/cache, and a dry run in its own cache folder", () => {
    expect(resolvePaths(root, false).licenses).toBe(path.join(root, "data", "cache", "licenses.json"));
    expect(resolvePaths(root, true).licenses).toBe(path.join(root, ".dry-run", "cache", "licenses.json"));
  });
});

describe("json and yaml files", () => {
  const schema = z.object({ a: z.number(), b: z.array(z.string()) });

  it("round-trips through a nested folder and leaves no .tmp file", async () => {
    const root = await makeRoot();
    const dir = path.join(root, "x", "y");
    const file = path.join(dir, "data.json");
    await writeJsonFile(file, { a: 1, b: ["z"] });
    expect(await readJsonFile(file, schema, { a: 0, b: [] })).toEqual({ a: 1, b: ["z"] });
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("returns the fallback when the file is missing", async () => {
    const root = await makeRoot();
    const fallback = { a: 0, b: [] };
    expect(await readJsonFile(path.join(root, "nope.json"), schema, fallback)).toEqual(fallback);
  });

  it("names the file when the JSON is malformed", async () => {
    const root = await makeRoot();
    const file = path.join(root, "bad.json");
    await writeFile(file, "{ not json", "utf8");
    const error = await readJsonFile(file, schema, { a: 0, b: [] }).catch((e: Error) => e);
    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toContain("is not valid JSON");
  });

  it("names the file when the YAML is malformed", async () => {
    const root = await makeRoot();
    await mkdir(root, { recursive: true });
    const file = path.join(root, "bad.yaml");
    await writeFile(file, "key: [unclosed", "utf8");
    const error = await readYamlFile(file, schema).catch((e: Error) => e);
    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toContain("is not valid YAML");
  });
});
