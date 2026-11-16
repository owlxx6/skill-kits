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
| `ancestor` | License files in folders between the skill folder and the repository root, nearest first |
| `repository` | License files at the repository root; the SPDX id GitHub detected |

License files are matched by name, case-insensitively: `LICENSE`, `LICENCE`, `COPYING`, alone or with an extension or suffix (`LICENSE.txt`, `LICENSE.md`, `LICENSE-MIT`). For a skill at the repository root, root files count at the `skill` level.

A license text is identified conservatively from distinctive phrases (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, and the GPL, LGPL and AGPL families). A text that matches nothing is `custom`; it is never guessed.

A front matter `license` value is identified when it is an SPDX id from the known list (case-insensitive). A value that points to a file ("Complete terms in LICENSE.txt") defers to that file in the skill folder. Any other value is `custom`.

### 3. Resolution

The deciding level is the nearest level that has any evidence. Farther levels are recorded but do not override it.

| Outcome | When |
|---|---|
| `identified` | Every piece of evidence at the deciding level identifies the same SPDX id |
| `custom` | Evidence exists at the deciding level but none of it is identified |
| `ambiguous` | Evidence at the deciding level disagrees (two different ids, or a known id next to unidentified text), or the front matter points to a file that does not exist, or the tree listing was truncated and no skill-level evidence was found |
| `missing` | No evidence at any level, and GitHub detected nothing (`null` or `NOASSERTION`) |

At the `repository` level, an identified root file and GitHub's detection must agree; if the root file is not identified, GitHub's detected id is used and recorded as such.

Dual licensing (two different licenses offered as a choice) is reported as `ambiguous` for now: the safe outcome until the owner decides how to present a choice.

### 4. Eligibility (`pipeline/rank.ts`)

A skill can enter the catalog only if its outcome is `identified` and its SPDX id is in `filter.allowedLicenses`. Every other outcome keeps it out of the catalog. An approved skill that loses eligibility is reported as removed with the reason `license <outcome>` or `license <spdx> not allowed`.

A collection (whole-repository install) is listed only if every extracted skill of the repository is eligible, because installing the repository installs all of them. Individual eligible skills from that repository stay listed.

Review selection skips skills that are not eligible, so no review is spent on a skill that cannot be published.

### 5. Caching and invalidation

The resolution is recomputed for every skill on every extract run, from the current tree. Identified license texts are cached by git blob id in `data/cache/licenses.json` (*new*, versioned like the reviews): a changed license file has a new blob id and is identified again; an unchanged one is not downloaded again. A license file that changes outside the skill folder (ancestor or root) is therefore picked up even though the skill's own fingerprint does not change. Reviews stay keyed by the skill fingerprint and are not affected by license changes.

### 6. Old records

`SkillRecord.license` (*new*) is optional when reading. A record without it (written before this change, or kept from a failed or truncated read) is treated as unresolved: not eligible, never silently assigned a license. The next successful extract of its repository fills it.

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

`outcome`: `identified` | `custom` | `ambiguous` | `missing`. `spdx`: set only when `identified`. `level`: `skill` | `ancestor` | `repository` | `none`. `evidence[].kind`: `file` | `frontmatter` | `github`.

### Catalog (`catalog.json`, read by the site)

- `skills[].license`: unchanged type (string). It now holds the SPDX id resolved for the skill, which can differ from its repository's.
- `skills[].licenseEvidence` (*new*, optional): `{ "level": "skill" | "ancestor" | "repository", "path": string | null, "url": string | null }`. `url` points to the evidence file at its git blob (`https://github.com/<repo>/blob/<branch>/<path>`), or to the repository when the evidence is GitHub's detection.
- `collections[].license`: unchanged type. It holds the single SPDX id when all listed skills share it, otherwise `Mixed`.
- `collections[].licenses` (*new*, optional): the sorted SPDX ids of the collection's skills.

Both new catalog fields are optional so the current site keeps building on an old `catalog.json`. Text the site shows about selection (the methodology page currently says repositories need a permissive license and at least 50 stars) becomes outdated once this lands; that page belongs to the design branch.

## Catalog impact

Documented in the pull request after a run on the existing cache: outcomes per level, skills from formerly excluded repositories that become eligible, and collections that lose whole-repository eligibility because of mixed licenses. No catalog entry is added without a review and the owner's approval.

## Follow-ups (not in this change)

- Low-star discovery: separate lanes (topic relevance, targeted searches, nominations) with review budgets, instead of one `minStars` bound.
- Ranking: the 30% repository-signal share of the skill score favours popularity; replace with task evidence and reliability, keeping popularity as context.
- Reviews truncated at `review.maxSkillChars` (24,000 characters) must be marked incomplete or chunked, not counted as full reviews.
- Session reviews need a schema-validated import path into the cache and the summary.
- The 40,000-skill cache exists only on the Mac; nine CV reviews are provisional (listed in the pull request).
