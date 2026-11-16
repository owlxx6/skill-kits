import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decidingEvidence,
  identifyFrontmatterLicense,
  identifyLicenseText,
  indexLicenseFiles,
  isLicenseFileName,
  licenseFilesFor,
  licenseIneligibility,
  type LicenseQuery,
  resolveLicense,
} from "../pipeline/lib/license";
import type { LicenseOutcome, LicenseResolution } from "../pipeline/lib/schemas";
import type { TreeEntry } from "../pipeline/lib/skillfile";
import {
  AGPL3_TEXT,
  APACHE_NOTICE,
  APACHE_TEXT,
  BSD2_TEXT,
  BSD3_TEXT,
  BSD4_TEXT,
  CUSTOM_TEXT,
  GPL2_TEXT,
  GPL3_TEXT,
  ISC_TEXT,
  LGPL21_TEXT,
  LGPL3_TEXT,
  MIT_TEXT,
} from "./license-texts";

const sha = (text: string): string => createHash("sha1").update(text).digest("hex");

function setup(files: Record<string, string>) {
  const entries: TreeEntry[] = Object.entries(files).map(([path, text]) => ({
    path,
    type: "blob",
    sha: sha(text),
  }));
  const texts = new Map(Object.values(files).map((text) => [sha(text), text]));
  const index = indexLicenseFiles(entries);
  const spdxOf = (blob: string): string | null => identifyLicenseText(texts.get(blob) ?? "");
  return { index, spdxOf };
}

function resolve(
  files: Record<string, string>,
  query: Partial<LicenseQuery> & { skillPath: string },
): LicenseResolution {
  const { index, spdxOf } = setup(files);
  return resolveLicense(index, { githubLicense: null, truncated: false, ...query }, spdxOf);
}

const skill = (dir: string, body = "x"): Record<string, string> => ({ [`${dir}/SKILL.md`]: body });

describe("isLicenseFileName", () => {
  it.each([
    "LICENSE",
    "LICENCE",
    "COPYING",
    "license",
    "License.txt",
    "LICENSE.md",
    "LICENSE-MIT",
    "LICENSE_APACHE.txt",
    "COPYING.LESSER",
    "licence.rst",
  ])("matches %s", (name) => {
    expect(isLicenseFileName(name)).toBe(true);
  });

  it.each(["README.md", "LICENSES", "MY-LICENSE", "license.py", "license.ts", "licensing.md", "SKILL.md"])(
    "does not match %s",
    (name) => {
      expect(isLicenseFileName(name)).toBe(false);
    },
  );
});

describe("identifyLicenseText", () => {
  it.each([
    ["MIT", MIT_TEXT],
    ["ISC", ISC_TEXT],
    ["BSD-2-Clause", BSD2_TEXT],
    ["BSD-3-Clause", BSD3_TEXT],
    ["Apache-2.0", APACHE_TEXT],
    ["Apache-2.0", APACHE_NOTICE],
    ["GPL-2.0", GPL2_TEXT],
    ["GPL-3.0", GPL3_TEXT],
    ["LGPL-2.1", LGPL21_TEXT],
    ["LGPL-3.0", LGPL3_TEXT],
    ["AGPL-3.0", AGPL3_TEXT],
  ])("identifies %s", (spdx, text) => {
    expect(identifyLicenseText(text)).toBe(spdx);
  });

  it("identifies a text reflowed with Markdown and curly quotes", () => {
    const reflowed = `# MIT License\n\n${MIT_TEXT.replace(/\n/g, " ").replace(/"/g, "“")}`;
    expect(identifyLicenseText(reflowed)).toBe("MIT");
  });

  it.each([
    ["a custom text", CUSTOM_TEXT],
    ["an empty text", ""],
    ["the BSD 4-clause text", BSD4_TEXT],
    ["MIT with the Commons Clause", `${MIT_TEXT}\n"Commons Clause" License Condition v1.0\n`],
    ["MIT and Apache in one file", `${MIT_TEXT}\n${APACHE_TEXT}`],
    ["a bare license name", "MIT License\n\nCopyright 2025 Acme"],
  ])("returns null for %s", (_label, text) => {
    expect(identifyLicenseText(text)).toBeNull();
  });
});

