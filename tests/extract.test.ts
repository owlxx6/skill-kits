import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo, runExtract } from "../pipeline/extract";
import type { LicenseCache, SkillRecord } from "../pipeline/lib/schemas";
import { FakeGitHub, type FakeRepo, blobIdOf } from "./fakes";
import { makeRepo, skillMd } from "./fixtures";
import { APACHE_TEXT, CUSTOM_TEXT, MIT_TEXT } from "./license-texts";

const blobOf = blobIdOf;

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

  it("skips a skill folder whose name could break Markdown and counts it as invalid", async () => {
    const repo = acme();
    const unsafeDir = `skills/bad${"`"}name`;
    repo.files[`${unsafeDir}/SKILL.md`] = skillMd("bad", "Unsafe folder.");
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map());
    expect(result.skills.map((skill) => skill.id)).toEqual(["acme/skills:skills/resume"]);
    expect(result.invalid).toBe(2);
    expect(warn).toHaveBeenCalledWith("Unsafe skill folder name skipped in acme/skills");
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
    // The record stays, but its license was not re-read for the changed content.
    expect(second.skills.map(({ license: _license, ...rest }) => rest)).toEqual(
      first.skills.map(({ license: _license, ...rest }) => rest),
    );
    expect(second.skills[0].license).toMatchObject({ outcome: "ambiguous", unread: "skill-file" });
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

  it("does not restore a listed skill that no longer parses, even when truncated", async () => {
    const repo = twoSkills();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map());
    expect(first.skills).toHaveLength(2);
    repo.files["skills/other/SKILL.md"] = "# No front matter anymore";
    gh.truncateTreeFor.add("acme/skills");
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known);
    expect(second.skills.map((skill) => skill.id)).toEqual(["acme/skills:skills/resume"]);
    // skills/broken was already invalid in the first pass, skills/other is now invalid too.
    expect(second.invalid).toBe(2);
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

describe("license resolution during extraction", () => {
  const resumeId = "acme/skills:skills/resume";
  const resumeOf = (skills: SkillRecord[]): SkillRecord | undefined =>
    skills.find((skill) => skill.id === resumeId);

  function licensed(): FakeRepo {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files["skills/resume/LICENSE"] = MIT_TEXT;
    return repo;
  }

  it("resolves the license of a new record and caches the identified text", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    const cache: LicenseCache = {};
    const result = await extractRepo(gh, repo.meta, new Map(), cache);
    const tree = await gh.getTree("acme/skills");
    expect(resumeOf(result.skills)?.license).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "skill",
      revision: tree.sha,
      evidence: [
        {
          kind: "file",
          level: "skill",
          path: "skills/resume/LICENSE",
          blob: blobOf(MIT_TEXT),
          status: "identified",
          spdx: "MIT",
        },
      ],
    });
    expect(cache).toEqual({ [blobOf(MIT_TEXT)]: { kind: "spdx", spdx: "MIT" } });
  });

  it("uses the front matter license of a new record", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files["skills/resume/SKILL.md"] =
      "---\nname: resume-tailor\ndescription: Tailors a resume.\nlicense: Apache-2.0\n---\nBody\n";
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map(), {});
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "identified", spdx: "Apache-2.0", level: "skill" });
  });

  it("resolves again a reused record whose fingerprint is unchanged, keeping its front matter", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files["skills/resume/SKILL.md"] =
      "---\nname: resume-tailor\ndescription: Tailors a resume.\nlicense: Complete terms in LICENSE.txt\n---\nBody\n";
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map(), {});
    expect(resumeOf(first.skills)?.license?.outcome).toBe("ambiguous");
    // An ancestor license appears: the skill folder, and so its fingerprint, does not change.
    repo.files["skills/LICENSE"] = MIT_TEXT;
    gh.fileReads = [];
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known, {});
    const resume = resumeOf(second.skills);
    expect(resume?.fingerprint).toBe(resumeOf(first.skills)?.fingerprint);
    expect(gh.fileReads).not.toContain("acme/skills/skills/resume/SKILL.md");
    // The front matter still points to a missing LICENSE.txt: the skill level decides.
    expect(resume?.license).toMatchObject({ outcome: "ambiguous", level: "skill" });
    expect(resume?.license?.evidence).toContainEqual({
      kind: "file",
      level: "ancestor",
      path: "skills/LICENSE",
      blob: blobOf(MIT_TEXT),
      status: "identified",
      spdx: "MIT",
    });
  });

  it("identifies again a changed ancestor license while the skill fingerprint is unchanged", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files["skills/LICENSE"] = MIT_TEXT;
    const gh = new FakeGitHub([repo]);
    const cache: LicenseCache = {};
    const first = await extractRepo(gh, repo.meta, new Map(), cache);
    expect(resumeOf(first.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT", level: "ancestor" });

    repo.files["skills/LICENSE"] = CUSTOM_TEXT;
    gh.fileReads = [];
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known, cache);
    expect(resumeOf(second.skills)?.fingerprint).toBe(resumeOf(first.skills)?.fingerprint);
    expect(gh.fileReads).toContain("acme/skills/skills/LICENSE");
    expect(gh.fileReads).not.toContain("acme/skills/skills/resume/SKILL.md");
    expect(resumeOf(second.skills)?.license).toMatchObject({ outcome: "custom", level: "ancestor" });
    expect(cache[blobOf(CUSTOM_TEXT)]).toEqual({ kind: "unknown" });
  });

  it("identifies again a changed root license while the skill fingerprint is unchanged", async () => {
    const repo = acme();
    repo.files.LICENSE = MIT_TEXT; // GitHub detects MIT for makeRepo()
    const gh = new FakeGitHub([repo]);
    const cache: LicenseCache = {};
    const first = await extractRepo(gh, repo.meta, new Map(), cache);
    expect(resumeOf(first.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT", level: "repository" });
    repo.files.LICENSE = APACHE_TEXT;
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known, cache);
    // The new root text disagrees with GitHub's detection, which has not caught up yet.
    expect(resumeOf(second.skills)?.license).toMatchObject({ outcome: "ambiguous", level: "repository" });
  });

  it("does not download a license text whose blob id is cached", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map(), {
      [blobOf(MIT_TEXT)]: { kind: "spdx", spdx: "MIT" },
    });
    expect(gh.fileReads).not.toContain("acme/skills/skills/resume/LICENSE");
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT" });
  });

  it("downloads a root license shared by several skills once", async () => {
    const repo = acme();
    repo.files["skills/other/SKILL.md"] = skillMd("other-skill", "Does other things.");
    repo.files.LICENSE = MIT_TEXT;
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map(), {});
    expect(gh.fileReads.filter((read) => read === "acme/skills/LICENSE")).toHaveLength(1);
    expect(result.skills.map((skill) => skill.license)).toMatchObject([
      { outcome: "identified", spdx: "MIT" },
      { outcome: "identified", spdx: "MIT" },
    ]);
  });

  it("reports a license file that cannot be downloaded as not re-read, without caching it", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    gh.failFileFor.add("acme/skills/skills/resume/LICENSE");
    const cache: LicenseCache = {};
    const result = await extractRepo(gh, repo.meta, new Map(), cache);
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "ambiguous", level: "skill", unread: "license-file" });
    expect(result.licenseFailedDownloads).toBe(1);
    expect(result.failedDownloads).toBe(0);
    expect(cache).toEqual({});
  });

  it("does not cache or use a downloaded text whose blob id differs from the listed one", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    // The branch moved between the listing and the download.
    gh.serveInstead.set("acme/skills/skills/resume/LICENSE", APACHE_TEXT);
    const cache: LicenseCache = {};
    const result = await extractRepo(gh, repo.meta, new Map(), cache);
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "ambiguous", unread: "license-file" });
    expect(result.licenseFailedDownloads).toBe(1);
    expect(cache).toEqual({});
  });

  it("checks the blob id on the raw bytes, a BOM and CRLF line endings included", async () => {
    const repo = licensed();
    repo.files["skills/resume/LICENSE"] = `\uFEFF${MIT_TEXT.replace(/\n/g, "\r\n")}`;
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map(), {});
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT" });
  });

  it("follows a symbolic license file to its target inside the repository", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files.LICENSE = MIT_TEXT;
    repo.links = { "skills/resume/LICENSE": "../../LICENSE" };
    const gh = new FakeGitHub([repo]);
    const cache: LicenseCache = {};
    const result = await extractRepo(gh, repo.meta, new Map(), cache);
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    expect(cache).toEqual({ [blobOf(MIT_TEXT)]: { kind: "spdx", spdx: "MIT" } });
  });

  it("reports a symbolic license file pointing outside the repository as not re-read", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.links = { "skills/resume/LICENSE": "../../../LICENSE" };
    const gh = new FakeGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map(), {});
    expect(resumeOf(result.skills)?.license).toMatchObject({ outcome: "ambiguous", unread: "license-file" });
    expect(result.licenseFailedDownloads).toBe(1);
  });

  it("downloads again the SKILL.md of an unchanged record written before license resolution", async () => {
    const repo = acme();
    repo.meta = makeRepo({ license: null });
    repo.files["skills/resume/SKILL.md"] =
      "---\nname: resume-tailor\ndescription: Tailors a resume.\nlicense: Proprietary\n---\nBody\n";
    repo.files.LICENSE = MIT_TEXT;
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map(), {});
    const old = first.skills.map(({ license: _license, ...rest }) => rest);
    gh.fileReads = [];
    const second = await extractRepo(gh, repo.meta, new Map(old.map((skill) => [skill.id, skill])), {});
    expect(gh.fileReads).toContain("acme/skills/skills/resume/SKILL.md");
    // Without the front matter, the root file would wrongly decide.
    expect(resumeOf(second.skills)?.license).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it("drops the license of a changed record whose SKILL.md cannot be downloaded", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map(), {});
    repo.files["skills/resume/examples.md"] = "Changed example";
    repo.files["skills/resume/LICENSE"] = APACHE_TEXT;
    gh.failFileFor.add("acme/skills/skills/resume/SKILL.md");
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known, {});
    const tree = await gh.getTree("acme/skills");
    expect(resumeOf(second.skills)).toEqual({
      ...resumeOf(first.skills),
      license: { outcome: "ambiguous", level: "none", unread: "skill-file", evidence: [], revision: tree.sha },
    });
  });

  it("reads the SKILL.md again for a record whose license was not re-read, even with an unchanged fingerprint", async () => {
    const repo = licensed();
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map(), {});
    const stale = first.skills.map((skill) => ({
      ...skill,
      license: { outcome: "ambiguous" as const, level: "none" as const, unread: "skill-file" as const, evidence: [] },
    }));
    gh.fileReads = [];
    const second = await extractRepo(gh, repo.meta, new Map(stale.map((skill) => [skill.id, skill])), {});
    expect(gh.fileReads).toContain("acme/skills/skills/resume/SKILL.md");
    expect(resumeOf(second.skills)?.license).toMatchObject({ outcome: "identified", spdx: "MIT" });
  });

  it("resolves listed skills of a truncated tree and keeps records past the cut as they were", async () => {
    const repo = acme();
    repo.files["skills/other/SKILL.md"] = skillMd("other-skill", "Does other things.");
    const gh = new FakeGitHub([repo]);
    const first = await extractRepo(gh, repo.meta, new Map(), {});
    const other = first.skills.find((skill) => skill.id === "acme/skills:skills/other");
    expect(other?.license?.outcome).toBe("identified");
    delete repo.files["skills/other/SKILL.md"];
    gh.truncateTreeFor.add("acme/skills");
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    const second = await extractRepo(gh, repo.meta, known, {});
    // Listed, no skill-level evidence, truncated: ambiguous.
    expect(resumeOf(second.skills)?.license).toMatchObject({ outcome: "ambiguous", level: "none" });
    expect(second.skills.find((skill) => skill.id === "acme/skills:skills/other")).toEqual(other);
  });
});

