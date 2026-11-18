# Complete collection inventory

The owner requested a complete, browsable inventory for selected collections, rather than hiding members without an editorial review or a minimum score. On 2026-11-18 the owner also confirmed that last-push age must not disqualify a candidate. Age does not establish usefulness or compatibility. Archived repositories remain subject to the existing archive gate.

## Additive public contract

- `skills` retains reviewed entries with their real reviews and scores. A low-scoring collection member can be listed without being recommended.
- Optional `sourceSkills` holds members without an editorial review. It uses the same source metadata and license evidence, `reviewStatus: unreviewed`, and `humanReviewed: false`. A source record cannot contain `review`, `reviewScore` or `score`; the schema rejects fabricated values.
- Optional `installable: false` means the standard installation command cannot safely or uniquely address the folder. The site links to its source instead.
- Optional collection `installScope` is `repository` or `listed`. Missing scope is treated conservatively as individual installation only. Optional `revision` identifies the inspected commit. A whole-repository control requires explicit complete scope, consistent membership counts and a pinned revision.
- Existing catalog files without these fields remain valid. The site combines reviewed and source records for browsing, pages and search. Search ratings are null for source listings, never a fabricated zero. Editorial recommendations require an actual qualifying review.

Source inventory is not certification or a successful runtime test. Public source descriptions are attributed to the repository. Actual findings, verdicts, skipped-file details and reasons for pending entries remain in ignored private files.

## Admission and refresh

`pipeline/lib/collection-directory.ts` refreshes only explicitly selected repositories while preserving unrelated records. Every admitted member must pass the normal license publication policy and current scan clearance, independently of license category. Missing or stale reports and unresolved alerts stay pending. Severe editorial findings remain held. Existing content-bound scan decisions are reused without weakening their rules; no blanket overrides are introduced.

An incomplete repository listing, invalid primary files or missing members cannot enable whole-repository installation. The public license list covers all known member licenses, including held members. Incomplete unknown membership is represented honestly rather than silently labeled permissive.

Duplicate install names are checked across the whole inventory, including held members, so a name-only command cannot accidentally select a different folder. Commands reject shell metacharacters. Where a pinned source revision is available, installation uses the documented `owner/repo@commit` format. See the [upstream installation reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#source-formats).

The legacy `filter.maxDaysSinceLastCommit` configuration field remains readable for compatibility but is no longer an admission cutoff. Last-update metadata and repository scoring context remain available; editorial quality is a separate assessment.

## Explicit synchronization command

From the repository root:

```sh
npx tsx scripts/sync-collection-directory.ts --input .session-reviews/directory-sync --repos owner/repo,owner/another
```

Repositories must already be approved in curation. The command pins each HEAD, verifies downloaded Git blobs, resolves licenses, scans every member, and writes a private preview, inventory and pending report. It never executes upstream scripts or calls a model.

Add `--apply` to apply an authorized selection. Add `--refresh` to recheck upstream rather than resume the pinned private cache. For candidate evaluation only, `--propose kit-id=owner/repo` creates a private proposal; that mode rejects `--apply`. Candidate discovery is not owner acceptance.

Once a published catalog contains `sourceSkills`, the regular extraction scans all approved collection repositories, including permissive-license members, and preserves those reports. The rank handler refreshes the collection directory while preserving unrelated published records. A regression exercises this path without any model calls. No scheduled workflow or credential configuration is changed by this increment.

Do not run a broad rank against an incomplete shared cache as a way to import a scoped batch. Use the explicit synchronization path and inspect its preview. Private caches, reports and third-party source copies stay ignored.

## Site behavior and verification

Each kit exposes all available collection members, with search, editorial-review and license filters, sorting and progressive display. Individual curated choices remain separate. Source pages carry no editorial score panel. Partial and legacy collections lead to individual choices instead of an unfiltered install command. Repository and kit installation controls follow the same scope checks.

Tests cover old-catalog compatibility, source records without fake scores, low-scoring inventory, collection-to-kit search membership, permissive-license scan enforcement, pending members, incomplete coverage, duplicate names, pinned commands, old-source eligibility, archive checks and extract/rank persistence. Project checks, built-site verification and desktop/mobile browser checks are required before sprint acceptance.

The expanded collections in the working branch remain proposals until the owner reviews them. Inclusion approval must not be represented as the owner personally reading every source file. The production merge and accepted-baseline synchronization remain separate from local preparation.
