import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo, runExtract } from "../pipeline/extract";
import type { SkillRecord } from "../pipeline/lib/schemas";
import { FakeGitHub, type FakeRepo } from "./fakes";
import { makeRepo, skillMd } from "./fixtures";

function acme(): FakeRepo {
  return {
    meta: makeRepo(),
    files: {
      "skills/resume/SKILL.md": skillMd("resume-tailor", "Tailors a resume."),
      "skills/resume/examples.md": "Example",
      "skills/broken/SKILL.md": "# No front matter",
    },
  };
}

const noSave = async (): Promise<void> => {};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractRepo", () => {
  it("returns one record per valid skill and counts invalid ones", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map());
    expect(result.invalid).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      "Invalid SKILL.md front matter: acme/skills:skills/broken",
    );
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      id: "acme/skills:skills/resume",
      repo: "acme/skills",
      path: "skills/resume",
      name: "resume-tailor",
      description: "Tailors a resume.",
      files: ["examples.md"],
    });
    expect(result.skills[0].fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it("does not download a skill whose fingerprint is unchanged", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    gh.fileReads = [];
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills).toEqual(first.skills);
    expect(gh.fileReads).not.toContain("acme/skills/skills/resume/SKILL.md");
  });

  it("downloads again when a file of the skill changes", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    repo.files["skills/resume/examples.md"] = "Changed example";
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills[0].fingerprint).not.toBe(first.skills[0].fingerprint);
  });

  it("keeps the previous record when the download of a changed skill fails", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    repo.files["skills/resume/examples.md"] = "Changed example";
    gh.failFileFor.add("acme/skills/skills/resume/SKILL.md");
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills).toEqual(first.skills);
    expect(second.invalid).toBe(1);
    expect(second.failedDownloads).toBe(1);
  });

  it("counts a failed download without previous record apart from invalid files", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    gh.failFileFor.add("acme/skills/skills/resume/SKILL.md");
    const result = await extractRepo(gh, repo.meta, new Map());
    expect(result.failedDownloads).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.skills).toEqual([]);
  });

  it("drops the previous record of a changed skill that no longer parses", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    repo.files["skills/resume/SKILL.md"] = "# No front matter anymore";
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills).toEqual([]);
    expect(second.invalid).toBe(2);
  });

  function twoSkills(): FakeRepo {
    const repo = acme();
    repo.files["skills/other/SKILL.md"] = skillMd("other-skill", "Does other things.");
    return repo;
  }

  it("keeps previous skills past a truncated listing", async () => {
    const repo = twoSkills();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    expect(first.skills).toHaveLength(2);
    delete repo.files["skills/other/SKILL.md"];
    gh.truncateTreeFor.add("acme/skills");
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.truncated).toBe(true);
    expect(second.skills.map((skill) => skill.id).sort()).toEqual(
      first.skills.map((skill) => skill.id).sort(),
    );
  });

  it("drops a deleted skill when the listing is complete", async () => {
    const repo = twoSkills();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    delete repo.files["skills/other/SKILL.md"];
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills.map((skill) => skill.id)).toEqual(["acme/skills:skills/resume"]);
  });
});

describe("runExtract", () => {
  it("drops skills of repos that are no longer listed", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const stale: SkillRecord = {
      id: "gone/repo:skills/x",
      repo: "gone/repo",
      path: "skills/x",
      name: "x",
      description: "Old",
      fingerprint: "f".repeat(40),
      files: [],
    };
    const { skills, stats } = await runExtract(gh, [repo.meta], [stale], noSave);
    expect(skills.map((skill) => skill.id)).toEqual(["acme/skills:skills/resume"]);
    expect(stats).toMatchObject({ repos: 1, skills: 1, invalid: 1, failedRepos: [] });
  });

  it("keeps the previous records of a repo that fails, and reports it", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await runExtract(gh, [repo.meta], [], noSave);
    gh.failTreeFor.add("acme/skills");
    const second = await runExtract(gh, [repo.meta], first.skills, noSave);
    expect(second.skills).toEqual(first.skills);
    expect(second.stats.failedRepos).toEqual([
      { repo: "acme/skills", error: "network error for acme/skills" },
    ]);
  });

  it("reports a truncated tree", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    gh.truncateTreeFor.add("acme/skills");
    const { stats } = await runExtract(gh, [repo.meta], [], noSave);
    expect(stats.truncatedRepos).toEqual(["acme/skills"]);
  });

  it("sums failed downloads into the stats", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    gh.failFileFor.add("acme/skills/skills/resume/SKILL.md");
    const { stats } = await runExtract(gh, [repo.meta], [], noSave);
    expect(stats.failedDownloads).toBe(1);
  });

  it("warns and drops the records of a repo that no longer has any skill", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await runExtract(gh, [repo.meta], [], noSave);
    repo.files = { "README.md": "Nothing here" };
    const second = await runExtract(gh, [repo.meta], first.skills, noSave);
    expect(second.skills).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "No skill found anymore in acme/skills: its records are dropped",
    );
  });

  it("saves the first repo, then the cumulative sorted list, for two repos", async () => {
    const zed = acme();
    zed.meta = makeRepo({ fullName: "zed/skills", url: "https://github.com/zed/skills" });
    const first = acme();
    const gh = new FakeGitHub([zed, first]);
    const saved: string[][] = [];
    await runExtract(gh, [zed.meta, first.meta], [], async (skills) => {
      saved.push(skills.map((skill) => skill.id));
    });
    expect(saved).toEqual([
      ["zed/skills:skills/resume"],
      ["acme/skills:skills/resume", "zed/skills:skills/resume"],
    ]);
  });

  it("saves progress after each repo", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const saved: number[] = [];
    await runExtract(gh, [repo.meta], [], async (skills) => {
      saved.push(skills.length);
    });
    expect(saved).toEqual([1]);
  });
});
