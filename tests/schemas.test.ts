import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  CurationSchema,
  KitsSchema,
  RepoMetaSchema,
  ReviewSchema,
  SkillRecordSchema,
  SourcesSchema,
  type Config,
} from "../pipeline/lib/schemas";
import { readYamlFile } from "../pipeline/lib/store";
import { makeRepo, testConfig } from "./fixtures";

const data = (name: string): string => path.join(process.cwd(), "data", name);

const validReview = {
  kits: ["resume-career"],
  scores: { clarity: 8, completeness: 7, usefulness: 9 },
  why: "Rewrites bullet points against a job description.",
  summary: "Maps each requirement of a job description to the resume.",
  strengths: ["Worked example"],
  cautions: ["English only"],
  keywords: ["resume", "cv", "job description", "ats", "bullet points"],
  security: { level: "none", notes: [] },
};

describe("data files", () => {
  it("loads config.yaml with the thresholds from the spec", async () => {
    const config = await readYamlFile(data("config.yaml"), ConfigSchema);
    expect(config.filter.minStars).toBe(50);
    expect(config.filter.allowedLicenses).toContain("MIT");
    expect(config.review.model).toBe("claude-haiku-5-5");
    expect(config.review.maxMinutes).toBe(120);
    expect(config.scoring.skill).toEqual({ review: 0.7, repoSignal: 0.3 });
  });

  it("loads the 8 launch kits", async () => {
    const kits = await readYamlFile(data("kits.yaml"), KitsSchema);
    expect(kits.map((kit) => kit.id)).toEqual([
      "resume-career",
      "web-app",
      "data-analysis",
      "docs-reports",
      "marketing-content",
      "research-monitoring",
      "ui-design",
      "workflow-automation",
    ]);
  });

  it("loads sources.yaml and curation.yaml", async () => {
    const sources = await readYamlFile(data("sources.yaml"), SourcesSchema);
    expect(sources.repos.length).toBeGreaterThanOrEqual(5);
    const curation = await readYamlFile(data("curation.yaml"), CurationSchema);
    expect(Object.keys(curation)).toContain("resume-career");
  });

  it("names the file when its content is invalid", async () => {
    await expect(readYamlFile(data("kits.yaml"), ConfigSchema)).rejects.toThrow(
      /kits\.yaml is invalid/,
    );
  });
});

describe("ReviewSchema", () => {
  it("accepts a review that respects every limit", () => {
    expect(ReviewSchema.safeParse(validReview).success).toBe(true);
  });

  it("rejects a why longer than 160 characters", () => {
    const review = { ...validReview, why: "x".repeat(161) };
    expect(ReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects more than two kits", () => {
    const review = { ...validReview, kits: ["web-app", "ui-design", "docs-reports"] };
    expect(ReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects a score outside 0-10", () => {
    const review = { ...validReview, scores: { clarity: 11, completeness: 7, usefulness: 9 } };
    expect(ReviewSchema.safeParse(review).success).toBe(false);
  });
});

describe("ConfigSchema constraints", () => {
  const loadConfig = (): Promise<Config> => readYamlFile(data("config.yaml"), ConfigSchema);
  const reject = (config: unknown): void => {
    expect(ConfigSchema.safeParse(config).success).toBe(false);
  };

  it("rejects a range where min equals max", async () => {
    const config = await loadConfig();
    reject({ ...config, scoring: { ...config.scoring, stars: { min: 50, max: 50 } } });
  });

  it("rejects freshness where fullDays is not below zeroDays", async () => {
    const config = await loadConfig();
    reject({
      ...config,
      scoring: { ...config.scoring, freshness: { fullDays: 180, zeroDays: 180 } },
    });
  });

  it("rejects a negative weight", async () => {
    const config = await loadConfig();
    reject({
      ...config,
      scoring: { ...config.scoring, skill: { review: 1.2, repoSignal: -0.2 } },
    });
  });

  it("rejects an allowed license that is not an SPDX identifier", async () => {
    const config = await loadConfig();
    reject({ ...config, filter: { ...config.filter, allowedLicenses: ["MIT license"] } });
  });

  it("rejects a review time budget that is not positive", async () => {
    const config = await loadConfig();
    reject({ ...config, review: { ...config.review, maxMinutes: 0 } });
  });

  it("rejects skill weights that do not sum to 1", async () => {
    const config = await loadConfig();
    reject({
      ...config,
      scoring: { ...config.scoring, skill: { review: 0.6, repoSignal: 0.3 } },
    });
  });
});

describe("repo names and curation keys", () => {
  const sources = (repo: string) => ({ repos: [repo], topics: [], maxSearchPages: 1 });

  it("accepts owner/.github", () => {
    expect(SourcesSchema.safeParse(sources("owner/.github")).success).toBe(true);
  });

  it("accepts a plain topic and rejects search qualifiers in it", () => {
    const withTopic = (topic: string) => ({ repos: [], topics: [topic], maxSearchPages: 1 });
    expect(SourcesSchema.safeParse(withTopic("agent-skills")).success).toBe(true);
    expect(SourcesSchema.safeParse(withTopic("x stars:>0")).success).toBe(false);
  });

  it("rejects ../..", () => {
    expect(SourcesSchema.safeParse(sources("../..")).success).toBe(false);
  });

  it("rejects a curation key that is not a kit id", () => {
    const result = CurationSchema.safeParse({ "Resume Career": { approved: [], rejected: [] } });
    expect(result.success).toBe(false);
  });
});

describe("ReviewSchema boundaries", () => {
  const keywords = (count: number): string[] => Array.from({ length: count }, (_, i) => `k${i}`);

  it.each([
    ["4 keywords", { keywords: keywords(4) }],
    ["13 keywords", { keywords: keywords(13) }],
    ["401-character summary", { summary: "x".repeat(401) }],
    ["non-integer score", { scores: { clarity: 7.5, completeness: 7, usefulness: 9 } }],
    ["unknown security level", { security: { level: "high", notes: [] } }],
    ["4 strengths", { strengths: ["a", "b", "c", "d"] }],
  ])("rejects %s", (_label, override) => {
    expect(ReviewSchema.safeParse({ ...validReview, ...override }).success).toBe(false);
  });

  it("accepts exactly 5 keywords", () => {
    expect(ReviewSchema.safeParse({ ...validReview, keywords: keywords(5) }).success).toBe(true);
  });
});

describe("RepoMetaSchema pushedAt", () => {
  it("accepts an ISO datetime", () => {
    expect(RepoMetaSchema.safeParse(makeRepo({ pushedAt: "2026-11-05T12:34:56Z" })).success).toBe(true);
  });

  it("rejects a value that is not a date", () => {
    expect(RepoMetaSchema.safeParse(makeRepo({ pushedAt: "yesterday" })).success).toBe(false);
  });
});

describe("SkillRecordSchema id", () => {
  const record = {
    id: "acme/skills:skills/a",
    repo: "acme/skills",
    path: "skills/a",
    name: "a",
    description: "Skill a",
    fingerprint: "a".repeat(40),
    files: [],
  };

  it("accepts a plain id", () => {
    expect(SkillRecordSchema.safeParse(record).success).toBe(true);
  });

  it("rejects an id containing a backtick", () => {
    expect(SkillRecordSchema.safeParse({ ...record, id: `acme/skills:skills/a${"`"}b` }).success).toBe(false);
  });
});

describe("shared fixtures", () => {
  it("testConfig is a valid config", () => {
    expect(ConfigSchema.parse(testConfig)).toEqual(testConfig);
  });
});
