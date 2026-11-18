# Whole-repository approvals

Current directory policy (owner direction, 2026-11-18): see [Complete collection inventory](../COLLECTION-DIRECTORY.md). Available members can now be source listings without an editorial review or minimum score. Age alone does not exclude a candidate. Whole-repository installation requires complete admission and a pinned revision; partial collections use individual installs. The counts and publication description below are a historical snapshot of the earlier reviewed-subset workflow.

The owner chose to recommend installing whole repositories, with every skill they contain, instead of picking skills one by one. The safeguard is the static security scan: it runs on every skill of an approved repository, and only a severe finding (a `block` verdict) calls for intervention. Repositories are treated one at a time: every skill is reviewed so that each one has a catalog entry.

| Kit | Repository | Status |
| --- | --- | --- |
| Resume & career | `reactive-resume/reactive-resume` | approved, 33 of 34 skills listed |
| Documents & reports | `anthropics/skills` | approved, 18 of 20 skills listed |
| Marketing & content | `coreyhaines31/marketingskills` | approved, 53 of 53 skills listed |
| Marketing & content | `alirezarezvani/claude-skills` | approved, 7 of 428 skills listed (reviewed subset) |
| Research & monitoring | `K-Dense-AI/scientific-agent-skills` | approved, 5 of 177 skills listed (reviewed subset) |
| Web apps | `vercel-labs/agent-skills` | approved, 8 of 9 skills listed |
| Web apps | `cloudflare/skills` | approved, 22 of 22 skills listed |
| Web apps | `obra/superpowers` | approved, 15 of 15 skills listed |
| Data & analysis | `dbt-labs/dbt-agent-skills` | approved, 17 of 17 skills listed |
| Data & analysis | `TerminalSkills/skills` | approved, 2 of 1146 skills listed (reviewed subset) |
| Workflow automation | `n8n-io/skills` | approved, 15 of 15 skills listed |
| UI & design | `nextlevelbuilder/ui-ux-pro-max-skill` | approved, 11 of 13 skills listed |
| Resume & career | `davila7/claude-code-templates` | approved, 28 of 932 skills listed (reviewed subset) |

The site installs a collection with `npx skills add <owner/repo>`: every skill of the repository is installed.

## What is published

`data/curation.yaml` lists the approvals. `catalog.json` gains the collection and the skills of that repository that were reviewed and scored 6 or more. A skill under that score is installed with the repository but not listed (for `reactive-resume`, the maintainer-only `release` skill; for `anthropics/skills`, the brand-specific and template skills).

Two repositories are very large (428 and 177 skills). They are published with the skills reviewed so far, and the collection page says how many are listed. The security scan covers every skill of every approved repository, not only the listed ones.

## Scan results

The scan was run locally on every skill of the thirteen approved repositories. It flagged 160 skills; 17 of them carry 26 block-level findings. Each block-level finding was read and none is a threat: they are deny-lists and hardening examples, documentation of attack patterns written for an auditing tool, a directory name in a tracker table, detection rules, sample key paths in a backup tool's configuration, an attack string shown in a security guide, a key-generation command, and advice on keeping credentials out of commands. One image-generation script reads keys from conventional `.env` files; it is a design choice of that skill, not a threat. No skill was removed. The reports themselves stay private.

## Scan decisions

A skill with an unclear or missing license is published only when its scan is clear. Two skills had a `review` verdict that was read and judged harmless: one whose documentation names a testing service, and one that ships a data file the scanner cannot read (a database file written by a coverage tool). `data/scan-overrides.yaml` records those two decisions. An entry binds to the skill's fingerprint and the scanned content, so a change to the skill cancels it, and a `block` verdict is never cleared this way (`docs/SAFETY-SCAN.md`).

`supabase/agent-skills` has two skills, below the three needed for a collection; its skills are listed one by one.

Nothing else in the catalog changes: existing skills, collections and kit entries are kept as they were. A collection entry that already existed for an approved repository is refreshed.

## How it was produced

A plain rank lists every reviewed skill in the public directory, which is not wanted here. `scripts/approve-collections.ts` takes only the approved repositories from a rank of the current cache and merges them into the existing `catalog.json` (`pipeline/lib/merge-collections.ts`, covered by `tests/merge-collections.test.ts`).

```sh
npx tsx pipeline/cli.ts rank --dry-run
npx tsx scripts/approve-collections.ts --repos owner/a,owner/b          # preview
npx tsx scripts/approve-collections.ts --repos owner/a,owner/b --apply
```

## Limits

- The new records are not marked as read by a person: approving a repository is not reading every skill in it. The security notes of the reviews stay private; only the security level is public.
- A later full rank sets `humanReviewed` for approved collections from the curation file. That behavior is shared with the other local imports and is not changed here.
- Permissive-license skills are not scanned by the pipeline; only skills whose license is not allowed or not clear are. The scanner is run locally on every skill of each approved repository; its reports stay private.
