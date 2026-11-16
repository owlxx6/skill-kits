# License resolution contract (option B)

Status: proposed on `claude/license-resolution`. Fields marked *new* are additive; nothing existing changes meaning until this PR is accepted.

## Goal

Decide license eligibility per skill, from evidence, instead of rejecting whole repositories whose GitHub-detected license is missing or not on the allowed list. A publisher's reputation never stands in for a license: a skill is published only when evidence shows an allowed license applies to it.

## Rules

### 1. Repository filter (`pipeline/filter.ts`)

A repository is no longer rejected for its license. It is still rejected when it is not found, archived, has no valid push date, or is inactive beyond `filter.maxDaysSinceLastCommit`.

`filter.minStars` stays a discovery bound for topic search results only. A repository listed in `data/sources.yaml` (an explicit nomination) is never rejected for its star count. The broader low-star discovery and ranking redesign is a follow-up (see "Follow-ups").

`RepoMeta.license` keeps its meaning: the SPDX id GitHub detected for the repository, `NOASSERTION`, or `null`. It is evidence, not a decision.

### 2. Evidence (`pipeline/extract.ts`, `pipeline/lib/license.ts`)

For each skill, evidence is gathered from the repository tree, nearest level first:

| Level | Evidence |
|---|---|
| `skill` | License files directly in the skill folder; the `license` field of the SKILL.md front matter |
| `ancestor` | License files in folders between the skill folder and the repository root, nearest first. A parent skill folder is an ancestor of a nested skill |
| `repository` | License files at the repository root; the SPDX id GitHub detected |

License files are matched by name, case-insensitively: `LICENSE`, `LICENCE`, `COPYING`, alone or with an extension or suffix (`LICENSE.txt`, `LICENSE.md`, `LICENSE-MIT`, `COPYING.LESSER`). A name with a source-code extension (`license.py`, `license.ts`) is code, not a license file. For a skill at the repository root, root files count at the `skill` level.

A license text is identified conservatively from distinctive phrases (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, AGPL-3.0, with the version where a family has several). Case, line breaks, Markdown marks and curly quotes are ignored. A text is identified only when exactly one license matches and no restricting term appears ("Commons Clause", "non-commercial"); the BSD advertising clause (BSD-4) is not BSD-3-Clause. Anything else is `custom`; a text is never guessed. A license file that cannot be downloaded counts as unidentified for that run.

A front matter `license` value (trimmed, control characters removed, at most 200 characters; a list or number is kept as text) is read as follows, case-insensitively:

- An SPDX id from the known list is that id. The GNU ids also accept `-only` and `-or-later` (`GPL-3.0-or-later` is `GPL-3.0`, as GitHub reports it).
- A common spelling that names one license without doubt is that id: "MIT License", "The MIT License" (MIT); "Apache 2.0", "Apache-2", "Apache License 2.0", "Apache License, Version 2.0" (Apache-2.0); "BSD 3-Clause", "BSD-3", "New BSD" (BSD-3-Clause); "BSD 2-Clause", "Simplified BSD" (BSD-2-Clause); "ISC License" (ISC).
- An SPDX expression (upper-case `OR`, `AND` or `WITH`) is `custom`, even when it also names a file: dual licensing is not decided yet.
- A value that names files defers to those files at their exact path in the skill folder ("Complete terms in LICENSE.txt"). A file is named by a license file name with an extension or suffix, an upper-case `LICENSE`, `LICENCE` or `COPYING`, or a name with a text extension (`.txt`, `.md`, `.markdown`, `.rst`, `.text`). A named file that is not a license file name (`TERMS.md`) is read and identified too.
- Any other value is `custom`.

### 3. Resolution

The deciding level is the nearest level that has any evidence. Farther levels are recorded but do not override it. Within the `ancestor` level, the nearest ancestor folder that has a license file decides: a nearer license governs its subtree, and farther ancestor files are only recorded.

| Outcome | When |
|---|---|
| `identified` | Every piece of evidence at the deciding level identifies the same SPDX id |
| `custom` | Evidence exists at the deciding level but none of it is identified |
| `ambiguous` | Evidence at the deciding level disagrees (two different ids, or a known id next to unidentified text, including two different licenses in the same folder), or the front matter points to a file that does not exist, or an identified root file disagrees with another id GitHub detected, or the tree listing was truncated and no skill-level evidence was found (level `none`) |
| `missing` | No evidence at any level, and GitHub detected nothing (`null` or `NOASSERTION`) |

GitHub's `null` or `NOASSERTION` is the absence of a detection, not a disagreement. At the `repository` level:

- Root files identified with one id decide, unless GitHub detected a different id: then the outcome is `ambiguous`.
- Root files none of which is identified defer to GitHub's detected id, recorded as `github` evidence; without a detection the outcome is `custom`.
- No root file: GitHub's detected id is used; without a detection the outcome is `missing`.

A skill at the repository root follows the same rules for its root license files: an unidentified root file defers to GitHub's id (level `repository`, `github` evidence), and an identified root file that disagrees with GitHub's id is `ambiguous`. When its front matter has a `license` value, the skill level decides as for any skill, and an identified root file still must not disagree with GitHub's id.

GitHub's answer is recorded as `github` evidence whenever it is not `null`.

Dual licensing (two different licenses offered as a choice) is not decided yet: two license files that disagree are `ambiguous`, and an SPDX expression in the front matter is `custom`. Both keep the skill out of the catalog until the owner decides how to present a choice.

