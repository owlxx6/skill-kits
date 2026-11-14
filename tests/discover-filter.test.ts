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
    [{ pushedAt: "2026-01-01T00:00:00Z" }, "last push 314 days ago"],
    [{ pushedAt: "" }, "no valid push date"],
    [{ pushedAt: "2026-11-05" }, "no valid push date"],
  ])("rejects %j", (overrides, reason) => {
    expect(checkRepo(makeRepo(overrides), filter, NOW)).toEqual({ ok: false, reason });
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
      { fullName: "old/archived", reason: "archived" },
      { fullName: "ghost/deleted", reason: "not found" },
    ]);
  });
});
