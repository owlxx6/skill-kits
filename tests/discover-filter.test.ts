import { describe, expect, it } from "vitest";
import { discover } from "../pipeline/discover";
import { checkRepo, filterRepos } from "../pipeline/filter";
import { FakeGitHub } from "./fakes";
import { NOW, makeRepo, testConfig } from "./fixtures";

const filter = testConfig.filter;

describe("discover", () => {
  it("merges seed repos and topic results without duplicates", async () => {
    const gh = new FakeGitHub([], { "agent-skills": ["acme/skills", "Other/Repo"] });
    const sources = {
      repos: ["Acme/Skills", "solo/one"],
      topics: ["agent-skills"],
      maxSearchPages: 1,
    };
    expect(await discover(gh, sources, 50, false)).toEqual([
      "Acme/Skills",
      "solo/one",
      "Other/Repo",
    ]);
  });

  it("never searches topics in a dry run", async () => {
    const gh = new FakeGitHub([], { "agent-skills": ["topic/repo"] });
    await discover(gh, { repos: ["a/1"], topics: ["agent-skills"], maxSearchPages: 1 }, 50, true);
    expect(gh.searchCalls).toEqual([]);
  });

  it("uses only the first five seed repos in a dry run", async () => {
    const gh = new FakeGitHub([], { "agent-skills": ["topic/repo"] });
    const sources = {
      repos: ["a/1", "a/2", "a/3", "a/4", "a/5", "a/6"],
      topics: ["agent-skills"],
      maxSearchPages: 1,
    };
    expect(await discover(gh, sources, 50, true)).toEqual(["a/1", "a/2", "a/3", "a/4", "a/5"]);
  });
});

describe("checkRepo", () => {
  it("accepts a permissive, active, popular repo", () => {
    expect(checkRepo(makeRepo(), filter, NOW)).toEqual({ ok: true });
  });

  it.each([
    [{ archived: true }, "archived"],
    [{ license: null }, "license none not allowed"],
    [{ license: "GPL-3.0" }, "license GPL-3.0 not allowed"],
    [{ stars: 49 }, "stars 49 < 50"],
    [{ pushedAt: "2026-01-01T00:00:00Z" }, "last push 314 days ago (limit 180)"],
    [{ pushedAt: "" }, "no valid push date"],
    [{ pushedAt: "2026-11-05" }, "no valid push date"],
    [{ license: "NOASSERTION" }, "license NOASSERTION not allowed"],
    [{ license: "mit" }, "license mit not allowed"],
  ])("rejects %j", (overrides, reason) => {
    expect(checkRepo(makeRepo(overrides), filter, NOW)).toEqual({ ok: false, reason });
  });
});

describe("checkRepo boundaries", () => {
  it.each([
    ["exactly the minimum stars", { stars: 50 }],
    ["a push exactly 180 days before now", { pushedAt: "2026-05-15T00:00:00Z" }],
    ["a push dated after now", { pushedAt: "2026-11-12T00:00:00Z" }],
  ])("keeps %s", (_label, overrides) => {
    expect(checkRepo(makeRepo(overrides), filter, NOW)).toEqual({ ok: true });
  });
});

describe("filterRepos", () => {
  it("keeps valid repos, reports the others, and ignores duplicates", async () => {
    const gh = new FakeGitHub([
      { meta: makeRepo(), files: {} },
      { meta: makeRepo({ fullName: "old/archived", archived: true }), files: {} },
    ]);
    const result = await filterRepos(
      gh,
      ["acme/skills", "ACME/skills", "old/archived", "ghost/deleted"],
      filter,
      NOW,
    );
    expect(result.repos.map((repo) => repo.fullName)).toEqual(["acme/skills"]);
    expect(result.filtered).toEqual([
      { fullName: "ghost/deleted", reason: "not found" },
      { fullName: "old/archived", reason: "archived" },
    ]);
  });

  it("names the candidate when getRepo throws", async () => {
    const gh = new FakeGitHub([{ meta: makeRepo(), files: {} }]);
    gh.failRepoFor.add("Broken/Repo");
    await expect(filterRepos(gh, ["acme/skills", "broken/repo"], filter, NOW)).rejects.toThrow(
      "filter: getRepo broken/repo failed: network error for broken/repo",
    );
  });

  it("does not report a redirect to an already-seen repository", async () => {
    const gh = new FakeGitHub([{ meta: makeRepo(), files: {} }], {}, { "old/name": "acme/skills" });
    const result = await filterRepos(gh, ["acme/skills", "old/name"], filter, NOW);
    expect(result.repos.map((repo) => repo.fullName)).toEqual(["acme/skills"]);
    expect(result.filtered).toEqual([]);
  });

  it("reports a rejected renamed repository with its listed name", async () => {
    const gh = new FakeGitHub(
      [{ meta: makeRepo({ fullName: "new/home", archived: true }), files: {} }],
      {},
      { "old/name": "new/home" },
    );
    const result = await filterRepos(gh, ["old/name"], filter, NOW);
    expect(result.filtered).toEqual([
      { fullName: "new/home (listed as old/name)", reason: "archived" },
    ]);
  });
});
