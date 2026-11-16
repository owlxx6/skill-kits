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

  it("reads an optional license value, trimmed", () => {
    const content = "---\nname: a\ndescription: b\nlicense: '  Complete terms in LICENSE.txt  '\n---\n";
    expect(parseSkillFrontmatter(content)).toEqual({
      name: "a",
      description: "b",
      license: "Complete terms in LICENSE.txt",
    });
  });

  it("has no license key when the front matter has no license", () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: b\n---\n")).not.toHaveProperty("license");
  });

  it("drops an empty license value", () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: b\nlicense: '  '\n---\n")).not.toHaveProperty(
      "license",
    );
  });

  it("removes line breaks and control characters from the license value", () => {
    const content = "---\nname: a\ndescription: b\nlicense: \"Complete terms\\nin\\u0007 LICENSE.txt\\u202E\"\n---\n";
    expect(parseSkillFrontmatter(content)?.license).toBe("Complete terms in LICENSE.txt");
  });

  it("keeps at most 200 characters of the license value", () => {
    const content = `---\nname: a\ndescription: b\nlicense: ${"x".repeat(300)}\n---\n`;
    expect(parseSkillFrontmatter(content)?.license).toBe("x".repeat(200));
  });

  it("keeps a number or boolean license value as text", () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: b\nlicense: 2\n---\n")?.license).toBe("2");
    expect(parseSkillFrontmatter("---\nname: a\ndescription: b\nlicense: true\n---\n")?.license).toBe("true");
  });

  it.each([
    ["a list", "[MIT, Apache-2.0]"],
    ["a map", "{ name: MIT }"],
    ["a circular alias list", "&a [*a]"],
    ["a circular alias map", "&a { b: *a }"],
  ])("marks %s as a non-text license value, never ignored and never throwing", (_label, value) => {
    const parse = () => parseSkillFrontmatter(`---\nname: a\ndescription: b\nlicense: ${value}\n---\n`);
    expect(parse).not.toThrow();
    expect(parse()?.license).toBe("[non-text value]");
  });

  it("does not reject a skill for its license value", () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: b\nlicense: null\n---\n")).toEqual({
      name: "a",
      description: "b",
    });
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

const BOM = String.fromCodePoint(0xfeff);
const RLO = String.fromCodePoint(0x202e);
const NUL = String.fromCodePoint(0x0000);
const fm = (name: string, description: string): string =>
  `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\nBody`;

