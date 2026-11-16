import { describe, expect, it } from "vitest";
import {
  decidingEvidence,
  gitBlobId,
  identifyFrontmatterLicense,
  identifyLicenseText,
  indexLicenseFiles,
  isDecidingLicenseName,
  isLicenseFileName,
  isPublishable,
  LICENSE_RULES_VERSION,
  licenseCacheFile,
  licenseFilesFor,
  type LicenseFileRef,
  licenseIneligibility,
  licenseCategory,
  licenseLabel,
  type LicenseQuery,
  NO_SAFETY_SCAN,
  notReReadLicense,
  publication,
  readLicenseCache,
  resolveLicense,
  resolveLinkTarget,
  type TextIdentification,
} from "../pipeline/lib/license";
import type { LicenseEvidence, LicenseResolution, SkillRecord } from "../pipeline/lib/schemas";
import type { TreeEntry } from "../pipeline/lib/skillfile";
import { blobIdOf as sha } from "./fakes";
import { makeSkill } from "./fixtures";
import {
  AGPL3_TEXT,
  APACHE_NOTICE,
  APACHE_TEXT,
  BSD2_TEXT,
  BSD3_CLEAR_TEXT,
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

const LINK = "120000";

interface Setup {
  files: Record<string, string>;
  // Symbolic links: path -> link text.
  links?: Record<string, string>;
  // Paths whose text could not be read in this run.
  unread?: string[];
}

function setup({ files, links = {}, unread = [] }: Setup) {
  const entries: TreeEntry[] = [
    ...Object.entries(files).map(([path, text]): TreeEntry => ({ path, type: "blob", sha: sha(text), mode: "100644" })),
    ...Object.entries(links).map(([path, text]): TreeEntry => ({ path, type: "blob", sha: sha(text), mode: LINK })),
  ];
  const texts = new Map([...Object.values(files), ...Object.values(links)].map((text) => [sha(text), text]));
  const index = indexLicenseFiles(entries);
  const read = (file: LicenseFileRef): TextIdentification | undefined => {
    if (unread.includes(file.path)) return undefined;
    if (file.mode === LINK) {
      const target = resolveLinkTarget(index, file, texts.get(file.blob) ?? "");
      return target ? identifyLicenseText(texts.get(target.blob) ?? "") : undefined;
    }
    return identifyLicenseText(texts.get(file.blob) ?? "");
  };
  return { index, read };
}

function resolve(
  files: Record<string, string>,
  query: Partial<LicenseQuery> & { skillPath: string },
  options: Omit<Setup, "files"> = {},
): LicenseResolution {
  const { index, read } = setup({ files, ...options });
  return resolveLicense(index, { githubLicense: null, truncated: false, ...query }, read);
}

const skill = (dir: string): Record<string, string> => ({ [dir ? `${dir}/SKILL.md` : "SKILL.md"]: "x" });

type Level = "skill" | "ancestor" | "repository";
const file = (path: string, text: string, level: Level, spdx: string | null = null): LicenseEvidence => ({
  kind: "file",
  level,
  path,
  blob: sha(text),
  status: spdx === null ? "unknown" : "identified",
  spdx,
});
const github = (value: string): LicenseEvidence => ({
  kind: "github",
  level: "repository",
  value,
  spdx: value === "NOASSERTION" ? null : value,
});

describe("license file names", () => {
  it.each([
    "LICENSE",
    "LICENCE",
    "COPYING",
    "UNLICENSE",
    "license",
    "License.txt",
    "LICENSE.md",
    "LICENSE-MIT",
    "LICENSE_APACHE.txt",
    "COPYING.LESSER",
    "licence.rst",
    "LICENSE-3rdparty.csv",
    "LICENSE.header",
    "LICENSE.json",
  ])("records %s", (name) => {
    expect(isLicenseFileName(name)).toBe(true);
  });

  it.each(["README.md", "LICENSES", "MY-LICENSE", "license.py", "license.ts", "licensing.md", "SKILL.md", "NOTICE"])(
    "does not record %s",
    (name) => {
      expect(isLicenseFileName(name)).toBe(false);
    },
  );

  it.each([
    "LICENSE",
    "LICENCE",
    "COPYING",
    "UNLICENSE",
    "license.txt",
    "LICENSE.md",
    "LICENSE.rst",
    "LICENSE-MIT",
    "LICENSE.APACHE",
    "LICENSE-MIT.txt",
    "LICENSE_APACHE",
    "COPYING.LESSER",
  ])("lets %s decide", (name) => {
    expect(isDecidingLicenseName(name)).toBe(true);
  });

  it.each([
    "LICENSE-3rdparty.csv",
    "LICENSE-THIRD-PARTY",
    "LICENSE.thirdparty.txt",
    "LICENSE-NOTICE",
    "LICENSE.header",
    "LICENSE-template.txt",
    "LICENSE.json",
    "LICENSE.yaml",
    "LICENSE.yml",
    "LICENSE.html",
    "LICENSE.csv",
  ])("records %s as auxiliary: it never decides", (name) => {
    expect(isLicenseFileName(name)).toBe(true);
    expect(isDecidingLicenseName(name)).toBe(false);
  });
});

describe("identifyLicenseText", () => {
  const apacheTermsOnly = APACHE_TEXT.slice(0, APACHE_TEXT.indexOf("APPENDIX"));

  it.each([
    ["MIT", MIT_TEXT],
    ["ISC", ISC_TEXT],
    ["BSD-2-Clause", BSD2_TEXT],
    ["BSD-3-Clause", BSD3_TEXT],
    ["Apache-2.0", APACHE_TEXT],
    ["Apache-2.0", apacheTermsOnly],
    ["Apache-2.0", APACHE_NOTICE],
    ["GPL-2.0", GPL2_TEXT],
    ["GPL-3.0", GPL3_TEXT],
    ["AGPL-3.0", AGPL3_TEXT],
    ["LGPL-2.1", LGPL21_TEXT],
    ["LGPL-3.0", LGPL3_TEXT],
  ])("identifies %s", (spdx, text) => {
    expect(identifyLicenseText(text)).toEqual({ kind: "spdx", spdx });
  });

  it("identifies full GPL texts despite their noncommercial distribution clauses", () => {
    expect(GPL2_TEXT).toContain("noncommercial");
    expect(GPL3_TEXT).toContain("noncommercially");
    expect(AGPL3_TEXT).toContain("noncommercially");
    expect(identifyLicenseText(GPL3_TEXT)).toEqual({ kind: "spdx", spdx: "GPL-3.0" });
  });

  it.each([
    ["Windows line endings and a BOM", `\uFEFF${MIT_TEXT.replace(/\n/g, "\r\n")}`],
    [
      "Markdown, bold letters and curly quotes",
      `# MIT License\n\n${MIT_TEXT.replace("Permission", "**P**ermission").replace(/"/g, "\u201C")}`,
    ],
    ["one paragraph per line", MIT_TEXT.replace(/([^\n])\n(?=[^\n])/g, "$1 ")],
    ["The MIT License (MIT) title", MIT_TEXT.replace("MIT License", "The MIT License (MIT)")],
  ])("identifies MIT with %s", (_label, text) => {
    expect(identifyLicenseText(text)).toEqual({ kind: "spdx", spdx: "MIT" });
  });

  it("identifies Apache-2.0 with Windows line endings and a BOM", () => {
    expect(identifyLicenseText(`\uFEFF${APACHE_TEXT.replace(/\n/g, "\r\n")}`)).toEqual({
      kind: "spdx",
      spdx: "Apache-2.0",
    });
  });

  it.each([
    ["the JSON license", `${MIT_TEXT}\nThe Software shall be used for Good, not Evil.\n`],
    ["MIT with an AI training restriction", `${MIT_TEXT}\nThis software may not be used to train AI models or resold.\n`],
    ["MIT for non-commercial use only", `${MIT_TEXT}\nFor non-commercial use only.\n`],
    ["MIT with the Commons Clause", `${MIT_TEXT}\n"Commons Clause" License Condition v1.0\n`],
    ["Apache with additional terms", `${APACHE_TEXT}\nAdditional terms: you may not use the Work for military purposes.\n`],
    [
      "a notice that mentions MIT and Apache",
      "# Project\nThis project is MIT. The vendored parser is licensed under the Apache License, Version 2.0.",
    ],
    ["the BSD 4-clause text", BSD4_TEXT],
    ["BSD-3-Clause-Clear", BSD3_CLEAR_TEXT],
    [
      "0BSD",
      'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.',
    ],
  ])("reports %s as restricted, never as the permissive license", (_label, text) => {
    expect(identifyLicenseText(text)).toEqual({ kind: "restricted" });
  });

  it("reports two licenses in one text as multiple", () => {
    expect(identifyLicenseText(`${MIT_TEXT}\n${APACHE_TEXT}`)).toEqual({ kind: "multiple" });
  });

  it.each([
    ["a custom text", CUSTOM_TEXT],
    ["an empty text", ""],
    ["a bare license name", "MIT License\n\nCopyright 2025 Acme"],
  ])("reports %s as unknown", (_label, text) => {
    expect(identifyLicenseText(text)).toEqual({ kind: "unknown" });
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
    ['"MIT"', "MIT"],
  ])("reads %j as a known SPDX id", (value, spdx) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "spdx", spdx });
  });

  it.each([
    ["MIT License", "MIT"],
    ["The MIT License", "MIT"],
    [" mit license. ", "MIT"],
    ["Apache 2.0", "Apache-2.0"],
    ["Apache-2", "Apache-2.0"],
    ["Apache License 2.0", "Apache-2.0"],
    ["Apache License 2", "Apache-2.0"],
    ["apache license, version 2.0", "Apache-2.0"],
    ["Apache License Version 2.0", "Apache-2.0"],
    ["BSD 3-Clause", "BSD-3-Clause"],
    ["BSD-3", "BSD-3-Clause"],
    ["New BSD", "BSD-3-Clause"],
    ["BSD 2-Clause", "BSD-2-Clause"],
    ["Simplified BSD", "BSD-2-Clause"],
    ["ISC License;", "ISC"],
  ])("reads the common spelling %j as a known SPDX id", (value, spdx) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "spdx", spdx });
  });

  it.each([
    ["Complete terms in LICENSE.txt", ["LICENSE.txt"]],
    ["Proprietary. LICENSE.txt has complete terms", ["LICENSE.txt"]],
    ["See LICENSE", ["LICENSE"]],
    ["see ./license.md.", ["license.md"]],
    ["Terms in TERMS.md and LICENSE", ["TERMS.md", "LICENSE"]],
    ["See ../../LICENSE", ["../../LICENSE"]],
  ])("reads %j as a reference to a file", (value, names) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "file", names });
  });

  it.each([
    ["MIT (see LICENSE)", "MIT", ["LICENSE"]],
    ["MIT. See LICENSE.txt", "MIT", ["LICENSE.txt"]],
    ["MIT, see LICENSE.txt", "MIT", ["LICENSE.txt"]],
    ["Apache License, Version 2.0 (see LICENSE)", "Apache-2.0", ["LICENSE"]],
  ])("reads the id stated before a reference in %j", (value, spdx, names) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "file", names, spdx });
  });

  it.each([
    "MIT OR Apache-2.0",
    "MIT AND ISC",
    "Apache-2.0 WITH LLVM-exception",
    "(MIT OR Apache-2.0), see LICENSE",
    "MIT, see LICENSE, or Apache-2.0",
  ])("reads %j as custom: dual licensing is not decided yet", (value) => {
    expect(identifyFrontmatterLicense(value)).toEqual({ kind: "custom" });
  });

  it.each(["Proprietary", "MIT-only", "BSD", "Apache", "MIT License v2", "see the license file", "", "[non-text value]"])(
    "reads %j as custom",
    (value) => {
      expect(identifyFrontmatterLicense(value)).toEqual({ kind: "custom" });
    },
  );
});

