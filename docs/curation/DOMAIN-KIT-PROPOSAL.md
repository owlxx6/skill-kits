# Four domain kit proposals

Draft curation proposal, awaiting owner approval and the integrated pipeline. No catalog, dependency, workflow, account UI or production change.

31 complete primary-file session reviews produced 29 isolated ranking candidates. This is a targeted review, not certification. Each row below is a possible usage order, not a dependency chain. Prerequisites must match the user’s stack.

## Web app

Modules par stack : React/Next, Postgres et Cloudflare ne sont pas des dépendances obligatoires les uns des autres.

| Order | Skill | Source | Status |
| --- | --- | --- | --- |
| 1 | systematic-debugging | [obra/superpowers:skills/systematic-debugging](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging) | propose |
| 2 | vercel-react-best-practices | [vercel-labs/agent-skills:skills/react-best-practices](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices) | propose |
| 3 | supabase-postgres-best-practices | [supabase/agent-skills:skills/supabase-postgres-best-practices](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices) | propose |
| 4 | workers-best-practices | [cloudflare/skills:skills/workers-best-practices](https://github.com/cloudflare/skills/tree/cbf893b954222276bf1af57e5f23379231e0efb9/skills/workers-best-practices) | propose |
| 5 | web-perf | [cloudflare/skills:skills/web-perf](https://github.com/cloudflare/skills/tree/cbf893b954222276bf1af57e5f23379231e0efb9/skills/web-perf) | propose |
## UI / UX

Brief et recherche, audit, mouvement utile, puis performance. Le module de transitions est réservé à React ; conserver Astro pour le site actuel.

| Order | Skill | Source | Status |
| --- | --- | --- | --- |
| 1 | frontend-design | [anthropics/skills:skills/frontend-design](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) | propose |
| 2 | ui-ux-pro-max | [nextlevelbuilder/ui-ux-pro-max-skill:.claude/skills/ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/e59ff376a41f7ca47b7541ad5c116495cbade3ee/.claude/skills/ui-ux-pro-max) | propose |
| 3 | web-design-guidelines | [vercel-labs/agent-skills:skills/web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) | conditional |
| 4 | vercel-react-view-transitions | [vercel-labs/agent-skills:skills/react-view-transitions](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-view-transitions) | propose |
| 5 | web-perf | [cloudflare/skills:skills/web-perf](https://github.com/cloudflare/skills/tree/cbf893b954222276bf1af57e5f23379231e0efb9/skills/web-perf) | propose |
## Données

Parcours CSV/Pandas pour explorer et préparer ; parcours SQL/dbt pour les entrepôts. Ne pas installer dbt pour une simple analyse CSV.

| Order | Skill | Source | Status |
| --- | --- | --- | --- |
| 1 | data-analysis | [TerminalSkills/skills:skills/data-analysis](https://github.com/TerminalSkills/skills/tree/42289059901710441bfa8081c08c3a9f36b93f9c/skills/data-analysis) | conditional |
| 2 | pandas | [TerminalSkills/skills:skills/pandas](https://github.com/TerminalSkills/skills/tree/42289059901710441bfa8081c08c3a9f36b93f9c/skills/pandas) | conditional |
| 3 | supabase-postgres-best-practices | [supabase/agent-skills:skills/supabase-postgres-best-practices](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices) | propose |
| 4 | running-dbt-commands | [dbt-labs/dbt-agent-skills:skills/dbt/skills/running-dbt-commands](https://github.com/dbt-labs/dbt-agent-skills/tree/b8facde20b7a92c40ce3e6b86b71c4b92aa44040/skills/dbt/skills/running-dbt-commands) | propose |
| 5 | answering-natural-language-questions-with-dbt | [dbt-labs/dbt-agent-skills:skills/dbt/skills/answering-natural-language-questions-with-dbt](https://github.com/dbt-labs/dbt-agent-skills/tree/b8facde20b7a92c40ce3e6b86b71c4b92aa44040/skills/dbt/skills/answering-natural-language-questions-with-dbt) | propose |
## Automatisation

Parcours n8n : orientation, construction, paramètres, erreurs et fichiers. MCP est une alternative de développement ; Durable Objects une spécialisation Cloudflare.

| Order | Skill | Source | Status |
| --- | --- | --- | --- |
| 1 | using-n8n-skills-official | [n8n-io/skills:skills/using-n8n-skills-official](https://github.com/n8n-io/skills/tree/626f50fdf2934116eea2c5469339e03d2d524e83/skills/using-n8n-skills-official) | propose |
| 2 | n8n-workflow-lifecycle-official | [n8n-io/skills:skills/n8n-workflow-lifecycle-official](https://github.com/n8n-io/skills/tree/626f50fdf2934116eea2c5469339e03d2d524e83/skills/n8n-workflow-lifecycle-official) | propose |
| 3 | n8n-node-configuration-official | [n8n-io/skills:skills/n8n-node-configuration-official](https://github.com/n8n-io/skills/tree/626f50fdf2934116eea2c5469339e03d2d524e83/skills/n8n-node-configuration-official) | propose |
| 4 | n8n-error-handling-official | [n8n-io/skills:skills/n8n-error-handling-official](https://github.com/n8n-io/skills/tree/626f50fdf2934116eea2c5469339e03d2d524e83/skills/n8n-error-handling-official) | conditional |
| 5 | n8n-binary-and-data-official | [n8n-io/skills:skills/n8n-binary-and-data-official](https://github.com/n8n-io/skills/tree/626f50fdf2934116eea2c5469339e03d2d524e83/skills/n8n-binary-and-data-official) | propose |

## Admission checklist

- Match pinned upstream revisions and fingerprints to the current extractor.
- Run the integrated pipeline and keep internal data out of public pages.
- Verify CSV runtime on a compatible machine and n8n on a test instance; verify recalculation if the optional spreadsheet skill is chosen.
- The owner approves exact skill IDs before curation changes. No collection is approved as a whole.
- Preserve the existing shared data contract and scoring configuration.
- Rebuild and verify the site after approved curation; synchronize the accepted sprint separately from production release.

The full local dossier contains schema-valid session records, read coverage, source revisions, limitations and reproducible targeted checks. It remains outside the public site and repository.