describe("identifyFrontmatterLicense", () => {
  it.each([
    ["MIT", "MIT"],
    ["mit", "MIT"],
    [" apache-2.0 ", "Apache-2.0"],
    ["BSD-3-CLAUSE", "BSD-3-Clause"],
    ["GPL-3.0-only", "GPL-3.0"],
    ["GPL-3.0-or-later", "GPL-3.0"],
  ])("reads %j as a known SPDX id", (value, spdx) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "spdx", spdx });
  });

  it.each([
    ["Complete terms in LICENSE.txt", ["LICENSE.txt"]],
    ["Proprietary. LICENSE.txt has complete terms", ["LICENSE.txt"]],
    ["See LICENSE", ["LICENSE"]],
    ["see ./license.md.", ["license.md"]],
    ["Terms in TERMS.md and LICENSE", ["TERMS.md", "LICENSE"]],
    ["See ../LICENSE", ["../LICENSE"]],
  ])("reads %j as a reference to a file", (value, names) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "file", names });
  });

  it.each(["Proprietary", "MIT License", "Apache 2.0", "MIT OR Apache-2.0", "MIT-only", "see the license file", ""])(
    "reads %j as custom",
    (value) => {
      expect(identifyFrontmatterLicense(value)).toEqual({ kind: "custom" });
    },
  );
});

