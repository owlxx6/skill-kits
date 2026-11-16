# Working together on Skill Kits

Read docs/SPRINT-STATUS.md and docs/LAUNCH-PLAN.md before starting a task. The owner approved Build Room as the homepage direction. Keep per-agent work in separate branches/worktrees.

## After the owner validates a sprint

1. Inspect git status and fetch origin. Preserve unrelated work and unpushed commits.
2. Record the approval, implementation commit, checks and limitations in docs/SPRINT-STATUS.md.
3. Commit the sprint and handoff on its feature branch. Push normally, never force-push.
4. Advance integration/validated-sprints by merging the approved feature branch. It is the common accepted baseline. If it advanced remotely, merge/retest instead of replacing history.
5. Check the combined code with typecheck, tests, site:build and site:verify where relevant. Verify the remote commits and supply the other machine's update commands.
6. Each other agent merges origin/integration/validated-sprints into its own branch after committing or stashing local work, then reruns checks. Preserve both implementations when resolving conflicts.
7. Record separately whether the other machine actually fetched/merged. A successful push does not prove it updated.

Only accepted work belongs on integration/validated-sprints. Keep experimental combinations on integration/check-* branches. Main is the production branch. Current approval covers publishing the accepted design and synchronization baseline; a production merge remains a distinct release decision.

Do not update another agent's active remote branch to synchronize it. Give it the baseline to merge. Dependencies and .env stay local. Never commit credentials or node_modules.
