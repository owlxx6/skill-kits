import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  CurationSchema,
  KitsSchema,
  ReviewSchema,
  SourcesSchema,
} from "../pipeline/lib/schemas";
import { readYamlFile } from "../pipeline/lib/store";

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