describe("resolveLicense", () => {
  it("identifies a license file in the skill folder", () => {
    const result = resolve({ ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT }, { skillPath: "skills/pdf" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "skill",
      evidence: [{ kind: "file", path: "skills/pdf/LICENSE", blob: sha(MIT_TEXT), spdx: "MIT" }],
    });
  });

  it("identifies a known SPDX id in the front matter alone", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", frontmatterLicense: "apache-2.0" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "Apache-2.0",
      level: "skill",
      evidence: [
        { kind: "frontmatter", path: "skills/pdf/SKILL.md", value: "apache-2.0", spdx: "Apache-2.0" },
      ],
    });
  });

  it("follows a front matter value that points to an existing file", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE.txt": APACHE_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "Complete terms in LICENSE.txt" },
    );
    expect(result).toEqual({
      outcome: "identified",
      spdx: "Apache-2.0",
      level: "skill",
      evidence: [
        { kind: "file", path: "skills/pdf/LICENSE.txt", blob: sha(APACHE_TEXT), spdx: "Apache-2.0" },
        {
          kind: "frontmatter",
          path: "skills/pdf/SKILL.md",
          value: "Complete terms in LICENSE.txt",
          spdx: null,
        },
      ],
    });
  });

  it("follows a reference to a file whose name is not a license name", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/TERMS.md": CUSTOM_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "Terms in TERMS.md", githubLicense: "MIT" },
    );
    expect(result.outcome).toBe("custom");
    expect(result.level).toBe("skill");
    expect(result.evidence[0]).toEqual({
      kind: "file",
      path: "skills/pdf/TERMS.md",
      blob: sha(CUSTOM_TEXT),
      spdx: null,
    });
  });

  it("is ambiguous when the front matter points to a missing file", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "Complete terms in LICENSE.txt", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
    expect(result.spdx).toBeUndefined();
  });

  it("is ambiguous when the front matter id disagrees with the local file", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": APACHE_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("is ambiguous with two different license files in one folder", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE-MIT": MIT_TEXT, "skills/pdf/LICENSE-APACHE": APACHE_TEXT },
      { skillPath: "skills/pdf" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
    expect(result.evidence).toHaveLength(2);
  });

  it("is ambiguous with a known id next to unidentified text", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT, "skills/pdf/COPYING": CUSTOM_TEXT },
      { skillPath: "skills/pdf" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("agrees when two files and the front matter name the same id", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT, "skills/pdf/LICENSE.md": `# ${MIT_TEXT}` },
      { skillPath: "skills/pdf", frontmatterLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });

  it("reports unidentified text as custom, even when the repository is permissive", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": CUSTOM_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
    // Farther levels are recorded but do not decide.
    expect(result.evidence.map((entry) => entry.kind)).toEqual(["file", "file", "github"]);
  });

  it("reports an unknown front matter value as custom", () => {
    const result = resolve(skill("skills/pdf"), {
      skillPath: "skills/pdf",
      frontmatterLicense: "Proprietary",
      githubLicense: "MIT",
    });
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it("uses a license file of an ancestor folder", () => {
    const result = resolve(
      { ...skill("plugins/docs/skills/pdf"), "plugins/docs/LICENSE": BSD3_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "plugins/docs/skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "BSD-3-Clause", level: "ancestor" });
  });

  it("lists ancestor files nearest first and is ambiguous when they disagree", () => {
    const result = resolve(
      { ...skill("a/b/skill"), "a/b/LICENSE": MIT_TEXT, "a/LICENSE": APACHE_TEXT },
      { skillPath: "a/b/skill" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "ancestor" });
    // GitHub detected nothing (null): no GitHub entry is recorded.
    expect(result.evidence.map((entry) => (entry.kind === "file" ? entry.path : entry.kind))).toEqual([
      "a/b/LICENSE",
      "a/LICENSE",
    ]);
  });

  it("uses a nested skill's parent skill folder license as an ancestor", () => {
    const result = resolve(
      { ...skill("skills/parent"), ...skill("skills/parent/child"), "skills/parent/LICENSE": ISC_TEXT },
      { skillPath: "skills/parent/child" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "ISC", level: "ancestor" });
  });

  it("identifies a repository root file that agrees with GitHub", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "repository",
      evidence: [
        { kind: "file", path: "LICENSE", blob: sha(MIT_TEXT), spdx: "MIT" },
        { kind: "github", value: "MIT", spdx: "MIT" },
      ],
    });
  });

  it.each([
    ["another id", "Apache-2.0"],
    ["NOASSERTION", "NOASSERTION"],
    ["nothing", null],
  ])("is ambiguous when an identified root file meets GitHub detecting %s", (_label, githubLicense) => {
    const result = resolve({ ...skill("skills/pdf"), LICENSE: MIT_TEXT }, { skillPath: "skills/pdf", githubLicense });
    expect(result).toMatchObject({ outcome: "ambiguous", level: "repository" });
  });

  it("uses GitHub's detection when the root file is not identified, and records it", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", githubLicense: "Apache-2.0" },
    );
    expect(result).toEqual({
      outcome: "identified",
      spdx: "Apache-2.0",
      level: "repository",
      evidence: [
        { kind: "file", path: "LICENSE", blob: sha(CUSTOM_TEXT), spdx: null },
        { kind: "github", value: "Apache-2.0", spdx: "Apache-2.0" },
      ],
    });
  });

  it("is custom when the root file is not identified and GitHub detects nothing", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", githubLicense: "NOASSERTION" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "repository" });
  });

  it("uses GitHub's detection alone when there is no license file", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", githubLicense: "MIT" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "repository",
      evidence: [{ kind: "github", value: "MIT", spdx: "MIT" }],
    });
  });

  it("is missing with GitHub detecting nothing and no file", () => {
    const result = resolve({ ...skill("skills/pdf"), "README.md": "x" }, { skillPath: "skills/pdf" });
    expect(result).toEqual({ outcome: "missing", level: "none", evidence: [] });
  });

  it("is missing with GitHub answering NOASSERTION and no file, and records the answer", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", githubLicense: "NOASSERTION" });
    expect(result).toEqual({
      outcome: "missing",
      level: "none",
      evidence: [{ kind: "github", value: "NOASSERTION", spdx: null }],
    });
  });

  it("counts root files at the skill level for a root skill", () => {
    const result = resolve(
      { "SKILL.md": "x", LICENSE: CUSTOM_TEXT },
      { skillPath: "", githubLicense: "MIT" },
    );
    // GitHub's detection belongs to the farther repository level: the root file decides.
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
    expect(result.evidence[0]).toMatchObject({ kind: "file", path: "LICENSE" });
  });

  it("identifies a root skill from its root file and front matter", () => {
    const result = resolve(
      { "SKILL.md": "x", "LICENSE.md": MIT_TEXT },
      { skillPath: "", frontmatterLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    expect(result.evidence).toContainEqual({ kind: "frontmatter", path: "SKILL.md", value: "MIT", spdx: "MIT" });
  });

  it("is ambiguous when a truncated tree shows no skill-level evidence", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT", truncated: true },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "none" });
    expect(result.evidence).toHaveLength(2);
  });

  it("still decides at the skill level in a truncated tree", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT },
      { skillPath: "skills/pdf", truncated: true },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });

  it("treats a file whose text could not be read as unidentified", () => {
    const { index } = setup({ ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT });
    const result = resolveLicense(index, { skillPath: "skills/pdf", githubLicense: "MIT", truncated: false }, () => null);
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });
});

