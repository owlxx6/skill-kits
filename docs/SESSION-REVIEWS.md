# Reviews written in a session

There is no model API key and no paid call is authorized. Triage and reviews are therefore written in a local agent session, then imported into the same cache the API path fills. Nothing in this path calls a model.

Code: `pipeline/lib/session-reviews.ts` (logic), `pipeline/session-reviews.ts` (command). Tests: `tests/session-reviews.test.ts`.

## Flow

1. Extract first (`npm run pipeline -- discover filter extract`): the safety scan decides which skills can be published (`docs/SAFETY-SCAN.md`).
2. Export the skills to review:

        npx tsx pipeline/session-reviews.ts export --kit resume-career --limit 25
        npx tsx pipeline/session-reviews.ts export --ids "owner/repo:path,owner/repo:other"

3. The session reads `.session-reviews/RUBRIC.md` and the packets, then writes `.session-reviews/reviews.json`.
4. Import. `--dry-run` validates without writing:

        npx tsx pipeline/session-reviews.ts import .session-reviews/reviews.json --dry-run
        npx tsx pipeline/session-reviews.ts import .session-reviews/reviews.json

5. Run `rank` and `summary` as usual. A review is a normal review file: the rank step does not know where it came from.

## What export does

- **Selection** (`--kit`): stands in for triage, which needs a model. It keeps the skills that can be published now (license and safety scan), have no review yet, and mention the kit's `keywords` (whole words, optional plural) in their name or description. Best keyword matches first, then the most starred repository, one skill per fingerprint. `--limit` defaults to 25. It is a shortlist, not a judgment: the review decides.
- **`--ids`** exports the named skills (a skill that cannot be published is reported and skipped).
- **Packet** (`<fingerprint>.md`): the exact message the API path would send, with the kit list, the metadata block and the **whole** SKILL.md. The 24,000 character cut of the API path does not apply: a review made here is never a truncated one.
- **`RUBRIC.md`**: the pipeline's own review instructions (`REVIEW_SYSTEM` in `pipeline/lib/llm.ts`), the kits and the answer format, so a session review follows the same rubric as an API review.
- **`manifest.json`**: id, fingerprint, file and size of each packet, and the skills that could not be downloaded.

Skill text is untrusted. Packets keep it inside `<skill_metadata>` and `<skill_content>` blocks (tags written by a third party are neutralized), and the rubric tells the reviewer to treat it as data.

## What import checks

Every answer carries the `id` and the `fingerprint` of its packet. It is refused, alone and with its reason, when:

- the skill is unknown, or its fingerprint changed since the export (export again);
- it cannot be published now (license or safety scan: same rule as `isPublishable`);
- it already has a review (`--replace` replaces it);
- the same fingerprint is answered twice in the file;
- a kit id is unknown (not dropped: in a session it is a typo);
- the review does not satisfy `ReviewSchema` (scores 0-10, `why` at most 160 characters, 5 to 12 keywords...). Lists over 3 items and keywords over 12 are trimmed, as in the API path.

A valid answer is written to `data/cache/reviews/<fingerprint>.json` as `{ fingerprint, model: "in-session-review", reviewedAt, review }`, checked with `ReviewRecordSchema` before writing, with the usual temporary file and rename. The command exits with status 1 when any answer was refused; the valid ones are saved anyway.

## Sharing the extraction between agents

The extraction (`data/cache/skills.json`, with licenses and safety reports) is the common base. Two commands let an agent pick its candidates from it and read them in full, without a second review of the same skill.

### Candidate table

    npx tsx pipeline/session-reviews.ts candidates --kits web-app,ui-design,data-analysis,workflow-automation

Writes `.session-reviews/candidates/candidates.json` and `candidates.csv`: every skill of a listed repository whose name or description mentions a keyword of one of the kits (the same matching as the shortlist), best match first, then stars. Each row has:

- `id`, `name`, `description` (first 300 characters), `repo`, `stars`, `path` (the skill folder);
- `revision`: the git id of the skill folder, the revision a review is about; `listingRevision`: the id of the repository tree the license was resolved from;
- `eligibility`: `publishable`, or `waiting` with the reason (`license unresolved`, `license not re-read`, `waiting for the safety scan`), as `isPublishable` decides it; `license` and `licenseCategory` as the catalog would show them;
- `safety`: the verdict only (`clear`, `review`, `block`, `not scanned`, `not needed` when the license publishes the skill). Never a finding, a path or an excerpt;
- `reviewed`: a review already exists for this revision, whoever made it;
- `kits`: the requested kits it mentions, with the number of keywords; `otherKits`: the other kits it mentions. A skill with `otherKits` belongs to a kit of the other agent too: settle who reviews it before reviewing, and look at `reviewed`.

The CSV prefixes with an apostrophe a cell that would open as a spreadsheet formula (names and descriptions are third-party text).

### Complete files of a skill

    npx tsx pipeline/session-reviews.ts files "owner/repo:path/to/skill" "owner/repo:other"

Writes every text file of the skill (SKILL.md, scripts, references), in full, to `.session-reviews/files/<revision>/` with their relative paths, and `<revision>.index.json` listing what was saved and what was skipped. It lists the repository tree again and refuses a skill whose revision changed since the extraction (run extract again), so what is read is what was extracted. Each file must be the listed git blob. Limits are the safety scan's (200 files, 1,000,000 bytes per file, 10,000,000 in all); media and binary files are listed as skipped, as is a file name that could leave the folder. It needs `GITHUB_TOKEN` for the tree listing.

## Not covered

- Reviews made through the API are still cut at `review.maxSkillChars` and counted as complete (follow-up in `docs/LICENSE-RESOLUTION.md`).
- Nothing records that a session reviewer actually read every packet: that is the session's responsibility, as it is the owner's to approve each skill in `data/curation.yaml`.
- `.session-reviews/` is local and not versioned (it holds third-party text).
