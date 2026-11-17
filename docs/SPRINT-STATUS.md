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