describe("parseSkillFrontmatter hardening", () => {
  it("parses a file starting with a byte-order mark", () => {
    expect(parseSkillFrontmatter(`${BOM}---\nname: a\ndescription: b\n---\n`)).toEqual({
      name: "a",
      description: "b",
    });
  });

  it("accepts trailing spaces on delimiters but still rejects ---js", () => {
    expect(parseSkillFrontmatter("--- \t\nname: a\ndescription: b\n---  \nBody")).toEqual({
      name: "a",
      description: "b",
    });
    expect(parseSkillFrontmatter("---js\nname: a\ndescription: b\n---\n")).toBeNull();
  });

  it("bounds and validates the name", () => {
    expect(parseSkillFrontmatter(fm("n".repeat(64), "d"))?.name).toBe("n".repeat(64));
    expect(parseSkillFrontmatter(fm("n".repeat(65), "d"))).toBeNull();
    expect(parseSkillFrontmatter(fm("a\nb", "d"))).toBeNull();
    expect(parseSkillFrontmatter(fm(`a${NUL}b`, "d"))).toBeNull();
    expect(parseSkillFrontmatter(fm(`a${RLO}b`, "d"))).toBeNull();
  });

  it("sanitizes and bounds the description", () => {
    expect(parseSkillFrontmatter(fm("a", `x${RLO}y${NUL}z\nw`))?.description).toBe("xyz\nw");
    expect(parseSkillFrontmatter(fm("a", "d".repeat(5000)))?.description).toHaveLength(1024);
    expect(parseSkillFrontmatter(fm("a", `${RLO}${NUL}`))).toBeNull();
  });

  it("cuts the description on whole characters", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const result = parseSkillFrontmatter(fm("a", `${"x".repeat(1023)}${emoji}more text`))?.description ?? "";
    expect(Array.from(result)).toHaveLength(1024);
    expect(result.endsWith(emoji)).toBe(true);
    const last = result.charCodeAt(result.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("rejects a non-string name", () => {
    expect(parseSkillFrontmatter("---\nname: 123\ndescription: b\n---\n")).toBeNull();
  });

  it("survives a YAML alias bomb quickly", () => {
    const lines = ["a0: &a0 [x, x, x, x, x, x, x, x, x]"];
    for (let level = 1; level <= 9; level += 1) {
      const refs = Array.from({ length: 9 }, () => `*a${level - 1}`).join(", ");
      lines.push(`a${level}: &a${level} [${refs}]`);
    }
    const content = `---\n${lines.join("\n")}\nbomb: *a9\nname: ok\ndescription: fine\n---\n`;
    const started = Date.now();
    expect(parseSkillFrontmatter(content)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("ignores a closing delimiter beyond 64 KB", () => {
    const content = `---\nname: a\ndescription: b\nfiller: ${"x".repeat(70 * 1024)}\n---\n`;
    expect(parseSkillFrontmatter(content)).toBeNull();
  });
});

describe("findSkillLocations ownership and ordering", () => {
  const blob = (path: string, n: string): TreeEntry => ({ path, type: "blob", sha: fp(n) });

  it("gives a nested skill its own files", () => {
    const result = findSkillLocations([
      blob("a/SKILL.md", "1"),
      blob("a/x.md", "2"),
      blob("a/b/SKILL.md", "3"),
      blob("a/b/y.py", "4"),
    ]);
    expect(result.map((s) => [s.dir, s.files])).toEqual([
      ["a", ["x.md"]],
      ["a/b", ["y.py"]],
    ]);
  });

  it("splits files between a root skill and a nested skill", () => {
    const result = findSkillLocations([
      blob("SKILL.md", "1"),
      blob("README.md", "2"),
      blob("skills/s/SKILL.md", "3"),
      blob("skills/s/run.sh", "4"),
    ]);
    expect(result.map((s) => [s.dir, s.files])).toEqual([
      ["", ["README.md"]],
      ["skills/s", ["run.sh"]],
    ]);
  });

  it("does not confuse folders sharing a prefix", () => {
    const result = findSkillLocations([blob("a/SKILL.md", "1"), blob("ab/x.md", "2")]);
    expect(result).toEqual([{ dir: "a", fingerprint: fp("1"), files: [] }]);
  });

  it("caps listed files at 50 in compareText order", () => {
    const names = Array.from({ length: 51 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`);
    const entries = [blob("s/SKILL.md", "1"), ...names.reverse().map((n) => blob(`s/${n}`, "2"))];
    const files = findSkillLocations(entries)[0].files;
    expect(files).toHaveLength(50);
    expect(files[0]).toBe("f00.txt");
    expect(files[49]).toBe("f49.txt");
  });

  it("falls back to the SKILL.md id when the folder tree entry is missing", () => {
    expect(findSkillLocations([blob("s/SKILL.md", "7")])[0].fingerprint).toBe(fp("7"));
  });

  it("skips node_modules segments only", () => {
    const result = findSkillLocations([
      blob("x/node_modules/y/SKILL.md", "1"),
      blob("my_node_modules/z/SKILL.md", "2"),
    ]);
    expect(result.map((s) => s.dir)).toEqual(["my_node_modules/z"]);
  });

  it("orders locations by compareText on dir", () => {
    const result = findSkillLocations([
      blob("b/SKILL.md", "1"),
      blob("B/SKILL.md", "2"),
      blob("a/SKILL.md", "3"),
    ]);
    expect(result.map((s) => s.dir)).toEqual(["B", "a", "b"]);
  });
});
