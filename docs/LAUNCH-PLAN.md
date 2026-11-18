# Launch plan and parallel work

Current selection update, 2026-11-18: the owner requested complete available membership for selected collections, with editorial recommendations kept separate, and explicitly confirmed that age alone must not exclude a candidate. The implementation is documented in [Complete collection inventory](COLLECTION-DIRECTORY.md) and the latest section of [Sprint status](SPRINT-STATUS.md). Earlier age-cutoff and reviewed-subset descriptions in this planning history are superseded. After reviewing the local site, the owner approved the complete-directory sprint and authorized its production merge; publication and synchronization results must be verified separately.

Planning baseline: origin/main cce38ff. This document records a proposed allocation of work from the supplied sprints. The owner confirmed option B: skill-level license resolution. Whether accounts are required for first launch still needs the owner's decision.

## Product and design decisions already made

Audience: developers and people who want a guided kit for a task.
Approved homepage direction: Build Room, white/black/red palette and icon-only Night Shift control. The owner selected the Build Room prototype after comparing it with Astro and earlier concepts. design-previews/build-room.html is the homepage reference. Earlier Switchyard/Career Desk files are historical alternatives. Preserve current Astro detail pages while extending the shared theme. The integrated result needs desktop/mobile browser validation before final approval.
The later supplied design sprint adds a real parts list, explicit install order, signature install command and bold type. Use the selected Build Room direction while accommodating those requirements. Avoid decorative badges, a metrics strip, identical cards and suggestion chips.
Use 21st free component search when available, at most two component pulls per day as requested. Browser login does not by itself prove that authenticated MCP tools are available. State precisely which source/tool was used. No paid generation or plan upgrades are authorized by this brief.
Design remains subject to owner approval before publishing the implementation branch. The current coordination push contains only this plan and the selected standalone reference samples.

## Work allocation

| Branch | Owner | Scope | Shared dependencies |
| --- | --- | --- | --- |
| planning/launch-parallel | Coordinator | Plan, handoffs and selected design references | Common base for the first two branches |
| codex/design-switchyard | Codex | Astro pages, components, styles, theme, kit parts list and install UX | Existing catalog schema initially |
| claude/license-resolution | Claude Code | License resolution, pipeline schemas, extraction, ranking and regression tests | Option B confirmed |

Branch names assign responsibility, not permanent model roles. Use a separate checkout or worktree per active branch. One owner per file while work overlaps. Neither implementation agent updates main directly. Review each other's PR and let the owner authorize merging. Only commit relevant files. Do not run blanket git add, reset or clean in a checkout with unrelated edits.

Claude owns pipeline/lib/schemas.ts during the license change. Before changing any catalog field, document its meaning and migration behavior in the PR and notify Codex. Codex initially retains the existing license field. A shared schema change lands before frontend code depending on it. Coordinate edits to tests/site, package.json, package-lock.json, .github and catalog.json explicitly.

Later branches, created from the accepted integration base:
- claude/catalog-curation-<kit> for each kit's reviewed data and approvals.
- codex/search-and-install for search and installation refinements outside the design PR.
- claude/accounts-backend and codex/accounts-ui only after agreeing storage, sessions, account access rules and budget.
- codex/launch-checks for deployment configuration and final user journeys.
These branches are intentionally not pre-created from the old base.

## Sprint 1 — Design

Integrate the selected samples into Astro, using current catalog data. Give every approved skill a clear role in a kit. Confirm install order with the curator; do not imply independent skills have hard dependencies without evidence.
Keep per-skill installation available. Do not invent an install-all command or CLI flags. Validate any generated command against its CLI documentation and actual skill name. Consider escaping and duplicate names.
Theme choice should persist across routes. Support keyboard use, mobile navigation, visible focus, useful empty states and reduced motion.
Run npm run typecheck, npm test, npm run site:build and npm run site:verify. On Windows npm.cmd avoids the npm.ps1 execution-policy issue. CI uses Node 24. The installed Node 26 has passed earlier checks.
Show desktop/mobile browser results and the local preview to the owner before pushing design implementation.
Done: owner approves the actual integrated pages, then explicitly authorized feature-branch push and PR.

## Sprint 2 — License decision

Decision confirmed: B, resolve applicable license evidence at skill level.
The current early repository filter rejects missing/disallowed repository licenses before extraction. The change must allow candidates with unknown repository licensing to reach license inspection, while retaining archive/activity checks and final publication eligibility. Replace the hard minimum-stars exclusion with the discovery policy below.
Inspect skill metadata and referenced/local license files, applicable parent/repository evidence and mixed-license cases. Record the evidence URL/path, reviewed revision and resolution outcome. A publisher's reputation does not establish a skill's license.
Missing, ambiguous, custom and excluded licenses remain explicit outcomes. Do not label an unlicensed skill MIT by exception. Define collection eligibility when members have different licenses. Migrate old records/cache without silently assigning new rights. Include root skills and changed license files in invalidation tests.
Done: eligible skills from formerly excluded repositories can appear with their actual applicable license, covered by tests. Not every official skill necessarily qualifies under the allowed-license policy.

## Selection policy confirmed by the owner

