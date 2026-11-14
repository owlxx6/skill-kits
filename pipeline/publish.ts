import type { Catalog, RunInfo } from "./lib/schemas";

// A pull request body is limited in size, and long lists are not read anyway.
const MAX_LISTED = 30;

// Text written by the model ends up in a pull request: strip what could break
// the Markdown, and never let it notify a GitHub user with an @mention.
const inlineText = (text: string): string =>
  text
    .replace(/[`\r\n]+/g, " ")
    .replace(/@/g, "(at)")
    .replace(/\s+/g, " ")
    .trim();

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LISTED) return lines;
  return [...lines.slice(0, MAX_LISTED), `- ... and ${lines.length - MAX_LISTED} more`];
}

export function buildSummary(catalog: Catalog, runInfo: RunInfo): string {
  const skillById = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const lines: string[] = [
    `# Pipeline run ${catalog.generatedAt.slice(0, 10)}`,
    "",
    `Catalog: ${catalog.skills.length} skills, ${catalog.collections.length} collections.`,
    "",
    "To validate: add ids to `approved` or `rejected` in `data/curation.yaml` on this branch, then merge.",
    "",
  ];

  const { review, extract, filtered } = runInfo;
  // A skill reviewed in this run while already approved is one whose content changed.
  const reviewedNow = new Set(review?.reviewedIds ?? []);
  if (review || extract) {
    lines.push("## Run", "");
    if (extract) {
      lines.push(
        `- Extract: ${extract.repos} repos read, ${extract.skills} skills, ${extract.invalid} invalid SKILL.md files, ${extract.failedDownloads} failed downloads`,
      );
    }
    if (review) {
      const perSkillIn = review.reviewed ? Math.round(review.reviewUsage.inputTokens / review.reviewed) : 0;
      const perSkillOut = review.reviewed ? Math.round(review.reviewUsage.outputTokens / review.reviewed) : 0;
      lines.push(
        `- Triage: ${review.triaged} skills sorted, ${review.triageMissing} without an answer`,
        `- Review: ${review.reviewed} reviewed, ${review.failed.length} failed, ${review.deferred} deferred to the next run, ${review.truncated} cut for length`,
        `- Triage tokens: ${review.triageUsage.inputTokens} in, ${review.triageUsage.outputTokens} out`,
        `- Review tokens: ${review.reviewUsage.inputTokens} in, ${review.reviewUsage.outputTokens} out (${perSkillIn} in, ${perSkillOut} out per reviewed skill)`,
      );
    }
    lines.push("");
  }

  for (const kit of catalog.kits) {
    lines.push(
      `## ${kit.title} (\`${kit.id}\`)`,
      "",
      `Approved: ${kit.collections.length} collections, ${kit.skills.length} skills.`,
      "",
    );
    const changed = kit.skills.filter((id) => reviewedNow.has(id));
    if (changed.length > 0) {
      lines.push("**Approved skills re-reviewed this run (content changed):**", "");
      lines.push(...capped(changed.map((id) => `- \`${id}\``)), "");
    }
    if (kit.removed.length > 0) {
      lines.push("**Approved entries that are no longer eligible (below threshold, severe, or gone):**", "");
      lines.push(...capped(kit.removed.map((id) => `- \`${id}\``)), "");
    }
    if (kit.pending.length > 0) {
      lines.push("**Approved entries awaiting re-review (hidden until reviewed):**", "");
      lines.push(...capped(kit.pending.map((id) => `- \`${id}\``)), "");
    }
    if (kit.proposals.collections.length > 0) {
      lines.push("**Collection candidates:**", "");
      lines.push(...kit.proposals.collections.map((entry) => `- \`${entry.id}\` - score ${entry.score}`), "");
    }
    if (kit.proposals.skills.length > 0) {
      lines.push("**Skill candidates:**", "");
      lines.push(
        ...kit.proposals.skills.map((entry) => {
          const why = inlineText(skillById.get(entry.id)?.review.why ?? "");
          return `- \`${entry.id}\` - score ${entry.score} - ${why}`;
        }),
        "",
      );
    }
  }

  if (review && review.failed.length > 0) {
    lines.push("## Failed reviews", "");
    lines.push(...capped(review.failed.map((entry) => `- \`${entry.skillId}\`: ${inlineText(entry.reason)}`)), "");
  }
  if (extract && extract.failedRepos.length > 0) {
    lines.push("## Repos that could not be read", "");
    lines.push(...capped(extract.failedRepos.map((entry) => `- \`${entry.repo}\`: ${inlineText(entry.error)}`)), "");
  }
  if (extract && extract.truncatedRepos.length > 0) {
    lines.push("## Repos too large to list completely", "");
    lines.push(...capped(extract.truncatedRepos.map((repo) => `- \`${repo}\``)), "");
  }
  if (filtered && filtered.length > 0) {
    lines.push("## Repos excluded by the filter", "");
    lines.push(...capped(filtered.map((entry) => `- \`${entry.fullName}\`: ${entry.reason}`)), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
