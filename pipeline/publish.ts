import type { Catalog, RunInfo } from "./lib/schemas";

// A pull request body is limited in size, and long lists are not read anyway.
const MAX_LISTED = 30;
// GitHub refuses a pull request body above 65,536 characters.
const MAX_SUMMARY_CHARS = 60_000;
const MAX_INLINE_CHARS = 300;

// Text written by the model ends up in a pull request: strip what could break
// the Markdown, form a link or an image, and never let it notify a GitHub user with an @mention.
const inlineText = (text: string): string =>
  Array.from(
    text
      .replace(/[`\r\n]+/g, " ")
      // Backslash first, so a backslash in the text cannot cancel the escapes added below.
      .replace(/\\/g, "\\\\")
      .replace(/[[\]!]/g, (char) => `\\${char}`)
      .replace(/@/g, "(at)")
      .replace(/\s+/g, " ")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/#(?=\d)/g, "# ")
      .trim(),
  )
    .slice(0, MAX_INLINE_CHARS)
    .join("")
    .trim();

function skillRef(id: string, skillById: Map<string, Catalog["skills"][number]>): string {
  const skill = skillById.get(id);
  if (!skill) return `\`${id}\``;
  try {
    // encodeURI keeps ( ) # ? as they are, which would break the Markdown link or change the page.
    const target = encodeURI(skill.url).replace(
      /[()#?]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `[\`${id}\`](${target})`;
  } catch {
    // encodeURI throws on a lone surrogate: fall back to the plain id.
    return `\`${id}\``;
  }
}

// One line per skill: link, score, the model's reason, and a security notice when there is one.
function skillLine(
  id: string,
  score: number | undefined,
  skillById: Map<string, Catalog["skills"][number]>,
): string {
  const review = skillById.get(id)?.review;
  const scoreText = score === undefined ? "" : ` - score ${score}`;
  const why = inlineText(review?.why ?? "");
  const notice = review?.security.level === "notice" ? " - security notice" : "";
  return `- ${skillRef(id, skillById)}${scoreText}${why ? ` - ${why}` : ""}${notice}`;
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LISTED) return lines;
  return [...lines.slice(0, MAX_LISTED), `- ... and ${lines.length - MAX_LISTED} more`];
}

export function buildSummary(catalog: Catalog, runInfo: RunInfo): string {
  const skillById = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const lines: string[] = [
    `# Pipeline run ${catalog.generatedAt.slice(0, 10)}`,
    "",
    `Catalog: ${catalog.skills.length + (catalog.sourceSkills?.length ?? 0)} skills, ${catalog.collections.length} collections.`,
    "",
    "To validate: add ids to `approved` or `rejected` in `data/curation.yaml` on this branch, then merge.",
    "",
  ];

  const { review, extract, filtered, renamed } = runInfo;
  // A skill reviewed in this run while already approved is one whose content changed.
  const reviewedNow = new Set(review?.reviewedIds ?? []);
  if (review || extract) {
    lines.push("## Run", "");
    if (extract) {
      lines.push(
        `- Extract: ${extract.repos} repos read, ${extract.skills} skills, ${extract.invalid} invalid SKILL.md files, ${extract.failedDownloads} failed downloads`,
      );
      // Absent from run information written before license resolution.
      const licenses = extract.licenses;
      if (licenses) {
        lines.push(
          `- Licenses: ${licenses.identifiedAllowed} identified and allowed, ${licenses.identifiedNotAllowed} identified but not allowed, ${licenses.custom} custom, ${licenses.ambiguous} ambiguous, ${licenses.missing} missing, ${licenses.notReRead} not re-read, ${licenses.waitingForSafetyScan} waiting for the safety scan, ${licenses.unresolved} unresolved, ${licenses.failedDownloads} failed license downloads`,
        );
      }
      // Counts only: findings, paths and excerpts are for the owner and never leave the cache.
      const safety = extract.safety;
      if (safety) {
        lines.push(
          `- Safety scan: ${safety.scanned} scanned, ${safety.reused} reused, ${safety.clear} clear, ${safety.review} to review, ${safety.block} blocked, ${safety.notScanned} not scanned`,
        );
      }
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
      if (review.stoppedByTimeBudget) {
        lines.push("- Stopped by the time budget (review.maxMinutes): the rest is deferred to the next run");
      }
    }
    lines.push("");
  }

  if (renamed && renamed.length > 0) {
    lines.push("## Renamed repositories", "");
    lines.push(
      ...capped(renamed.map((entry) => `- \`${inlineText(entry.from)}\` -> \`${inlineText(entry.to)}\``)),
      "",
      "Update data/sources.yaml and the ids in data/curation.yaml.",
      "",
    );
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
      lines.push("**Approved skills re-reviewed this run:**", "");
      lines.push(
        ...capped(changed.map((id) => skillLine(id, skillById.get(id)?.score, skillById))),
        "",
      );
    }
    if (kit.removed.length > 0) {
      lines.push("**Approved entries that are no longer eligible (below threshold, severe, or gone):**", "");
      lines.push(...capped(kit.removed.map((entry) => `- \`${entry.id}\` - ${entry.reason}`)), "");
    }
    if (kit.pending.length > 0) {
      lines.push("**Approved entries pending (hidden until ready):**", "");
      lines.push(
        ...capped(
          kit.pending.map((id) => {
            const reason = kit.pendingReasons?.[id];
            return reason ? `- \`${id}\` - ${inlineText(reason)}` : `- \`${id}\``;
          }),
        ),
        "",
      );
    }
    if (kit.proposals.collections.length > 0) {
      lines.push("**Collection candidates:**", "");
      lines.push(...kit.proposals.collections.map((entry) => `- \`${entry.id}\` - score ${entry.score}`), "");
    }
    if (kit.proposals.skills.length > 0) {
      lines.push("**Skill candidates:**", "");
      lines.push(...kit.proposals.skills.map((entry) => skillLine(entry.id, entry.score, skillById)), "");
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
    lines.push(...capped(filtered.map((entry) => `- \`${entry.fullName}\`: ${inlineText(entry.reason)}`)), "");
  }

  const text = `${lines.join("\n").trimEnd()}\n`;
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  const cut = text.lastIndexOf("\n", MAX_SUMMARY_CHARS);
  const end = cut > 0 ? cut : MAX_SUMMARY_CHARS;
  return `${text.slice(0, end).trimEnd()}\n\n_Summary truncated at ${MAX_SUMMARY_CHARS} characters. The full text is in the workflow run log._\n`;
}
