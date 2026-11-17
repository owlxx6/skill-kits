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

  it("drops excluded repositories, whatever their letter case", async () => {
    const gh = new FakeGitHub([], { "agent-skills": ["big/Registry", "acme/skills"] });
    const sources = {
      repos: ["solo/one"],
      topics: ["agent-skills"],
      maxSearchPages: 1,
      exclude: ["Big/registry"],
    };
    expect(await discover(gh, sources, 50, false)).toEqual(["solo/one", "acme/skills"]);
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
    [{ stars: 49 }, "stars 49 < 50"],
    [{ pushedAt: "2026-01-01T00:00:00Z" }, "last push 314 days ago (limit 180)"],
    [{ pushedAt: "" }, "no valid push date"],
    [{ pushedAt: "2026-11-05" }, "no valid push date"],
  ])("rejects %j", (overrides, reason) => {
    expect(checkRepo(makeRepo(overrides), filter, NOW)).toEqual({ ok: false, reason });
  });

  // Licenses are resolved per skill after extraction, not per repository.
  it.each([null, "GPL-3.0", "NOASSERTION", "mit"])("does not reject a repository for its license %j", (license) => {
    expect(checkRepo(makeRepo({ license }), filter, NOW)).toEqual({ ok: true });
  });

  it("does not reject a nominated repository for its stars", () => {
    expect(checkRepo(makeRepo({ stars: 0 }), filter, NOW, true)).toEqual({ ok: true });
  });

  it.each([
    [{ archived: true }, "archived"],
    [{ pushedAt: "2026-01-01T00:00:00Z" }, "last push 314 days ago (limit 180)"],
  ])("still rejects a nominated repository %j", (overrides, reason) => {
    expect(checkRepo(makeRepo({ stars: 3, ...overrides }), filter, NOW, true)).toEqual({ ok: false, reason });
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

  it("keeps a nominated low-star repository and rejects a low-star topic result", async () => {
    const gh = new FakeGitHub([
      { meta: makeRepo({ fullName: "small/nominated", stars: 4 }), files: {} },
      { meta: makeRepo({ fullName: "small/topic", stars: 4 }), files: {} },
    ]);
    const result = await filterRepos(
      gh,
      ["small/nominated", "small/topic"],
      filter,
      NOW,
      new Set(["Small/Nominated"]),
    );
    expect(result.repos.map((repo) => repo.fullName)).toEqual(["small/nominated"]);
    expect(result.filtered).toEqual([{ fullName: "small/topic", reason: "stars 4 < 50" }]);
  });

  it("keeps a repository whose GitHub license is missing or not allowed", async () => {
    const gh = new FakeGitHub([
      { meta: makeRepo({ fullName: "no/license", license: null }), files: {} },
      { meta: makeRepo({ fullName: "gpl/repo", license: "GPL-3.0" }), files: {} },
    ]);
    const result = await filterRepos(gh, ["no/license", "gpl/repo"], filter, NOW);
    expect(result.repos.map((repo) => repo.fullName)).toEqual(["gpl/repo", "no/license"]);
    expect(result.filtered).toEqual([]);
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

  it("reports kept repositories that now answer under another name", async () => {
    const gh = new FakeGitHub(
      [
        { meta: makeRepo({ fullName: "zeta/new" }), files: {} },
        { meta: makeRepo({ fullName: "acme/skills" }), files: {} },
        { meta: makeRepo({ fullName: "gone/archived", archived: true }), files: {} },
      ],
      {},
      { "zeta/old": "zeta/new", "beta/old": "acme/skills", "old/archived": "gone/archived" },
    );
    const result = await filterRepos(gh, ["zeta/old", "ACME/Skills", "beta/old", "old/archived"], filter, NOW);
    expect(result.repos.map((repo) => repo.fullName)).toEqual(["acme/skills", "zeta/new"]);
    // A change of letter case is not a rename; a rejected or already-seen repository is not reported.
    expect(result.renamed).toEqual([{ from: "zeta/old", to: "zeta/new" }]);
  });

  it("sorts renamed repositories by their listed name", async () => {
    const gh = new FakeGitHub(
      [
        { meta: makeRepo({ fullName: "x/one" }), files: {} },
        { meta: makeRepo({ fullName: "y/two" }), files: {} },
      ],
      {},
      { "b/old": "x/one", "a/old": "y/two" },
    );
    const result = await filterRepos(gh, ["b/old", "a/old"], filter, NOW);
    expect(result.renamed).toEqual([
      { from: "a/old", to: "y/two" },
      { from: "b/old", to: "x/one" },
    ]);
  });
});