describe("licenseFilesFor", () => {
  it("lists the files to identify at every level, once, plus a referenced file", () => {
    const { index } = setup({
      ...skill("a/skill"),
      "a/skill/LICENSE": MIT_TEXT,
      "a/skill/TERMS.md": CUSTOM_TEXT,
      "a/COPYING": GPL3_TEXT,
      LICENSE: MIT_TEXT,
      "other/LICENSE": APACHE_TEXT,
    });
    const files = licenseFilesFor(index, {
      skillPath: "a/skill",
      frontmatterLicense: "See TERMS.md",
      githubLicense: null,
      truncated: false,
    });
    expect(files.map((file) => file.path)).toEqual(["a/skill/LICENSE", "a/skill/TERMS.md", "a/COPYING", "LICENSE"]);
  });
});

describe("eligibility", () => {
  const identified = (spdx: string): LicenseResolution => ({
    outcome: "identified",
    spdx,
    level: "repository",
    evidence: [{ kind: "github", value: spdx, spdx }],
  });
  const unresolved = (outcome: LicenseOutcome): LicenseResolution => ({ outcome, level: "none", evidence: [] });
  const allowed = ["MIT", "Apache-2.0"];

  it("accepts an identified allowed license", () => {
    expect(licenseIneligibility(identified("MIT"), allowed)).toBeNull();
  });

  it.each([
    ["not allowed", identified("GPL-3.0"), "license GPL-3.0 not allowed"],
    ["custom", unresolved("custom"), "license custom"],
    ["ambiguous", unresolved("ambiguous"), "license ambiguous"],
    ["missing", unresolved("missing"), "license missing"],
    ["unresolved", undefined, "license unresolved"],
  ])("rejects %s", (_label, license, reason) => {
    expect(licenseIneligibility(license, allowed)).toBe(reason);
  });
});

describe("decidingEvidence", () => {
  it("returns the first evidence of the deciding level that names the resolved id", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT, LICENSE: APACHE_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "MIT", githubLicense: "Apache-2.0" },
    );
    expect(decidingEvidence(result, "skills/pdf")).toEqual({
      kind: "file",
      path: "skills/pdf/LICENSE",
      blob: sha(MIT_TEXT),
      spdx: "MIT",
    });
  });

  it("returns GitHub's detection when it decided", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(decidingEvidence(result, "skills/pdf")).toEqual({ kind: "github", value: "MIT", spdx: "MIT" });
  });

  it("returns nothing when the license is not identified", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf" });
    expect(decidingEvidence(result, "skills/pdf")).toBeUndefined();
  });
});
