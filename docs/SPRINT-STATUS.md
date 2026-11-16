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
