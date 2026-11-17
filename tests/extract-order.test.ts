import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExtract } from "../pipeline/extract";
import { CHECKPOINT_EVERY, type SafetyCache } from "../pipeline/lib/skill-safety";
import { FakeGitHub, type FakeRepo } from "./fakes";
import { makeRepo, skillMd } from "./fixtures";

function repoWith(fullName: string, count: number, license: string | null): FakeRepo {
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const name = `s${String(index).padStart(3, "0")}`;
    files[`skills/${name}/SKILL.md`] = skillMd(name, `Skill ${name}.`);
  }
  return { meta: makeRepo({ fullName, url: `https://github.com/${fullName}`, license }), files };
}

const noSave = async (): Promise<void> => {};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runExtract order and progress", () => {
  it("reads the repositories with the fewest known skills first, and gives the same result as in any order", async () => {
    const big = repoWith("zeta/big", 30, "MIT");
    const small = repoWith("alpha/small", 2, "MIT");
    const medium = repoWith("mid/medium", 10, "MIT");
    const repos = [big, small, medium];
    const gh = new FakeGitHub(repos);
    const first = await runExtract(gh, repos.map((repo) => repo.meta), [], noSave);

    // A second run knows the sizes: small, medium, big, whatever the order of the list.
    const lines: string[] = [];
    const second = await runExtract(
      gh,
      repos.map((repo) => repo.meta),
      first.skills,
      noSave,
      { cache: {}, save: noSave, allowed: ["MIT"], log: (line) => lines.push(line) },
    );
    expect(lines.map((line) => line.replace(/^\[\d+\/\d+\] /, "").split(":")[0])).toEqual([
      "alpha/small",
      "mid/medium",
      "zeta/big",
    ]);
    expect(lines[0]).toMatch(/^\[1\/3\] alpha\/small: 2 skills$/);
    // Sorted by skill id, not by processing order.
    expect(second.skills.map((skill) => skill.id)).toEqual([...second.skills.map((skill) => skill.id)].sort());
    expect(second.skills.map((skill) => skill.id)).toEqual(first.skills.map((skill) => skill.id));
    expect(second.stats.skills).toBe(42);
  });

  it("saves the records after every repository, so a stop keeps the small ones", async () => {
    const repos = [repoWith("zeta/big", 20, "MIT"), repoWith("alpha/small", 2, "MIT")];
    const gh = new FakeGitHub(repos);
    const known = (await runExtract(gh, repos.map((repo) => repo.meta), [], noSave)).skills;
    const saved: number[] = [];
    // The big repository fails: the small one, read first, is already saved.
    gh.failTreeFor.add("zeta/big");
    await runExtract(gh, repos.map((repo) => repo.meta), known, async (skills) => {
      saved.push(skills.length);
    });
    expect(saved).toEqual([22, 22]);
  });

  it("reports the safety scan of each repository on its line", async () => {
    const repos = [repoWith("acme/unlicensed", 3, null)];
    const lines: string[] = [];
    await runExtract(new FakeGitHub(repos), repos.map((repo) => repo.meta), [], noSave, {
      cache: {},
      save: noSave,
      allowed: ["MIT"],
      safety: { cache: {}, save: noSave },
      log: (line) => lines.push(line),
    });
    expect(lines).toEqual(["[1/1] acme/unlicensed: 3 skills, 3 scanned, 0 reused, 0 not scanned"]);
  });
});

describe("safety checkpoints", () => {
  it("saves the reports during a long repository, one save at a time, and keeps them all", async () => {
    const count = CHECKPOINT_EVERY * 2 + 30;
    const repos = [repoWith("acme/registry", count, null)];
    const gh = new FakeGitHub(repos);
    const cache: SafetyCache = {};
    let running = 0;
    let peak = 0;
    const sizes: number[] = [];
    const save = async (saved: SafetyCache): Promise<void> => {
      running += 1;
      peak = Math.max(peak, running);
      sizes.push(Object.keys(saved).length);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    const { stats } = await runExtract(gh, repos.map((repo) => repo.meta), [], noSave, {
      cache: {},
      save: noSave,
      allowed: ["MIT"],
      safety: { cache, save },
    });
    expect(stats.safety).toMatchObject({ scanned: count, clear: count });
    expect(Object.keys(cache)).toHaveLength(count);
    // At least one save while the repository was still being scanned, then the one after it.
    // Never two at once.
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(peak).toBe(1);
    expect(sizes[0]).toBeGreaterThanOrEqual(CHECKPOINT_EVERY);
    expect(sizes[0]).toBeLessThan(count);
    // Each save held at least as many reports as the one before: progress was kept.
    expect(sizes.every((size, index) => index === 0 || size >= sizes[index - 1])).toBe(true);
    expect(sizes[sizes.length - 1]).toBe(count);
  });

  it("keeps scanning when a checkpoint cannot be saved", async () => {
    const count = CHECKPOINT_EVERY + 10;
    const repos = [repoWith("acme/registry", count, null)];
    const cache: SafetyCache = {};
    let calls = 0;
    const { stats } = await runExtract(new FakeGitHub(repos), repos.map((repo) => repo.meta), [], noSave, {
      cache: {},
      save: noSave,
      allowed: ["MIT"],
      safety: {
        cache,
        save: async () => {
          calls += 1;
          if (calls === 1) throw new Error("disk full");
        },
      },
    });
    expect(stats.safety?.scanned).toBe(count);
    expect(Object.keys(cache)).toHaveLength(count);
    expect(console.warn).toHaveBeenCalledWith("Safety reports not saved yet: disk full");
  });
});
