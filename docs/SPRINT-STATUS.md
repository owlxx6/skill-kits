# Sprint status and synchronization

## Accepted baseline

- Sprint 1 homepage increment: Build Room integration, accepted in chat on 2026-11-16.
- Implementation: 945acd6 on codex/design-switchyard.
- Shared accepted branch: integration/validated-sprints.
- Real-catalog project selection, per-skill install controls, directory filtering, shared persisted icon-only theme toggle and existing Astro detail routes.
- Design checks: 276 tests, typecheck, build and site verification passed. DOM interactions passed.
- Independent desktop/mobile rendering remains unverified because the tool's preview server was unreachable. The owner accepted the presented design. Record later visual findings as follow-up work.
- Curator-defined install ordering, broader kit refinements and remaining launch milestones are outstanding.
- Public main remains cce38ff until a separately authorized production merge.
- Sprint 2 license resolution (option B) and the public license display: accepted in chat on 2026-11-17. The owner keeps Codex's design as the current site.
- Implementation: license work up to 0dc3b37 on claude/license-resolution (PR #1), site alignment 95f2d1d on codex/design-switchyard. integration/validated-sprints fast-forwarded to 95f2d1d.
- Checks on 95f2d1d (Mac): typecheck, 596 tests, site build (37 pages), site:verify. The built site contains no security notes and no pending reasons.
- Known limitation, accepted as a non-blocker: a restriction written on a copyright line next to a permissive text can be ignored by the resolver. Follow-up on the license branch.
- PR #1 stays open: merging into main is the separate production decision.

## Other-machine work

- origin/claude/license-resolution observed at 42be1db on 2026-11-16.
- Contains skill-level license resolution and its tests. Implementation presence is not final sprint acceptance.
- A temporary combination on integration/check-design-licenses checks compatibility without modifying Claude's branch.
- Compatibility check passed: the temporary merge was conflict-free; 454 tests, typecheck, site build and site:verify passed. The tested license tip was 42be1db. This confirms integration compatibility, not a complete review or owner acceptance of the license sprint.

## Update commands for Claude on the other machine

Preserve local edits first, then use the repository/worktree assigned to Claude:

    git status
    git fetch origin
    git switch claude/license-resolution
    git pull --ff-only origin claude/license-resolution
    git merge origin/integration/validated-sprints
    npm install --no-audit --no-fund
    npm run typecheck
    npm test
    npm run site:build
    npm run site:verify

If pull --ff-only cannot advance, inspect both histories and merge deliberately. Never reset away unpushed work. Resolve conflicts preserving license work and Build Room. Commit resolutions and push the feature branch normally.

Read AGENTS.md, this file, LAUNCH-PLAN.md and LICENSE-RESOLUTION.md. Verify the accepted baseline is an ancestor:

    git merge-base --is-ancestor origin/integration/validated-sprints HEAD

Exit zero means the branch contains the accepted baseline. Report that result and the checks to the owner. Secrets and local caches are separate from source synchronization.

## Sync state

Prepared locally on Lenovo. Remote publication and the Mac fetch/merge need separate verification. Repeat the AGENTS.md checklist after every validated sprint.


## Public license information follow-up

The latest license branch at 0dc3b37 was fast-forwarded into the frontend branch for contract compatibility. Optional licenseOutcome/category/evidence and mixed collections are usable without changing the shared schemas.
The owner accepted the resolver limitation where a restriction on a Copyright line can be ignored. That finding is not a merge blocker at the owner's request; no frontend workaround or resolver change was made.
Public skill cards and detail pages no longer render review.security. Methodology now describes skill-level license resolution, topic-search thresholds versus nominations, and the actual review/ranking process. Pending reasons remain unused by public pages. Mixed collection labels are expanded in cards, repository pages, homepage and search. Optional skill evidence links and categories are displayed when supplied, with legacy catalogs still supported.
Checks: 596 tests, typecheck, site build (37 pages), site:verify. Rendered pages were checked for removed public security notices and permissive-only promises. Added regressions for mixed/legacy license display and exclusion of internal findings/pending reasons from the search index. Desktop/mobile rendering of these text changes has not been independently repeated.
No package, lockfile, catalog or workflow changes. No account UI. Public main and the draft safety branch remain untouched. Ready for feature-branch review.

## Four-kit local content integration — 2026-11-17

The owner explicitly requested local pipeline completion and site inclusion after reviewing the proposals. The authorized batch adds 18 distinct session-reviewed skills, five entries each in web-app, ui-design, data-analysis and workflow-automation. Existing 19 skills, six collections and unrelated kits are preserved; held candidates are excluded.

The local batch importer validates review/source fingerprints, downloads all selected folder files at pinned commits with Git blob verification, runs the unchanged rules-2 static scanner, applies the existing license/rank gates, then updates curation and the site catalog. All 18 pass; 252 text files scanned. Private notes/reports stay outside the repository. New public records remain AI-reviewed, without implying a human read their source files. See docs/curation/LOCAL-IMPORT.md for reproduction and limits.

Checks: typecheck, 841 tests, site build (64 pages), site:verify (37 skills). Actual Chromium desktop/mobile checks at 1440px/390px pass for four five-skill kits, homepage selection/install panels and Pandas directory search. Pandas runtime and live n8n execution remain unverified, stated as limitations rather than hidden or reported as successful.

No package, lockfile, workflow or public schema changes. No accounts or production deployment. The separately announced integrated scheduled pipeline is still absent remotely; this batch uses its own explicit local entry point and existing contracts. Feature-branch work is ready for sprint review; do not advance the accepted baseline or main merely because the batch has been prepared. Other-machine fetch/import remains unverified.

## Main synchronization and durable reviews — 2026-11-17

At the owner's request, origin/main 8d48c35 (merged PRs 1 and 2) is merged into the feature branch. The three conflicts were resolved as directed: main's pipeline/lib/safety.ts and docs/SAFETY-SCAN.md, with both .intake/ and .session-reviews/ ignore entries retained. This supersedes the earlier note that the integrated pipeline was unavailable.

The 18 selected reviews are committed by fingerprint under data/cache/reviews with model in-session-review and empty security fields. Public review content and original review dates are preserved. Sources now explicitly include cloudflare/skills, supabase/agent-skills, nextlevelbuilder/ui-ux-pro-max-skill, dbt-labs/dbt-agent-skills, n8n-io/skills and TerminalSkills/skills, without changing main's existing source/exclusion decisions.

The integrated scanner and real rank/summary steps replayed against the pinned intake retain all 18 selections, five skills per kit. A committed regression checks durable cache coverage, sanitized fields and source nominations. Main, the accepted baseline and other working folders remain untouched. The feature PR is for sprint review only and must not be merged without that review.

Post-merge verification: typecheck and 951 tests pass; site build produces 64 pages and site:verify passes for eight kits / 37 skills. The scanner and contract have no diff against origin/main 8d48c35. No paid model calls or production merge were performed.

## Approved individual security-audit — 2026-11-18

The owner approved `cloudflare/security-audit-skill:skills/security-audit` for Web App in chat, with a Linux/WSL prerequisite. This approves one individual skill, not the remaining nominated repositories or a whole-repository collection. Inclusion approval does not claim the owner personally read the source.

Implementation: `236b464a2f556c9c0b817f202931fb617e5bb92e` on `data/approved-security-audit`, based on production commit `7c3c8e9`. The separate working folder preserves the pending homepage work elsewhere. No site implementation or dependency files change in this increment.

The existing reviewed-kit importer rechecked the pinned source commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, all 20 skill files and their Git blob hashes, then applied its normal scan, license, review-score and curation gates. The durable review fingerprint is `ccbc33ed119b28c3ef7b44a7e2081ab191ad63af`. Its source nomination, individual approval and provenance are versioned, so a later extraction can find the review. Detailed scan reports, source copies and execution logs remain private. Public records use the importer's existing redaction placeholder; the durable review keeps its level and empty notes.

Catalog verification: 245 skills, 17 collections and 8 kits. Every one of the previous 244 skill records and all collections is preserved. Only Web App gains the individual selection; the seven unrelated kits are unchanged. The Linux prerequisite, targeted install command, pinned license evidence, kit link and search entry are present in the built output. The new record keeps `humanReviewed: false`.

Checks: typecheck and all 984 project tests pass; the site build produces 276 pages and site verification passes for 8 kits / 245 skill pages. The unmodified upstream validator suite passes all 65 tests in isolated Ubuntu with Node 24.22.3. Native Windows with Node 26.13.0 has 46 passing, 7 failing and 12 skipped tests: the validator CLIs require input protections unavailable in that runtime. Full audit orchestration and the installation command were not executed; validator tests do not establish vulnerability-detection effectiveness.

Environment limitation inherited from the shared base: a standard `npm ci` fails because the lockfile lacks several optional `@emnapi/core` and `@emnapi/runtime` peer entries. Validation dependencies were prepared with `npm install --package-lock=false --no-save --ignore-scripts --no-audit --no-fund`; package.json and package-lock.json remain unchanged. A clean-install repair is separate work. The scheduled pipeline's missing model credential also remains unchanged; no paid calls or credentials were added.

Synchronization target: publish this accepted increment on its feature branch and advance `integration/validated-sprints` without rewriting history. Production main remains a separate release decision. The other workstation's actual fetch/merge has not been observed. To update its own feature branch after preserving local changes:

    git status
    git fetch origin
    git merge origin/integration/validated-sprints
    npm run typecheck
    npm test
    npm run site:build
    npm run site:verify

Resolve conflicts without discarding either workstation's work. Do not reset an active branch or replace its history to synchronize it.

## Approved individual Expo skills — 2026-11-18

The owner explicitly approved four individual additions in chat: `expo-project-structure`, `expo-router`, `expo-design-system` and `expo-upgrade`. All four belong to Web App; `expo-design-system` also belongs to UI Design. This is not approval of a whole-repository collection, other Expo skills or a production merge.

Implementation: `065d905d6706ad35d16c16a24c7ab64e2515d9d8` on `data/approved-security-audit`, following the accepted security-audit increment. The existing reviewed-kit importer was run in preview mode, its preservation assertions passed, then it was run with `--apply`. Both runs verified the complete tree and Git blob hashes at source commit `dfdebcc6c4c1bf7a9471cefd6b6f39c7ba6c884d`. The four selected folders contain 23 text files; all pass the unchanged static scanner without skipped files. The normal license, fingerprint, review-score and curation gates remain in effect.

The source nomination, four durable fingerprint-matched reviews and individual approval evidence are versioned under `data/`. Detailed findings, source copies, scans and execution logs remain private. Durable review security notes are empty and public records retain the existing redaction placeholder. Every new record keeps `humanReviewed: false`; inclusion approval does not claim the owner personally read the source.

Catalog: 249 skills, 17 collections, 8 kits. Every previous skill record and collection is preserved. Only Web App and UI Design gain entries; the other six kits are unchanged. No whole-repository collection was added. Site implementation, dependencies, shared pipeline code, scripts, schemas, workflows and scan overrides are unchanged.

Checks on the combined code: `npm.cmd run typecheck` passes; `npm.cmd test` passes all 984 tests across 26 files; `npm.cmd run site:build` produces 281 pages; `npm.cmd run site:verify` passes for eight kits and 249 skill pages. Additional built-output checks confirm four individual install commands, five kit links, four searchable entries, pinned MIT evidence and neutral session-review labels. Preview/application preservation checks and `git diff --check` pass.

Review scope: all 25 primary Expo instruction files were read, and six skills received complete associated-file reviews. Only the four approved selections are imported. A separate private fixture suite reproduced six defects in three unselected skills (14 checks: eight pass, six fail); those failures are not part of the passing project suite. No generated application, device run, actual SDK migration, installation command or remote service operation was executed. No paid calls or credentials were used. Static clearance is not runtime certification.

Inherited site limitation for follow-up: the generic repository detail page offers an unfiltered installation command with a scope warning even when the repository has no approved collection. The Expo repository page therefore still offers that existing control. This data increment does not change that interface or treat it as collection approval. A separate site change should decide whether to restrict this control to approved collections.

The previously documented clean-install lockfile issue and scheduled workflow credential issue remain unchanged. The site remains stopped. Push the feature branch normally and advance `integration/validated-sprints` to this accepted increment after confirming it has not diverged. PR #7 carries the combined approved data changes; main remains `7c3c8e9` until a separate release decision. The other workstation's actual fetch and merge remain unobserved.

Other-workstation handoff, after committing or stashing its local work on its own feature branch:

    git status
    git fetch origin
    git merge origin/integration/validated-sprints
    git merge-base --is-ancestor origin/integration/validated-sprints HEAD
    npm run typecheck
    npm test
    npm run site:build
    npm run site:verify

On Windows PowerShell use `npm.cmd` for these commands. Report the resulting commit and checks; a successful remote push alone does not establish that the second workstation updated.

## Complete collection directory — local sprint proposal, 2026-11-18

The owner requested complete collection membership, more collections per domain and no exclusion based solely on age, and assigned this workstation the pipeline portion while the other workstation handles separate work. Work is isolated on `ui/complete-collection-directory`. Production UI changes through `669570d` were merged into the branch without discarding the accepted additions at `c69553c`. Other worktrees remain untouched.

The additive contract and reproduction commands are in `docs/COLLECTION-DIRECTORY.md`. Reviewed entries retain actual reviews; source listings have no invented editorial assessment. All admitted collection members require current scan clearance, including those with permissive licenses. Last-push age no longer rejects a candidate; dates remain context. An archived source is still subject to the existing gate. No scan overrides, credentials, scheduled workflows or dependency declarations were changed for this implementation.

Local content proposal: 3,361 available records (236 with editorial reviews, 3,125 source listings), 29 collections in the catalog, 25 collections attached to domains. Each domain has at least three collections; Documents has four. Twelve additional repositories are proposed, including the two older candidates retained after the owner's clarification. Source and license evidence is pinned where available. Inclusion is proposed in this working branch, not a claim of final owner acceptance or successful native/service execution.

The selected inventory contains 3,539 valid records and 67 invalid primary files. Of the valid records, 193 remain pending rather than being treated as confirmed harmful or approved by default. The public catalog also preserves 15 available entries outside the refreshed repositories. Findings and the inventory reconciliation remain private. Previously approved selections that need renewed assessment remain in curation and are marked pending; durable reviews are preserved rather than applied to changed content.

Unfiltered installation controls require explicit complete membership and a pinned revision; partial collections offer individual choices. Ambiguous install names link to their source instead of copying a potentially different member. Browser checks use a temporary localhost server and an isolated profile, never a user's logged-in session. No upstream skill code was executed.

This sprint is not yet accepted or pushed. Show the owner desktop/mobile output and the final check results before publishing the implementation. Do not advance `integration/validated-sprints` or merge main for this proposal. The other workstation has not been observed fetching or merging it.

Final local checks: typecheck passes; all 1,001 tests across 28 files pass; site build produces 3,405 pages; site verification passes for eight kits and 3,361 skill pages. Isolated Chrome checks pass on all eight kit pages, the homepage and a source listing at 1440px and 390px (20 page checks), plus search and command-copy checks, with no page errors or document overflow. The temporary server is stopped. Original-worktree homepage edits remain untouched. Remote main remains `669570d`, accepted integration remains `c69553c`, and no implementation push or production merge has been performed for this sprint.

## Complete-directory sprint approval — 2026-11-18

After inspecting the running local site, the owner explicitly requested stopping it and merging this sprint. This accepts the available collection inventory, the twelve additional collections and the rule that age alone does not exclude candidates. It authorizes pushing the feature branch, opening its PR, merging into main and advancing the accepted integration baseline normally, without rewriting history. The earlier local-proposal notes above describe the pre-approval state and are superseded by this approval.

Implementation: `c20cb1566be3df36612e56a96e05db577ba2a5e5`, with planning alignment at `cb659fd651bb40aa21d551cb9d87a0959f5a97c2`, on `ui/complete-collection-directory`. The already approved production UI at `669570d` is included. The unchanged catalog has 3,361 available records (236 with existing reviews, 3,125 source listings), 29 collections and eight domains; Documents has four collections and every other domain has three. The 193 pending entries and 67 invalid primary files remain unadmitted. Approval is not a claim of human source-file review or successful runtime execution of each skill.

The local server has been stopped and no listener remains on ports 4342/4344. Before publication, confirm the combined code with typecheck, tests, site build and site verification, then check the PR head and remote branch references. No private source copies or reports may be committed. The scheduled workflow and credentials remain unchanged. A repository merge does not itself verify a hosting deployment.

After the authorized merge, synchronize `integration/validated-sprints` with the verified production merge without overwriting other branches. The other workstation's update remains unobserved. After preserving local work on its own feature branch, it should run:

    git status
    git fetch origin
    git merge origin/integration/validated-sprints
    git merge-base --is-ancestor origin/integration/validated-sprints HEAD
    npm run typecheck
    npm test
    npm run site:build
    npm run site:verify

Use `npm.cmd` under Windows PowerShell. Report the fetched commit and check results; do not infer the second workstation updated from a successful push here.

## Individual additions chosen by usefulness, and one removal — 2026-11-18

The owner asked that skills be judged by how useful they are, not by stars or forks. Candidate and existing parts were compared by reading their skill files at the pinned commits.

Approved by the owner in chat, for four individual skills and one removal:

- Resume & career: `application-form-filler` and `cold-email-writer` from `Paramchoudhary/ResumeSkills`. They cover application-form answers and cold outreach, which the kit lacked. `jirawatp/resume-career-toolkit` stays: its 20 skills are lean and practical, and its low star count says nothing about its content. `ResumeSkills` is not added as a collection because it overlaps the existing parts and holds 14 duplicated folders.
- Docs & reports: `minimax-pdf` from `MiniMax-AI/skills` and `convert-documents-to-markdown` from `firecrawl/anydoc`. `MiniMax-AI/skills` is not added as a collection: most of it concerns mobile, music and shaders, and two of its slide skills declare a proprietary license.
- Docs & reports: `arih04x/office-skills` is removed (collection and its four source listings). `shinob/msoffice-skills` stays.

Reviews are in-session, fingerprint-matched under `data/cache/reviews/`, and every new record keeps `humanReviewed: false`. Approval and source commits are in `data/curation-evidence/replace-weak-parts-2026-11-18.json`. The three source repositories are nominated in `data/sources.yaml` (`arih04x/office-skills` is no longer nominated). The catalog goes from 236 to 240 reviewed skills, from 3,125 to 3,121 source listings, and from 29 to 28 collections.

Held back: `minimax-docx` and `minimax-xlsx` have a `review` scan verdict (package installs with `sudo`, and a `PATH` line added to a shell profile, in setup scripts) and stay unadmitted until the owner decides. The proprietary-labelled slide skills and `pptx-generator` are not included. The other weak-looking parts (`TerminalSkills/skills`, `KalarisLabs/research-agent-skills`, `triggerdotdev/skills`) are still to be judged by content.

Limits: nothing was executed. `minimax-pdf` needs Python, Node, Playwright and Chromium, and several of its scripts install packages themselves. `convert-documents-to-markdown` runs an unpinned npm package at run time. Its reviews say so.

Checks: typecheck, 1,013 tests, site build (3,407 pages) and site verification (8 kits, 3,361 skill pages). Main is unchanged until a separate release decision.

## Data analysis and Research & monitoring: useful skills instead of two registries — 2026-11-18

The owner asked that the remaining weak-looking parts be judged by reading their skills. Approved in chat: six individual skills added and two repositories removed as kit parts.

- Data analysis: `airflow`, `great-expectations`, `duckdb` and `sql-optimizer` from `TerminalSkills/skills` are added; `data-analysis` and `pandas` stay. The repository leaves the kit as a collection. It is a registry of 1,146 skills written to one template; the ones read are accurate and up to date, but only about forty concern data and the rest (Wi-Fi auditing, 3ds Max scripting) does not belong in the kit.
- Research & monitoring: `citation-verification` and `systematic-review-prisma` from `KalarisLabs/research-agent-skills` are added. The repository leaves the kit as a collection: 238 of its 265 skills share a name with a skill of `K-Dense-AI/scientific-agent-skills` or `Orchestra-Research/AI-Research-SKILLs`, already in the kit, with different and older text. Its 27 original skills are mostly journal-format and writing helpers; two were read and chosen, the others are not judged.
- Workflow automation: unchanged. `triggerdotdev/skills` was read and stays: six official Trigger.dev skills grounded in its documentation. The repository has no license, and the page says so.

Every file of the six skill folders was read in full. Reviews are in-session and fingerprint-matched under `data/cache/reviews/`; every new record keeps `humanReviewed: false`. Approval and source commits are in `data/curation-evidence/data-research-picks-2026-11-18.json`. Both repositories stay nominated in `data/sources.yaml`, because the individual skills come from them.

The catalog goes from 240 to 246 reviewed skills, from 3,121 to 1,777 source listings (1,344 leave with the two repositories) and from 28 to 26 collections: 2,023 skill pages. Data analysis and Research & monitoring now list two collections each; no test requires three.

Held back: `minimax-docx` and `minimax-xlsx` (scan verdict `review`) and `databricks-solutions/ai-dev-kit` (unclear license) are not decided here.

Limits: nothing was executed. `citation-verification` sends reference titles, authors and DOIs to Crossref, DataCite, OpenAlex and arXiv, and its `--annotate` option rewrites the `.bib` file in place. The Airflow, DuckDB and Great Expectations skills are pinned to current versions and fetch files over the network without checksum checks. The reviews say so.

One test of `site/tests/collection-coverage.test.ts` named `TerminalSkills/skills`; it now takes any partial collection.

Checks: typecheck, 1,013 tests, site build (2,069 pages) and site verification (8 kits, 2,023 skill pages). Main is unchanged until a separate release decision.