### 4. Eligibility (`pipeline/rank.ts`)

A skill can enter the catalog only if its outcome is `identified` and its SPDX id is in `filter.allowedLicenses`. Every other outcome keeps it out of the catalog. An approved skill that loses eligibility is reported as removed with the reason `license <outcome>` or `license <spdx> not allowed`.

A collection (whole-repository install) is listed only if every extracted skill of the repository is eligible, because installing the repository installs all of them. Individual eligible skills from that repository stay listed.

Triage and review selection skip skills that are not eligible, approved ones included, so no model call is spent on a skill that cannot be published. An approved skill that is not eligible is removed, never kept pending.

An approved collection that is no longer listed because of licenses is reported with the reason `license not eligible for <n> of <m> skills of the repository`.

### 5. Caching and invalidation

The resolution is recomputed for every skill on every extract run, from the current tree. Identified license texts are cached by git blob id in `data/cache/licenses.json` (*new*, versioned like the reviews): a changed license file has a new blob id and is identified again; an unchanged one is not downloaded again. A license file that changes outside the skill folder (ancestor or root) is therefore picked up even though the skill's own fingerprint does not change. Reviews stay keyed by the skill fingerprint and are not affected by license changes.

The cache file records the version of the identification rules: `{ "rulesVersion": 1, "entries": { "<blob id>": { "spdx": "MIT" | null } } }`, entries sorted by blob id. A file with another version, or in a shape without a version, is discarded and replaced, and every license text is identified again. The version (`LICENSE_RULES_VERSION` in `pipeline/lib/license.ts`) is bumped whenever text identification or license file matching changes. A failed download is never cached. The cache is saved after each repository that added entries. A dry run uses `.dry-run/cache/licenses.json`.

### 6. Old records

`SkillRecord.license` (*new*) is optional when reading. A record without it (written before this change, or kept from a failed or truncated read) is treated as unresolved: not eligible, never silently assigned a license, and reported as `license unresolved` when approved. The next successful extract of its repository fills it: its SKILL.md is read again once, so the front matter is known before the license is resolved. A record kept from a failed SKILL.md download, a failed repository read, or past the cut of a truncated listing keeps its previous `license`, or none.

## Data fields

### `SkillRecord.license` (*new*, cache only)

```json
{
  "outcome": "identified",
  "spdx": "Apache-2.0",
  "level": "skill",
  "evidence": [
    { "kind": "file", "path": "skills/pdf/LICENSE.txt", "blob": "<git blob id>", "spdx": "Apache-2.0" },
    { "kind": "frontmatter", "path": "skills/pdf/SKILL.md", "value": "Complete terms in LICENSE.txt", "spdx": null }
  ]
}
```

`outcome`: `identified` | `custom` | `ambiguous` | `missing`. `spdx`: set only when `identified`. `level`: `skill` | `ancestor` | `repository` | `none` (`none` for `missing` and for a truncated listing without skill-level evidence). `evidence[].kind`: `file` | `frontmatter` | `github`, listed skill level first (files, then front matter), then ancestors nearest first, then root files, then GitHub. A `github` entry is `{ "kind": "github", "value": <RepoMeta.license>, "spdx": <id, or null for NOASSERTION> }`.

### Run statistics (`pipeline-run.json`)

`extract.licenses` (*new*, optional so older run information still loads): counts of the skills kept after extraction, `identifiedAllowed`, `identifiedNotAllowed`, `custom`, `ambiguous`, `missing`, `unresolved`, and `failedDownloads` (license files that could not be read). The pull request summary shows them on one line of the Run section.

### Catalog (`catalog.json`, read by the site)

- `skills[].license`: unchanged type (string). It now holds the SPDX id resolved for the skill, which can differ from its repository's.
- `skills[].licenseEvidence` (*new*, optional): `{ "level": "skill" | "ancestor" | "repository", "path": string | null, "url": string | null }`, from the first evidence of the deciding level that names the resolved id (a file before the front matter, a root file before GitHub). `url` points to the evidence file (`https://github.com/<repo>/blob/<branch>/<path>`, SKILL.md for front matter evidence), or to the repository when the evidence is GitHub's detection (`path` is then null).
- `collections[].license`: unchanged type. It holds the single SPDX id when all skills of the repository share it, otherwise `Mixed`.
- `collections[].licenses` (*new*, optional): the sorted SPDX ids of all skills of the repository (all eligible when the collection is listed), since installing the collection installs every one of them.

Both new catalog fields are optional so the current site keeps building on an old `catalog.json`. Text the site shows about selection (the methodology page currently says repositories need a permissive license and at least 50 stars) becomes outdated once this lands; that page belongs to the design branch.

## Catalog impact

Documented in the pull request after a run on the existing cache: outcomes per level, skills from formerly excluded repositories that become eligible, and collections that lose whole-repository eligibility because of mixed licenses. No catalog entry is added without a review and the owner's approval.

## Follow-ups (not in this change)

- Low-star discovery: separate lanes (topic relevance, targeted searches, nominations) with review budgets, instead of one `minStars` bound.
- Ranking: the 30% repository-signal share of the skill score favours popularity; replace with task evidence and reliability, keeping popularity as context.
- Reviews truncated at `review.maxSkillChars` (24,000 characters) must be marked incomplete or chunked, not counted as full reviews.
- Session reviews need a schema-validated import path into the cache and the summary.
- The 40,000-skill cache exists only on the Mac; nine CV reviews are provisional (listed in the pull request).
