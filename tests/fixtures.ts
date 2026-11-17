import type { Config, Kit, LicenseResolution, RepoMeta, Review, SkillRecord } from "../pipeline/lib/schemas";

export const NOW = new Date("2026-11-11T00:00:00Z");

export const testConfig: Config = {
  filter: {
    allowedLicenses: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"],
    minStars: 50,
    maxDaysSinceLastCommit: 180,
  },
  collection: { minSkills: 3, minKitSkills: 3 },
  review: {
    model: "claude-haiku-5-5",
    triageBatchSize: 50,
    maxReviewsPerRun: 500,
    minCatalogScore: 6,
    maxSkillChars: 24000,
    maxMinutes: 140,
  },
  scoring: {
    stars: { min: 50, max: 50000 },
    forks: { min: 5, max: 5000 },
    freshness: { fullDays: 30, zeroDays: 180 },
    repoSignal: { stars: 0.4, forks: 0.4, freshness: 0.2 },
    skill: { review: 0.7, repoSignal: 0.3 },
    collection: { repoSignal: 0.4, medianReview: 0.4, coverage: 0.2, coverageCap: 10 },
  },
  proposals: { collections: 3, skills: 8 },
};

export const testKits: Kit[] = [
  {
    id: "resume-career",
    title: "Resume & career agent",
    description: "Tailor a resume to a job offer.",
    keywords: ["resume", "cv"],
  },
  {
    id: "web-app",
    title: "Web app builder",
    description: "Build and ship a web application.",
    keywords: ["frontend", "backend"],
  },
];

// 1581 stars, 158 forks and a push 105 days before NOW each score 5 on their scale.
export function makeRepo(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    fullName: "acme/skills",
    url: "https://github.com/acme/skills",
    description: "Skills by Acme",
    stars: 1581,
    forks: 158,
    license: "MIT",
    pushedAt: "2026-07-29T00:00:00Z",
    defaultBranch: "main",
    archived: false,
    ...overrides,
  };
}

// 40 identical hex characters: a valid git object id that is easy to read in tests.
export const fp = (hexChar: string): string => hexChar.repeat(40);

// GitHub's detection alone, as for a repository without license files.
export function githubLicense(spdx: string): LicenseResolution {
  return {
    outcome: "identified",
    spdx,
    level: "repository",
    evidence: [{ kind: "github", level: "repository", value: spdx, spdx }],
  };
}

export function makeSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: "acme/skills:skills/a",
    repo: "acme/skills",
    path: "skills/a",
    name: "a",
    description: "Skill a",
    fingerprint: fp("a"),
    files: [],
    license: githubLicense("MIT"),
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    kits: ["resume-career"],
    scores: { clarity: 8, completeness: 8, usefulness: 8 },
    why: "Useful for the kit.",
    summary: "Does one thing well.",
    strengths: ["Clear steps"],
    cautions: [],
    keywords: ["one", "two", "three", "four", "five"],
    security: { level: "none", notes: [] },
    ...overrides,
  };
}

export function skillMd(name: string, description: string, body = "Do the thing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}