Reliable skills with demonstrated value can be admitted even if they have few users, stars or forks. Popularity is discovery metadata, not proof of quality or an admission requirement.
- Keep broad discovery bounded through topic relevance, targeted searches, explicit source nominations and review budgets. These are separate discovery lanes. The current hard minStars filter must not block a nominated or relevant low-star candidate.
- Review an individual skill against a concrete task and the relevant kit. Record the inputs, useful outcome, limits, dependencies and reproducible evidence. Use synthetic inputs where practical.
- Compare with an existing skill for the same task. State what it adds: a missing capability, a better result, lower setup burden or useful coverage of a specific need. Avoid admitting duplicates solely to increase counts.
- Assess reliability across the complete instructions and relevant scripts/references. Check documented prerequisites, risky behavior, external calls and failure handling. Distinguish inspection from execution and record what was actually tested.
- Record license evidence, reviewed revision, review method/date and practical limitations. Re-review changes that affect the decision.
- Do not raise quality scores using stars or forks as a substitute for task usefulness. The current 30% repository contribution to skill score needs review. Prefer relevance, task evidence and reliability, with popularity used only as supplementary context.
- Keep eligible candidates pending when evidence is incomplete. The owner retains the final curation approval.

Implementation sequencing: Claude documents the low-star discovery/filter/ranking contract during the license task. Implement the broader discovery/ranking changes in a follow-up branch after agreeing the schema, rather than mixing an unbounded crawler redesign into license resolution.

## Sprint 3 — Curation

The local Lenovo clone does not contain candidates.json, repos.json or skills.json. Retrieve the claimed 40,000-skill cache from the Mac or reproduce extraction. Verify its size, source revisions and age first.
Confirm which nine CV reviews are provisional from the Mac's records; do not infer them from the current 19-entry catalog.
For each kit, shortlist 20–30 distinct candidates, inspect whole SKILL.md files plus relevant bundled scripts/references, validate review records, then rebuild and propose curation.
Current review code truncates at 24,000 characters. Implement whole-file handling or an explicit incomplete/deferred status. A truncated review must not count as a full review. Preserve resource limits through chunking or deferral rather than an unbounded model call.
Record reviewer/method/revision and demonstrate relevant task usefulness. A score is an evaluation, not third-party certification.
The owner approves curation.yaml decisions. Aim for four complete kits with at least one collection and five approved skills each, without admitting weaker or redundant content to meet a number.
Session-generated reviews need a reproducible, schema-validated way into cache and summary. Define that import path if the existing API client cannot support the intended session workflow.

## Sprint 4 — Launch

The supplied static Pages deployment describes a public catalog release. It does not implement registration, sessions, saved kits or user storage.
Decision required: public catalog beta first, or accounts included before first launch. Earlier discussion requested both audiences and accounts. Do not silently move that requirement out of scope.
If accounts are part of launch, add a dedicated milestone: approved backend/auth service and budget, signup/signin, recovery, logout, per-user favorites/kits, account/data deletion and access-isolation checks. LocalStorage in the design demo is not the account backend.
Cloudflare proposal: repository root build directory, output site/dist, Node 24, SKIP_DEPENDENCY_INSTALL=1, command npm install --no-audit --no-fund && npm run site:build. Verify the command in the selected build environment, then run site verification. Do not promise a 30-minute completion.
Production branch should be main. Agent branches may produce previews, while only approved merges deploy production. Confirm branch controls before first publication.
Check generated routes, search, source/install links, mobile, accessibility, 404, cache refresh, error monitoring and rollback. Never put API credentials in a static site bundle.
References:
- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/configuration/branch-build-controls/
Done: approved release deployed and verified online, with production/preview separation and rollback available.

## Sprint 5 — Maintenance

Choose manual monthly or automatic weekly operation explicitly. The current pipeline.yml still schedules weekly execution. Updating this schedule is separate work, not done by this planning commit.
Monthly discovery should identify new/changed upstream content and pending approved entries, with roughly 50 new full reviews as the requested planning cap. Measure actual usage and cost; a session cap does not guarantee provider subscription availability.
Persist paid/completed reviews so retries do not pay twice. Run schema checks and catalog/site verification before the owner approves curation. Deployment follows the approved production merge.
Optional later: automatic API reviews, semantic search, French locale and custom domain.

## Dependencies

Design and license investigation can start together. License implementation is authorized under option B. Final curation depends on license resolution and full-review handling. Frontend integration of new metadata follows the agreed schema. Production launch depends on approved design, enough useful kits, and the explicit accounts decision.

## Current working-copy note

The Lenovo main checkout has an earlier uncommitted one-line portability fix in tests/store.test.ts. This coordination worktree leaves it untouched. Review it in a separate commit/branch before deciding whether to integrate it.
Only main existed on the remote when this plan was prepared. No unpushed Mac work has been inspected.


## Current design implementation — owner accepted

The Build Room homepage is integrated on codex/design-switchyard in the skill-kits-design worktree. It uses the existing catalog and install helpers, retains skill/kit/collection routes, adds immediate directory filtering and a shared persisted icon-only theme toggle. Empty kits offer browsing, with no invented install command.
The catalog order is displayed as selection order, not an asserted dependency/install order. Explicit workflow ordering requires curator input later.
Verified: 276 existing tests, typecheck, site build and site:verify. A DOM interaction check covered selection, install switching and clipboard content, search/clear, no-JavaScript content and theme state. Browser preview connection failed from the tool environment; actual desktop/mobile visual review remains pending.
The existing one-line Windows test-fixture path fix is included in this worktree.
No account backend or subscription system is part of this implementation. Accounts are an agreed future milestone. Billing remains exploratory.
\nThe owner accepted the homepage on 2026-11-16 and requested synchronization after every validated sprint. Follow AGENTS.md and docs/SPRINT-STATUS.md for the accepted baseline and cross-machine handoff.\n
