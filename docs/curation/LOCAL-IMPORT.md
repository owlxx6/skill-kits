# Local reviewed-kit import

## Synchronization after main 8d48c35

The merged license and integrated safety/session-review pipeline is now included in this branch. The scanner and its contract are exactly the versions from main; both private work directories remain ignored. The original batch history below describes the earlier local import, not the current availability of the integrated pipeline.

All 18 selected source fingerprints now have committed `in-session-review` records under `data/cache/reviews/`, with empty public `security` placeholders. Their original dates and the public review content are preserved. Six additional repositories are explicitly nominated in `data/sources.yaml`; the existing nominations and exclusions remain intact.

An isolated replay with the integrated scanner and real `rank`/`summary` steps retains all 18 skills and all four five-skill kits. The safety report is local and ignored. The cache regression checks that committed records match the published reviews and every source is nominated. Changed upstream fingerprints still require a new review; persistence does not bypass freshness checks.

The feature PR awaits sprint review. Do not merge it or advance the accepted integration baseline automatically.

The owner requested completion of the local pipeline and addition of the proposed skills to the site on 2026-11-17. This authorizes this batch's curation and catalog update. It does not authorize a production merge or account work.

The batch adds 18 distinct skills to four kits, five entries per kit. Shared skills appear in multiple kits. The previous 19 skills, six collections and unrelated kits are preserved exactly. No new whole-repository collection is approved. Suspended candidates are excluded.

## Executed path

`scripts/import-reviewed-kits.ts` is an explicit local batch entry point. It uses the existing schemas, license/publication policy and ranker, plus the unchanged static scanner from commit 533a886 (rules version 2). It is not a claim that the separately announced integrated weekly pipeline has been published or run.

For each selected skill the importer:

1. Validates the session review record, primary-read evidence and exact fingerprint; rejects suspended selections.
2. Lists the complete tree at the pinned source commit, verifies its skill fingerprint, downloads every file in the selected folder and verifies every Git blob hash.
3. Runs the static scanner. Download failures, truncated trees, unresolved links and non-clear verdicts stop admission before the shared catalog is changed.
4. Applies the existing license and review-score gates with actual scan clearance.
5. Preserves unrelated catalog data and imports only the selected skills in the requested kit order.

There are no paid model calls, copied upstream execution, dependency changes, scheduled workflow changes or modifications to the other working folders. The safety module and its original tests are imported verbatim; its rules have not been weakened.

## Reproduction

Use the private session dossier and its matching extraction cache:

```sh
npx tsx scripts/import-reviewed-kits.ts --input /path/to/domain-intake --cache /path/to/domain-cache
```

Without `--apply`, this produces a private preview and fresh reports. Add `--apply` only for an authorized batch. The invocation reads the current curation/catalog and preserves existing approved selections. Reviews and scan reports are written under the private input folder, never to the public website.

The batch script does not replace `pipeline/run.ts` or the other pipeline owner's scheduled integration work. A later full extraction/rank must import these fingerprint-matched session reviews and approval decisions as well; rebuilding from an incomplete cache would otherwise remove entries. Use the supplied private cache/records when reconciling the integrated pipeline. Do not rerun the API review stage merely to re-create already completed reviews.

## Public attribution and limits

The owner authorized inclusion, while an AI performed the source-file review. New public records therefore keep `humanReviewed: false`; inclusion approval is not converted into the claim that the owner personally read the source files.

Required public-schema `review.security` values on new records are empty redaction placeholders, not scan verdicts. Actual reports and original review notes remain private. No security findings or pending reasons are rendered publicly.

The CSV/Pandas instructions were fully reviewed but their execution remains unverified on this machine because Windows blocks the NumPy DLL. The n8n workflow examples were not run against a connected instance. Relevant limitations and prerequisites remain on the public skill pages. A static clear result is not certification or proof of runtime correctness.

## Verification

- 18 selected skills pass a fresh scan covering 252 text files, with source hashes checked.
- TypeScript check and 841 tests pass, including the imported scanner regression suite.
- Site build generates 64 pages; `site:verify` passes for all eight kits and 37 skill pages.
- Chromium at 390px and 1440px checks all four kit pages, five entries each, no horizontal overflow, homepage project switching, installation-panel switching and a search finding both Pandas-related skills.
- Existing skills/collections and unrelated kit records remain byte-for-value identical after JSON parsing.

The local preview runs at `http://127.0.0.1:4342/`. Production main and the accepted integration baseline remain unchanged pending the separate sprint/release review.
