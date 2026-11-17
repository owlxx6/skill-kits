# License resolution contract (option B)

Status: proposed on `claude/license-resolution`. Fields marked *new* are additive; nothing existing changes meaning until this PR is accepted.

## Goal

Resolve the license of each skill from evidence, instead of rejecting whole repositories whose GitHub-detected license is missing or not on the allowed list, and show it honestly. A publisher's reputation never stands in for a license: a skill is shown with an allowed license only when evidence shows that license applies to it. Which skills are published is set by the publication policy below.

## Publication policy

Owner decision (pull request #1): skills whose license is not allowed or not usable are published too, but only once an automated safety scan finds nothing blocking in them, and always displayed honestly.

- A skill whose license is identified and in `filter.allowedLicenses` is published, as before.
- A skill whose license is identified but not allowed (GPL, AGPL, LGPL, MPL, CC-BY-SA, CC0, CC-BY...), missing, or unclear (`custom`, or `ambiguous` after every file was read) is published only once the safety scan clears it.
- A skill whose license was not re-read this run (`unread`), or that has no resolution yet, is not published in this run.
- The catalog shows the SPDX id for any identified license, `No license` for a missing one and `Unclear license` for a custom or ambiguous one: never a permissive id without evidence. A license category (`permissive`, `copyleft`, `other`, `none`, `unclear`) lets the site explain the obligations.

The safety scan (`docs/SAFETY-SCAN.md`) clears a skill when its report, made at the last extraction, has the verdict `clear`. The pipeline takes the scan as a function (`isSafetyCleared`; `NO_SAFETY_SCAN`, which clears nothing, is the default of the library functions and applies when no report exists). A skill that needs the scan and has no `clear` report stays out of the catalog, and an approved one stays pending with the reason `waiting for the safety scan`, whatever its verdict (`review`, `block`, or not scanned).

## Rules

### 1. Repository filter (`pipeline/filter.ts`)

A repository is no longer rejected for its license. It is still rejected when it is not found, archived, has no valid push date, or is inactive beyond `filter.maxDaysSinceLastCommit`.

`filter.minStars` stays a discovery bound for topic search results only. A repository listed in `data/sources.yaml` (an explicit nomination) is never rejected for its star count. The broader low-star discovery and ranking redesign is a follow-up (see "Follow-ups").

`RepoMeta.license` keeps its meaning: the SPDX id GitHub detected for the repository, `NOASSERTION`, or `null`. It is evidence, not a decision.

### 2. Evidence (`pipeline/extract.ts`, `pipeline/lib/license.ts`)

For each skill, evidence is gathered from the repository tree, nearest level first:

| Level | Evidence |
|---|---|
| `skill` | License files directly in the skill folder; the `license` field of the SKILL.md front matter, and the files it names |
| `ancestor` | License files in folders between the skill folder and the repository root, nearest first. A parent skill folder is an ancestor of a nested skill |
| `repository` | License files at the repository root; the SPDX id GitHub detected |

License files are recorded by name, case-insensitively: `LICENSE`, `LICENCE`, `COPYING` or `UNLICENSE`, alone or followed by an extension or suffix. A name with a source-code extension (`license.py`, `license.ts`) is code, not a license file. For a skill at the repository root, root files count at the `skill` level.

Only some recorded files decide: the base name alone, with `.txt`, `.md` or `.rst`, or with a `-<id>`, `.<id>` or `_<id>` suffix (`LICENSE-MIT`, `LICENSE.APACHE`, `COPYING.LESSER`, `LICENSE-MIT.txt`). Auxiliary files are recorded as evidence (status `auxiliary`) but are not read and never decide, and a level that has only auxiliary files has no evidence: names containing `third-party`, `thirdparty`, `3rdparty`, `notice`, `header` or `template`, and data files (`.csv`, `.json`, `.yaml`, `.yml`, `.html`, `.xml`). `LICENSE-3rdparty.csv` next to an MIT `LICENSE` leaves the skill MIT.

A license file that is a symbolic link (git mode `120000`) is followed one hop to a regular file inside the repository; any other link is not read.

A license text is identified as one of four results:

- `spdx`: a known license. The allowed licenses (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0) are compared word by word with canonical templates (`pipeline/lib/license-templates.ts`; for Apache-2.0, the full text, the text without its appendix, and the standard short header). Case, punctuation, quotes, Markdown marks, a BOM, line endings, leading title lines and copyright lines are ignored. The text must add at most 5 words to a template, keep at least 98% of its words in order, and add no restricting word (such as "commercial", "only", "not", "resold", "train", "military"). The GNU licenses (GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, AGPL-3.0, none of them allowed) are identified by their title and version alone, so the noncommercial distribution clauses of their own full texts do not hide them.
- `restricted`: the distinctive phrase of a permissive license without a faithful copy of its text, or with a restricting word added. The JSON license, MIT with an added use restriction, Apache-2.0 with additional terms, BSD-4-Clause, BSD-3-Clause-Clear, 0BSD, or a notice that merely mentions a license are all `restricted`.
- `multiple`: phrases of several licenses in one text.
- `unknown`: no known license phrase. Only this result may defer to GitHub's detection (see Resolution).

A file is `unread` for the run when its download fails, when the downloaded bytes do not have the git blob id listed in the tree (the tree is listed by branch name and the branch can move before the download; the blob id is checked on the raw bytes, BOM included), or when a link cannot be followed.

A front matter `license` value is cleaned (trimmed, control characters removed, at most 200 characters). A string, number or boolean is kept as text; a list, map or any other value becomes the marker `[non-text value]`, which is `custom` (never serialized, since YAML aliases can be circular). The value is read as follows, case-insensitively, ignoring surrounding quotes and trailing punctuation:

- An SPDX id from the known list is that id. The GNU ids also accept `-only` and `-or-later` (`GPL-3.0-or-later` is `GPL-3.0`, as GitHub reports it).
- A common spelling that names one license without doubt is that id: "MIT License", "The MIT License" (MIT); "Apache 2.0", "Apache-2", "Apache License 2", "Apache License 2.0", "Apache License, Version 2.0", "Apache License Version 2.0" (Apache-2.0); "BSD 3-Clause", "BSD-3", "New BSD" (BSD-3-Clause); "BSD 2-Clause", "Simplified BSD" (BSD-2-Clause); "ISC License" (ISC).
- An SPDX expression (upper-case `OR`, `AND` or `WITH`) is `custom`, even when it also names a file: dual licensing is not decided yet. So is a value that names a file and two different ids.
- A value that names files defers to those files ("Complete terms in LICENSE.txt"). A file is named by a license file name with an extension or suffix, an upper-case `LICENSE`, `LICENCE`, `COPYING` or `UNLICENSE`, or a name with a text extension (`.txt`, `.md`, `.markdown`, `.rst`, `.text`). A name with `../` is resolved from the skill folder and must stay inside the repository; any other name is looked up in the skill folder, then in each ancestor folder, then at the root, nearest first. An exact path wins; otherwise a match in another letter case is accepted when exactly one file matches. A named file that is not a license file name (`TERMS.md`, `docs/LICENSE.md`) is read and identified too. A named file always counts at the `skill` level, wherever it is, and is recorded once.
- A known id or alias stated before the reference ("MIT (see LICENSE)", "MIT. See LICENSE.txt", "Apache License, Version 2.0 (see LICENSE)") is a piece of evidence of its own, checked against the named files: agreeing gives that id, disagreeing is `ambiguous`.
- Any other value is `custom`.

### 3. Resolution

The deciding level is the nearest level that has any evidence (deciding license files, or a front matter value). Farther levels are recorded but do not override it. Within the `ancestor` level, the nearest ancestor folder that has a deciding license file decides: a nearer license governs its subtree, and farther ancestor files are only recorded.

A front matter value alone decides at the `skill` level, even when the root says otherwise: the skill's own statement is nearer evidence than the repository's (a deliberate rule). An unknown license text at the `skill` or `ancestor` level is `custom`; only root files defer to GitHub.

| Outcome | When |
|---|---|
| `identified` | Every piece of evidence at the deciding level identifies the same SPDX id |
| `custom` | Evidence exists at the deciding level but none of it is identified |
| `ambiguous` | Evidence at the deciding level disagrees (two different ids, or a known id next to unidentified text, including two different licenses in the same folder), or a text holds several licenses (`multiple`), or the front matter names a file that does not exist or lies outside the repository, or an identified root file disagrees with another id GitHub detected, or the tree listing was truncated and no skill-level evidence was found (level `none`) |
| `ambiguous`, not re-read | A deciding file at the deciding level could not be read this run (`unread: "license-file"`), or a changed skill's SKILL.md could not be downloaded (`unread: "skill-file"`, level `none`, no evidence). This is a reading problem, not a license decision |
| `missing` | No evidence at any level, and GitHub detected nothing (`null` or `NOASSERTION`) |

GitHub's `null` or `NOASSERTION` is the absence of a detection, not a disagreement. At the `repository` level:

- Root files identified with one id decide, unless GitHub detected a different id: then the outcome is `ambiguous`.
- Root files that are all `unknown` defer to GitHub's detected id, recorded as `github` evidence; without a detection the outcome is `custom`.
- A `restricted` root text gives `custom` and a `multiple` or unread one gives `ambiguous`: never GitHub's id.
- No root file: GitHub's detected id is used; without a detection the outcome is `missing`.

A skill at the repository root follows the same rules for its root license files: root files that are all `unknown` defer to GitHub's id (level `repository`, `github` evidence), and an identified root file that disagrees with GitHub's id is `ambiguous`. When its front matter has a `license` value, the skill level decides as for any skill, without GitHub's id, and an identified root file still must not disagree with GitHub's id.

GitHub's answer is recorded as `github` evidence whenever it is not `null`.

Dual licensing (two different licenses offered as a choice) is not decided yet: two license files that disagree are `ambiguous`, and an SPDX expression in the front matter is `custom`. Both keep the skill out of the catalog until the owner decides how to present a choice.

### 4. Eligibility (`pipeline/rank.ts`, `pipeline/lib/license.ts`)

One predicate, `isPublishable(skill, allowedLicenses, isSafetyCleared)`, decides whether a skill can be published; triage, review selection and rank all use it:

| License | Publishable |
|---|---|
| `identified`, id in `filter.allowedLicenses` | Yes |
| `identified` with any other id, `missing`, `custom`, or `ambiguous` without `unread` | Only if `isSafetyCleared(skill)` is true |
| `ambiguous` with `unread` (not re-read), or no resolution | No, not in this run |

The scan is consulted only for the middle row.

Triage and review selection skip skills that cannot be published, approved ones included, so no model call is spent on a skill that cannot be published.

An approved skill that cannot be published yet is kept pending, never removed, with its reason in `pendingReasons`: `waiting for the safety scan`, `license not re-read`, `license unresolved`. An approved skill that is publishable but whose new version has no review yet is pending with `awaiting re-review`. Once publishable and reviewed, an approved skill follows the usual review rules (score threshold, severe security).

A collection (whole-repository install) is listed only if every extracted skill of the repository is publishable, because installing the repository installs all of them. Individual publishable skills from that repository stay listed. A repository whose tree listing was truncated at the last extraction lists no collection either: skills past the cut are unknown but would be installed (the rank step reads the truncated repositories from `pipeline-run.json`).

An approved collection whose repository has skills that cannot be published yet is pending with the reason `<n> of <m> skills of the repository not publishable yet`. One whose listing was truncated is removed with the reason `repository listing truncated: skills past the cut are unknown`. Repository names are compared without letter case.

### 5. Caching and invalidation

The resolution is recomputed for every skill on every extract run, from the current tree. Identified license texts are cached by git blob id in `data/cache/licenses.json` (*new*, versioned like the reviews): a changed license file has a new blob id and is identified again; an unchanged one is not downloaded again. A license file that changes outside the skill folder (ancestor or root) is therefore picked up even though the skill's own fingerprint does not change. Reviews stay keyed by the skill fingerprint and are not affected by license changes.

The cache file records the version of the identification rules: `{ "rulesVersion": 2, "entries": { "<blob id>": { "kind": "spdx", "spdx": "MIT" } | { "kind": "restricted" } | { "kind": "multiple" } | { "kind": "unknown" } } }`, entries sorted by blob id. A file with another version, or in a shape without a version, is discarded and replaced at once, and every license text is identified again. The version (`LICENSE_RULES_VERSION` in `pipeline/lib/license.ts`) is bumped whenever text identification, the templates, the thresholds or license file matching change; version 2 replaced the phrase-only identification of version 1. A file not read (failed download, other content than the listed blob, unresolved link) is never cached. The cache is saved after each repository that added entries. A dry run uses `.dry-run/cache/licenses.json`.

### 6. Old records

`SkillRecord.license` (*new*) is optional when reading. A record without it (written before this change) is treated as unresolved: not publishable in this run, never silently assigned a license, and kept pending with the reason `license unresolved` when approved. A stored resolution in a shape this code no longer reads is dropped the same way. The next successful extract of its repository fills it: its SKILL.md is read again, so the front matter is known before the license is resolved. A record marked not re-read (`unread: "skill-file"`) also has its SKILL.md read again, even when its fingerprint matches.

A changed skill whose SKILL.md download fails keeps its old record, but its license becomes not re-read for that run (see Resolution). A record kept from a failed repository read, or past the cut of a truncated listing, keeps its previous `license`, or none.

Migration: the first extract after this change reads again the SKILL.md of every existing record (about 40,499 downloads from raw.githubusercontent.com, outside the API quota, once). That run should be an extract-only migration run, `npm run pipeline -- discover filter extract`, before any review run: a combined run would spend the review step's time budget (`review.maxMinutes`, counted from the start of the run) on these downloads and defer most reviews.

## Data fields

### `SkillRecord.license` (*new*, cache only)

```json
{
  "outcome": "identified",
  "spdx": "Apache-2.0",
  "level": "skill",
  "revision": "<git tree id>",
  "evidence": [
    { "kind": "file", "level": "skill", "path": "skills/pdf/LICENSE.txt", "blob": "<git blob id>", "status": "identified", "spdx": "Apache-2.0" },
    { "kind": "frontmatter", "level": "skill", "path": "skills/pdf/SKILL.md", "value": "Complete terms in LICENSE.txt", "spdx": null }
  ]
}
```

The schema is a union on `outcome`: `identified` requires `spdx` and a level `skill` | `ancestor` | `repository`; `custom` has one of those levels and no `spdx`; `ambiguous` has any level (`none` for a truncated listing without skill-level evidence, or for a SKILL.md not re-read) and may carry `unread`: `license-file` | `skill-file`; `missing` has level `none`. `revision` is the id of the git tree the files were listed from.

Each evidence entry carries the `level` it counts at. `kind`: `file` | `frontmatter` | `github`. A `file` entry has a `status`: `identified`, `restricted`, `multiple`, `unknown`, `unread` or `auxiliary`, and `spdx` only when identified (for a link, `blob` is the link's own blob). A `github` entry is `{ "kind": "github", "level": "repository", "value": <RepoMeta.license>, "spdx": <id, or null for NOASSERTION> }`. Entries are listed skill level first (license files and named files, auxiliary files, then front matter), then ancestors nearest first, then root files, then GitHub.

### Run statistics (`pipeline-run.json`)

`extract.licenses` (*new*, optional so older run information still loads): counts of the skills kept after extraction, `identifiedAllowed`, `identifiedNotAllowed`, `custom`, `ambiguous`, `missing`, `notReRead` (ambiguous because something could not be read, counted apart from `ambiguous`), `waitingForSafetyScan` (skills publishable once the safety scan clears them, and not cleared), `unresolved`, and `failedDownloads` (license files that could not be read: failed download, other content than the listed blob, or an unresolved link). The pull request summary shows them on one line of the Run section, and lists each pending approved entry with its reason.

### Catalog (`catalog.json`, read by the site)

- `skills[].license`: unchanged type (string). It holds the SPDX id resolved for the skill when identified (which can differ from its repository's, and can be a non-permissive id such as `GPL-3.0`), `No license` when missing, or `Unclear license` when custom or ambiguous.
- `skills[].licenseOutcome` (*new*, optional): `identified` | `missing` | `custom` | `ambiguous`.
- `skills[].licenseCategory` (*new*, optional): `permissive` (id in `filter.allowedLicenses`) | `copyleft` (GPL, AGPL, LGPL, MPL or CC-BY-SA family) | `other` (any other identified id, such as CC0 or CC-BY) | `none` (missing) | `unclear` (custom or ambiguous).
- `skills[].licenseEvidence` (*new*, optional): `{ "level": "skill" | "ancestor" | "repository", "path": string | null, "url": string | null }`, from the first evidence of the deciding level that names the resolved id (a file before the front matter, a root file before GitHub). For an unclear license it is the first non-auxiliary evidence of the deciding level; a missing license has none (the field is absent). `url` points to the evidence file (`https://github.com/<repo>/blob/<branch>/<path>`, each segment percent-encoded, SKILL.md for front matter evidence), or to the repository when the evidence is GitHub's detection (`path` is then null). The URL uses the default branch: the recorded `revision` is a tree id, which GitHub blob URLs do not accept. The skill's own `url` is unchanged.
- `collections[].license`: unchanged type. It holds the single license label when all skills of the repository share it, otherwise `Mixed`.
- `collections[].licenses` (*new*, optional): the sorted license labels (SPDX ids, `No license`, `Unclear license`) of all skills of the repository (all publishable when the collection is listed), since installing the collection installs every one of them.
- `kits[].pendingReasons` (*new*, optional, present when something is pending): the reason of each pending approved entry, by id.

All new catalog fields are optional so the current site keeps building on an old `catalog.json`. Text the site shows about selection (the methodology page currently says repositories need a permissive license and at least 50 stars) becomes outdated once this lands; that page belongs to the design branch.

## Catalog impact

Documented in the pull request after a run on the existing cache: outcomes per level, skills from formerly excluded repositories that become publishable, skills waiting for the safety scan, and collections that lose whole-repository eligibility because one of their skills cannot be published. No catalog entry is added without a review and the owner's approval.

## Follow-ups (not in this change)

- Low-star discovery: separate lanes (topic relevance, targeted searches, nominations) with review budgets, instead of one `minStars` bound.
- Ranking: the 30% repository-signal share of the skill score favours popularity; replace with task evidence and reliability, keeping popularity as context.
- Reviews truncated at `review.maxSkillChars` (24,000 characters) must be marked incomplete or chunked, not counted as full reviews.
- Session reviews: an export and a schema-validated import now exist (`docs/SESSION-REVIEWS.md`). The reviews it imports are never truncated; the API path still is.
- The 40,000-skill cache exists only on the Mac; nine CV reviews are provisional (listed in the pull request).
