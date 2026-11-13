import { describe, expect, it } from "vitest";
import {
  findSkillLocations,
  parseSkillFrontmatter,
  skillFilePath,
  skillId,
  type TreeEntry,
} from "../pipeline/lib/skillfile";
import { fp } from "./fixtures";

describe("parseSkillFrontmatter", () => {
  it("reads name and description", () => {
    const content = "---\nname: resume-tailor\ndescription: Tailors a resume.\n---\n\n# Body\n";
    expect(parseSkillFrontmatter(content)).toEqual({
      name: "resume-tailor",
      description: "Tailors a resume.",
    });
  });

  it("accepts Windows line endings", () => {
    const content = "---\r\nname: a\r\ndescription: b\r\n---\r\nBody";
    expect(parseSkillFrontmatter(content)).toEqual({ name: "a", description: "b" });
  });

  it("returns null without front matter", () => {
    expect(parseSkillFrontmatter("# Just a title\n")).toBeNull();
  });

  it("returns null when description is missing or empty", () => {
    expect(parseSkillFrontmatter("---\nname: a\n---\n")).toBeNull();
    expect(parseSkillFrontmatter("---\nname: a\ndescription: '  '\n---\n")).toBeNull();
  });

  it("returns null on invalid YAML", () => {
    expect(parseSkillFrontmatter("---\nname: [unclosed\n---\n")).toBeNull();
  });

  it("never treats a code front matter block as front matter", () => {
    expect(parseSkillFrontmatter("---js\nprocess.exit(1)\n---\n")).toBeNull();
  });
});

describe("findSkillLocations", () => {
  const entries: TreeEntry[] = [
    { path: "README.md", type: "blob", sha: fp("1") },
    { path: "skills", type: "tree", sha: fp("2") },
    { path: "skills/resume", type: "tree", sha: fp("3") },
    { path: "skills/resume/SKILL.md", type: "blob", sha: fp("4") },
    { path: "skills/resume/scripts", type: "tree", sha: fp("5") },
    { path: "skills/resume/scripts/check.py", type: "blob", sha: fp("6") },
    { path: "skills/resume/examples.md", type: "blob", sha: fp("7") },
    { path: "node_modules/pkg/SKILL.md", type: "blob", sha: fp("8") },
    { path: "docs/NOT-SKILL.md", type: "blob", sha: fp("9") },
  ];

  it("finds each skill folder with its tree id and sibling files", () => {
    expect(findSkillLocations(entries)).toEqual([
      {
        dir: "skills/resume",
        fingerprint: fp("3"),
        files: ["examples.md", "scripts/check.py"],
      },
    ]);
  });

  it("uses the blob id for a skill at the repository root", () => {
    const rootEntries: TreeEntry[] = [
      { path: "SKILL.md", type: "blob", sha: fp("a") },
      { path: "helper.sh", type: "blob", sha: fp("b") },
    ];
    expect(findSkillLocations(rootEntries)).toEqual([
      { dir: "", fingerprint: fp("a"), files: ["helper.sh"] },
    ]);
  });
});

describe("skillId and skillFilePath", () => {
  it("builds ids and file paths for nested and root skills", () => {
    expect(skillId("acme/skills", "skills/resume")).toBe("acme/skills:skills/resume");
    expect(skillId("acme/skills", "")).toBe("acme/skills:.");
    expect(skillFilePath("skills/resume")).toBe("skills/resume/SKILL.md");
    expect(skillFilePath("")).toBe("SKILL.md");
  });
});