describe("resolveLicense, skill level", () => {
  it("identifies a license file in the skill folder", () => {
    const result = resolve({ ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT }, { skillPath: "skills/pdf" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "skill",
      evidence: [file("skills/pdf/LICENSE", MIT_TEXT, "skill", "MIT")],
    });
  });

  it("records the revision the resolution was computed from", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT },
      { skillPath: "skills/pdf", revision: "f".repeat(40) },
    );
    expect(result.revision).toBe("f".repeat(40));
  });

  it("identifies a known SPDX id in the front matter alone", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", frontmatterLicense: "apache-2.0" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "Apache-2.0",
      level: "skill",
      evidence: [
        { kind: "frontmatter", level: "skill", path: "skills/pdf/SKILL.md", value: "apache-2.0", spdx: "Apache-2.0" },
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
        file("skills/pdf/LICENSE.txt", APACHE_TEXT, "skill", "Apache-2.0"),
        {
          kind: "frontmatter",
          level: "skill",
          path: "skills/pdf/SKILL.md",
          value: "Complete terms in LICENSE.txt",
          spdx: null,
        },
      ],
    });
  });

  it("follows a reference to a file whose name is not a license name, in a subfolder", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/docs/TERMS.md": CUSTOM_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "Terms in docs/TERMS.md", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
    expect(result.evidence[0]).toEqual(file("skills/pdf/docs/TERMS.md", CUSTOM_TEXT, "skill"));
  });

  it("looks a referenced name up in the skill folder, then its ancestors, then the root", () => {
    const result = resolve(
      { ...skill("skills/x"), LICENSE: MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "MIT (see LICENSE)", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    // The referenced root file acts at the skill level and is recorded once.
    expect(result.evidence).toEqual([
      file("LICENSE", MIT_TEXT, "skill", "MIT"),
      { kind: "frontmatter", level: "skill", path: "skills/x/SKILL.md", value: "MIT (see LICENSE)", spdx: "MIT" },
      github("MIT"),
    ]);
    expect(decidingEvidence(result)).toEqual(file("LICENSE", MIT_TEXT, "skill", "MIT"));
  });

  it("prefers the nearest referenced file", () => {
    const result = resolve(
      { ...skill("skills/x"), "skills/LICENSE": APACHE_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "See LICENSE" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "Apache-2.0", level: "skill" });
  });

  it("is ambiguous when the id stated in the front matter disagrees with the referenced file", () => {
    const result = resolve(
      { ...skill("skills/x"), "skills/x/LICENSE.txt": APACHE_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "MIT. See LICENSE.txt" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("accepts a reference in another letter case when exactly one file matches", () => {
    const result = resolve(
      { ...skill("skills/x"), "skills/x/LICENSE.txt": MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "See license.TXT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });

  it("is ambiguous when a reference in another letter case matches two files", () => {
    const result = resolve(
      { ...skill("skills/x"), "skills/x/LICENSE.txt": MIT_TEXT, "skills/x/License.txt": MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "See license.TXT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("follows ../ inside the repository", () => {
    const result = resolve(
      { ...skill("skills/x"), LICENSE: MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "See ../../LICENSE" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });

  it("is ambiguous when a reference leaves the repository", () => {
    const result = resolve(
      { ...skill("skills/x"), LICENSE: MIT_TEXT },
      { skillPath: "skills/x", frontmatterLicense: "See ../../../LICENSE", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("is ambiguous when the front matter points to a missing file", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "Complete terms in TERMS.txt", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
    expect("spdx" in result).toBe(false);
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
  });

  it("is ambiguous with a known id next to unidentified text", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT, "skills/pdf/COPYING": CUSTOM_TEXT },
      { skillPath: "skills/pdf" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it("is ambiguous with a file holding two licenses", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": `${MIT_TEXT}\n${APACHE_TEXT}` },
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
    expect(result.evidence.map((entry) => [entry.kind, entry.level])).toEqual([
      ["file", "skill"],
      ["file", "repository"],
      ["github", "repository"],
    ]);
  });

  it("lets a front matter id alone decide, whatever the root says", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", frontmatterLicense: "MIT", githubLicense: "Apache-2.0" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });

  it("reports an unknown front matter value as custom", () => {
    const result = resolve(skill("skills/pdf"), {
      skillPath: "skills/pdf",
      frontmatterLicense: "Proprietary",
      githubLicense: "MIT",
    });
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it("does not let an auxiliary file decide", () => {
    const csv = "name,license\nx,GPL-3.0";
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT, "skills/pdf/LICENSE-3rdparty.csv": csv },
      { skillPath: "skills/pdf" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    expect(result.evidence).toContainEqual({
      kind: "file",
      level: "skill",
      path: "skills/pdf/LICENSE-3rdparty.csv",
      blob: sha(csv),
      status: "auxiliary",
      spdx: null,
    });
  });

  it("falls through to farther levels when the skill folder has only an auxiliary file", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE.json": "{}", LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "repository" });
  });

  it("is ambiguous when a skill-level file could not be read", () => {
    const result = resolve(
      { ...skill("skills/pdf"), "skills/pdf/LICENSE": MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
      { unread: ["skills/pdf/LICENSE"] },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "skill", unread: "license-file" });
    expect(result.evidence[0]).toMatchObject({ status: "unread", spdx: null });
  });
});

describe("resolveLicense, ancestors", () => {
  it("uses a license file of an ancestor folder", () => {
    const result = resolve(
      { ...skill("plugins/docs/skills/pdf"), "plugins/docs/LICENSE": BSD3_TEXT, LICENSE: MIT_TEXT },
      { skillPath: "plugins/docs/skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "BSD-3-Clause", level: "ancestor" });
  });

  it("lets the nearest ancestor folder with a license decide, and records the farther ones", () => {
    const result = resolve(
      { ...skill("a/b/skill"), "a/b/LICENSE": MIT_TEXT, "a/LICENSE": APACHE_TEXT },
      { skillPath: "a/b/skill" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "ancestor" });
    expect(result.evidence).toEqual([
      file("a/b/LICENSE", MIT_TEXT, "ancestor", "MIT"),
      file("a/LICENSE", APACHE_TEXT, "ancestor", "Apache-2.0"),
    ]);
    expect(decidingEvidence(result)).toEqual(file("a/b/LICENSE", MIT_TEXT, "ancestor", "MIT"));
  });

  it("keeps the nearest ancestor's custom text even when a farther one is permissive", () => {
    const result = resolve(
      { ...skill("a/b/skill"), "a/b/LICENSE": CUSTOM_TEXT, "a/LICENSE": MIT_TEXT },
      { skillPath: "a/b/skill" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "ancestor" });
  });

  it("is ambiguous with two different licenses in the nearest ancestor folder", () => {
    const result = resolve(
      {
        ...skill("a/b/skill"),
        "a/b/LICENSE-MIT": MIT_TEXT,
        "a/b/LICENSE-APACHE": APACHE_TEXT,
        "a/LICENSE": MIT_TEXT,
      },
      { skillPath: "a/b/skill" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "ancestor" });
  });

  it("uses a nested skill's parent skill folder license as an ancestor", () => {
    const result = resolve(
      { ...skill("skills/parent"), ...skill("skills/parent/child"), "skills/parent/LICENSE": ISC_TEXT },
      { skillPath: "skills/parent/child" },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "ISC", level: "ancestor" });
  });

  it("is ambiguous when the deciding ancestor file could not be read, not when a farther one could not", () => {
    const files = { ...skill("a/b/skill"), "a/b/LICENSE": MIT_TEXT, "a/LICENSE": APACHE_TEXT };
    expect(resolve(files, { skillPath: "a/b/skill" }, { unread: ["a/LICENSE"] })).toMatchObject({
      outcome: "identified",
      spdx: "MIT",
    });
    expect(resolve(files, { skillPath: "a/b/skill" }, { unread: ["a/b/LICENSE"] })).toMatchObject({
      outcome: "ambiguous",
      level: "ancestor",
      unread: "license-file",
    });
  });
});

describe("resolveLicense, repository level", () => {
  it("identifies a repository root file that agrees with GitHub", () => {
    const result = resolve({ ...skill("skills/pdf"), LICENSE: MIT_TEXT }, { skillPath: "skills/pdf", githubLicense: "MIT" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "repository",
      evidence: [file("LICENSE", MIT_TEXT, "repository", "MIT"), github("MIT")],
    });
  });

  it("is ambiguous when an identified root file meets another id detected by GitHub", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "Apache-2.0" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "repository" });
  });

  it.each([null, "NOASSERTION"])("lets an identified root file decide when GitHub reports %j", (githubLicense) => {
    const result = resolve({ ...skill("skills/pdf"), LICENSE: MIT_TEXT }, { skillPath: "skills/pdf", githubLicense });
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "repository" });
    expect(decidingEvidence(result)).toEqual(file("LICENSE", MIT_TEXT, "repository", "MIT"));
  });

  it("uses GitHub's detection when the root file is unknown, and records it", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", githubLicense: "Apache-2.0" },
    );
    expect(result).toEqual({
      outcome: "identified",
      spdx: "Apache-2.0",
      level: "repository",
      evidence: [file("LICENSE", CUSTOM_TEXT, "repository"), github("Apache-2.0")],
    });
    expect(decidingEvidence(result)).toEqual(github("Apache-2.0"));
  });

  it("never uses GitHub's id for a root file that restricts a permissive license", () => {
    const restricted = `${MIT_TEXT}\nFor non-commercial use only.\n`;
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: restricted },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "repository" });
    expect(result.evidence[0]).toMatchObject({ status: "restricted", spdx: null });
  });

  it("never uses GitHub's id for a root file holding two licenses", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: `${MIT_TEXT}\n${APACHE_TEXT}` },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "repository" });
  });

  it("is custom when the root file is unknown and GitHub detects nothing", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: CUSTOM_TEXT },
      { skillPath: "skills/pdf", githubLicense: "NOASSERTION" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "repository" });
  });

  it("is ambiguous, not GitHub's id, when the root file could not be read", () => {
    const result = resolve(
      { ...skill("skills/pdf"), LICENSE: MIT_TEXT },
      { skillPath: "skills/pdf", githubLicense: "MIT" },
      { unread: ["LICENSE"] },
    );
    expect(result).toMatchObject({ outcome: "ambiguous", level: "repository", unread: "license-file" });
  });

  it("uses GitHub's detection alone when there is no license file", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", githubLicense: "MIT" });
    expect(result).toEqual({ outcome: "identified", spdx: "MIT", level: "repository", evidence: [github("MIT")] });
  });

  it("is missing with GitHub detecting nothing and no file", () => {
    const result = resolve({ ...skill("skills/pdf"), "README.md": "x" }, { skillPath: "skills/pdf" });
    expect(result).toEqual({ outcome: "missing", level: "none", evidence: [] });
  });

  it("is missing with GitHub answering NOASSERTION and no file, and records the answer", () => {
    const result = resolve(skill("skills/pdf"), { skillPath: "skills/pdf", githubLicense: "NOASSERTION" });
    expect(result).toEqual({ outcome: "missing", level: "none", evidence: [github("NOASSERTION")] });
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
});

describe("resolveLicense, root skill", () => {
  it("uses GitHub's id when its root file is unknown, like any skill", () => {
    const result = resolve({ "SKILL.md": "x", LICENSE: CUSTOM_TEXT }, { skillPath: "", githubLicense: "MIT" });
    expect(result).toEqual({
      outcome: "identified",
      spdx: "MIT",
      level: "repository",
      evidence: [file("LICENSE", CUSTOM_TEXT, "skill"), github("MIT")],
    });
    expect(decidingEvidence(result)).toEqual(github("MIT"));
  });

  it("never uses GitHub's id when its root file is restricted", () => {
    const result = resolve(
      { "SKILL.md": "x", LICENSE: `${MIT_TEXT}\nFor non-commercial use only.\n` },
      { skillPath: "", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it.each([null, "NOASSERTION"])("stays custom when its root file is unknown and GitHub reports %j", (githubLicense) => {
    const result = resolve({ "SKILL.md": "x", LICENSE: CUSTOM_TEXT }, { skillPath: "", githubLicense });
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it("is ambiguous when its identified root file disagrees with GitHub", () => {
    expect(resolve({ "SKILL.md": "x", LICENSE: MIT_TEXT }, { skillPath: "", githubLicense: "Apache-2.0" })).toMatchObject({
      outcome: "ambiguous",
      level: "skill",
    });
    expect(
      resolve(
        { "SKILL.md": "x", LICENSE: MIT_TEXT },
        { skillPath: "", frontmatterLicense: "MIT", githubLicense: "Apache-2.0" },
      ),
    ).toMatchObject({ outcome: "ambiguous", level: "skill" });
  });

  it.each([null, "NOASSERTION", "MIT"])(
    "is identified from its identified root file when GitHub reports %j",
    (githubLicense) => {
      const result = resolve({ "SKILL.md": "x", LICENSE: MIT_TEXT }, { skillPath: "", githubLicense });
      expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    },
  );

  it("stays custom when its front matter is custom, whatever GitHub detects", () => {
    const result = resolve(
      { "SKILL.md": "x", LICENSE: CUSTOM_TEXT },
      { skillPath: "", frontmatterLicense: "Proprietary", githubLicense: "MIT" },
    );
    expect(result).toMatchObject({ outcome: "custom", level: "skill" });
  });

  it("identifies a root skill from its root file and front matter", () => {
    const result = resolve({ "SKILL.md": "x", "LICENSE.md": MIT_TEXT }, { skillPath: "", frontmatterLicense: "MIT" });
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
    expect(result.evidence).toContainEqual({
      kind: "frontmatter",
      level: "skill",
      path: "SKILL.md",
      value: "MIT",
      spdx: "MIT",
    });
  });
});

describe("symbolic links", () => {
  const entries: TreeEntry[] = [
    { path: "LICENSE", type: "blob", sha: sha(MIT_TEXT), mode: "100644" },
    { path: "skills/x/LICENSE", type: "blob", sha: sha("../../LICENSE"), mode: LINK },
    { path: "skills/y/LICENSE", type: "blob", sha: sha("../x/LICENSE"), mode: LINK },
  ];
  const index = indexLicenseFiles(entries);
  const link = (path: string): LicenseFileRef => ({ path, blob: "0".repeat(40), mode: LINK });

  it("resolves a link to a regular file inside the repository", () => {
    expect(resolveLinkTarget(index, link("skills/x/LICENSE"), "../../LICENSE\n")).toEqual({
      path: "LICENSE",
      blob: sha(MIT_TEXT),
      mode: "100644",
    });
  });

  it.each([
    ["leaving the repository", "../../../LICENSE"],
    ["an absolute path", "/etc/passwd"],
    ["a missing file", "../../COPYING"],
    ["another link", "../y/LICENSE"],
  ])("refuses a link to %s", (_label, target) => {
    expect(resolveLinkTarget(index, link("skills/x/LICENSE"), target)).toBeUndefined();
  });

  it("resolves a skill whose license file is a link", () => {
    const result = resolve(
      { ...skill("skills/x"), LICENSE: MIT_TEXT },
      { skillPath: "skills/x", githubLicense: "MIT" },
      { links: { "skills/x/LICENSE": "../../LICENSE" } },
    );
    expect(result).toMatchObject({ outcome: "identified", spdx: "MIT", level: "skill" });
  });
});

describe("licenseFilesFor", () => {
  it("lists the deciding files of every level and the referenced files, never the auxiliary ones", () => {
    const { index } = setup({
      files: {
        ...skill("a/skill"),
        "a/skill/LICENSE": MIT_TEXT,
        "a/skill/LICENSE-3rdparty.csv": "x",
        "a/skill/TERMS.md": CUSTOM_TEXT,
        "a/COPYING": GPL3_TEXT,
        LICENSE: MIT_TEXT,
        "other/LICENSE": APACHE_TEXT,
      },
    });
    const files = licenseFilesFor(index, {
      skillPath: "a/skill",
      frontmatterLicense: "See TERMS.md",
      githubLicense: null,
      truncated: false,
    });
    expect(files.map((entry) => entry.path)).toEqual(["a/skill/LICENSE", "a/skill/TERMS.md", "a/COPYING", "LICENSE"]);
  });
});

describe("eligibility", () => {
  const identified = (spdx: string): LicenseResolution => ({
    outcome: "identified",
    spdx,
    level: "repository",
    evidence: [github(spdx)],
  });
  const allowed = ["MIT", "Apache-2.0"];

  it("accepts an identified allowed license", () => {
    expect(licenseIneligibility(identified("MIT"), allowed)).toBeNull();
  });

  it.each([
    ["not allowed", identified("GPL-3.0"), "license GPL-3.0 not allowed"],
    ["custom", { outcome: "custom", level: "skill", evidence: [] } satisfies LicenseResolution, "license custom"],
    ["ambiguous", { outcome: "ambiguous", level: "none", evidence: [] } satisfies LicenseResolution, "license ambiguous"],
    ["missing", { outcome: "missing", level: "none", evidence: [] } satisfies LicenseResolution, "license missing"],
    ["not re-read", notReReadLicense(), "license not re-read"],
    [
      "a license file not read",
      { outcome: "ambiguous", level: "skill", unread: "license-file", evidence: [] } satisfies LicenseResolution,
      "license not re-read",
    ],
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
    expect(decidingEvidence(result)).toEqual(file("skills/pdf/LICENSE", MIT_TEXT, "skill", "MIT"));
  });

  it("returns nothing when the license is not identified", () => {
    expect(decidingEvidence(resolve(skill("skills/pdf"), { skillPath: "skills/pdf" }))).toBeUndefined();
  });
});

describe("license cache file", () => {
  const blob = "a".repeat(40);

  it("uses rules version 2", () => {
    expect(LICENSE_RULES_VERSION).toBe(2);
  });

  it("reads the entries written with the current rules version", () => {
    const entries = { [blob]: { kind: "spdx", spdx: "MIT" }, ["b".repeat(40)]: { kind: "restricted" } };
    expect(readLicenseCache({ rulesVersion: LICENSE_RULES_VERSION, entries })).toEqual(entries);
  });

  it.each([
    ["the previous rules version", { rulesVersion: 1, entries: { [blob]: { spdx: "MIT" } } }],
    ["another rules version", { rulesVersion: LICENSE_RULES_VERSION + 1, entries: { [blob]: { kind: "unknown" } } }],
    ["the shape written before rules versions", { [blob]: { spdx: "MIT" } }],
    ["no file", undefined],
  ])("discards %s, so every text is identified again", (_label, data) => {
    expect(readLicenseCache(data)).toEqual({});
  });

  it("rejects a current-version file with an invalid entry", () => {
    expect(() =>
      readLicenseCache({ rulesVersion: LICENSE_RULES_VERSION, entries: { LICENSE: { kind: "unknown" } } }),
    ).toThrow();
    expect(() => readLicenseCache({ rulesVersion: LICENSE_RULES_VERSION, entries: { [blob]: { spdx: "MIT" } } })).toThrow();
  });

  it("writes the rules version and the entries sorted by blob id", () => {
    const data = licenseCacheFile({ ["b".repeat(40)]: { kind: "unknown" }, [blob]: { kind: "spdx", spdx: "MIT" } });
    expect(data.rulesVersion).toBe(LICENSE_RULES_VERSION);
    expect(Object.keys(data.entries)).toEqual([blob, "b".repeat(40)]);
  });
});

describe("gitBlobId", () => {
  it("matches git hash-object", () => {
    // printf 'hello\n' | git hash-object --stdin
    expect(gitBlobId(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("publication", () => {
  const record = (license: LicenseResolution | undefined): SkillRecord => {
    const { license: _default, ...rest } = makeSkill();
    return license === undefined ? rest : { ...rest, license };
  };
  const identified = (spdx: string): LicenseResolution => ({
    outcome: "identified",
    spdx,
    level: "repository",
    evidence: [github(spdx)],
  });
  const allowed = ["MIT", "Apache-2.0"];
  const cleared = (): boolean => true;
  const notCleared = (): boolean => false;

  it("publishes an identified allowed license, scan or not", () => {
    for (const scan of [cleared, notCleared]) {
      expect(publication(record(identified("MIT")), allowed, scan)).toEqual({ status: "publishable" });
      expect(isPublishable(record(identified("MIT")), allowed, scan)).toBe(true);
    }
  });

  it.each([
    ["an identified non-permissive license", identified("GPL-3.0")],
    ["a missing license", { outcome: "missing", level: "none", evidence: [] } satisfies LicenseResolution],
    ["a custom license", { outcome: "custom", level: "skill", evidence: [] } satisfies LicenseResolution],
    ["an ambiguous license", { outcome: "ambiguous", level: "repository", evidence: [] } satisfies LicenseResolution],
  ])("publishes %s only once the safety scan clears the skill", (_label, license) => {
    expect(publication(record(license), allowed, cleared)).toEqual({ status: "publishable" });
    expect(isPublishable(record(license), allowed, cleared)).toBe(true);
    expect(publication(record(license), allowed, notCleared)).toEqual({
      status: "waiting",
      reason: "waiting for the safety scan",
    });
    expect(isPublishable(record(license), allowed, notCleared)).toBe(false);
  });

  it.each([
    ["a license file not read", { outcome: "ambiguous", level: "skill", unread: "license-file", evidence: [] } satisfies LicenseResolution, "license not re-read"],
    ["a SKILL.md not read", notReReadLicense(), "license not re-read"],
    ["no resolution", undefined, "license unresolved"],
  ])("never publishes a skill with %s in this run, even when cleared", (_label, license, reason) => {
    for (const scan of [cleared, notCleared]) {
      expect(publication(record(license), allowed, scan)).toEqual({ status: "waiting", reason });
      expect(isPublishable(record(license), allowed, scan)).toBe(false);
    }
  });

  it("consults the safety scan only for a license that is not allowed or not clear", () => {
    const calls: string[] = [];
    const scan = (skill: SkillRecord): boolean => {
      calls.push(skill.license?.outcome ?? "none");
      return true;
    };
    publication(record(identified("MIT")), allowed, scan);
    publication(record(notReReadLicense()), allowed, scan);
    publication(record(undefined), allowed, scan);
    expect(calls).toEqual([]);
    publication(record(identified("GPL-3.0")), allowed, scan);
    expect(calls).toEqual(["identified"]);
  });

  it("clears no skill by default", () => {
    expect(NO_SAFETY_SCAN(record(undefined))).toBe(false);
  });

  it.each([
    [identified("MIT"), "MIT"],
    [{ outcome: "missing", level: "none", evidence: [] } satisfies LicenseResolution, "No license"],
    [{ outcome: "custom", level: "skill", evidence: [] } satisfies LicenseResolution, "Unclear license"],
    [{ outcome: "ambiguous", level: "skill", evidence: [] } satisfies LicenseResolution, "Unclear license"],
  ])("labels %j as %s", (license, label) => {
    expect(licenseLabel(license)).toBe(label);
  });

  it.each([
    [identified("MIT"), "permissive"],
    [identified("Apache-2.0"), "permissive"],
    [identified("ISC"), "other"],
    [identified("GPL-3.0"), "copyleft"],
    [identified("AGPL-3.0"), "copyleft"],
    [identified("LGPL-2.1"), "copyleft"],
    [identified("MPL-2.0"), "copyleft"],
    [identified("CC-BY-SA-4.0"), "copyleft"],
    [identified("CC0-1.0"), "other"],
    [identified("CC-BY-4.0"), "other"],
    [{ outcome: "missing", level: "none", evidence: [] } satisfies LicenseResolution, "none"],
    [{ outcome: "custom", level: "skill", evidence: [] } satisfies LicenseResolution, "unclear"],
    [{ outcome: "ambiguous", level: "skill", evidence: [] } satisfies LicenseResolution, "unclear"],
  ])("puts %j in the %s category", (license, category) => {
    // ISC is identified but not in this allowed list: other.
    expect(licenseCategory(license, allowed)).toBe(category);
  });
});