describe("runExtract licenses", () => {
  it("saves the license cache after each repository and counts outcomes", async () => {
    const mit = acme();
    mit.meta = makeRepo({ license: null });
    mit.files["skills/resume/LICENSE"] = MIT_TEXT;
    const gpl = acme();
    gpl.meta = makeRepo({ fullName: "gpl/skills", url: "https://github.com/gpl/skills", license: "GPL-3.0" });
    const none = acme();
    none.meta = makeRepo({ fullName: "none/skills", url: "https://github.com/none/skills", license: null });
    const gh = new FakeGitHub([mit, gpl, none]);
    const cache: LicenseCache = {};
    const saved: string[][] = [];
    const { stats } = await runExtract(gh, [mit.meta, gpl.meta, none.meta], [], async () => {}, {
      cache,
      save: async (current) => {
        saved.push(Object.keys(current));
      },
      allowed: ["MIT"],
    });
    expect(saved).toEqual([[blobOf(MIT_TEXT)]]);
    expect(stats.licenses).toEqual({
      identifiedAllowed: 1,
      identifiedNotAllowed: 1,
      custom: 0,
      ambiguous: 0,
      missing: 1,
      notReRead: 0,
      unresolved: 0,
      failedDownloads: 0,
    });
  });

  it("keeps the previous license of the records of a repository that fails", async () => {
    const repo = acme();
    const gh = new FakeGitHub([repo]);
    const first = await runExtract(gh, [repo.meta], [], noSave);
    const old = first.skills.map(({ license: _license, ...rest }) => rest);
    gh.failTreeFor.add("acme/skills");
    const second = await runExtract(gh, [repo.meta], old, noSave, {
      cache: {},
      save: async () => {},
      allowed: ["MIT"],
    });
    expect(second.skills).toEqual(old);
    expect(second.stats.licenses).toMatchObject({ unresolved: 1, identifiedAllowed: 0 });
  });

  it("counts failed license downloads", async () => {
    const repo = acme();
    repo.files.LICENSE = MIT_TEXT;
    const gh = new FakeGitHub([repo]);
    gh.failFileFor.add("acme/skills/LICENSE");
    const { stats } = await runExtract(gh, [repo.meta], [], noSave);
    expect(stats.licenses).toMatchObject({ failedDownloads: 1, notReRead: 1, ambiguous: 0 });
    expect(stats.failedRepos).toEqual([]);
  });
});
