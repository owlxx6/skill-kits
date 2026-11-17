import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo } from "../pipeline/extract";
import { mapLimit } from "../pipeline/lib/concurrency";
import { FakeGitHub } from "./fakes";
import { makeRepo, skillMd } from "./fixtures";

// A GitHub whose file reads take a moment and are counted while they are in flight.
class SlowGitHub extends FakeGitHub {
  inFlight = 0;
  peak = 0;
  // Reads that finish in reverse order of their start, to prove the result does not depend on it.
  override async getFileText(fullName: string, ref: string, filePath: string): Promise<string> {
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      const delay = filePath.endsWith("SKILL.md") ? 20 - (this.fileReads.length % 10) : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await super.getFileText(fullName, ref, filePath);
    } finally {
      this.inFlight -= 1;
    }
  }
}

function manySkills(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const name = `skill-${String(index).padStart(3, "0")}`;
    files[`skills/${name}/SKILL.md`] = skillMd(name, `Description of ${name}.`);
  }
  return files;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapLimit", () => {
  it("never runs more than the limit at once, and runs everything", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await mapLimit([...Array(25).keys()], 4, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      done.push(item);
    });
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });

  it("is a sequential loop with a limit of 1, and does nothing for no items", async () => {
    const order: number[] = [];
    await mapLimit([1, 2, 3], 1, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 3 - item));
      order.push(item);
    });
    expect(order).toEqual([1, 2, 3]);
    await expect(mapLimit([], 8, async () => {})).resolves.toBeUndefined();
  });
});

describe("extractRepo reads SKILL.md files in parallel", () => {
  it("reads several at once, never more than 8, and keeps the listing order", async () => {
    const repo = { meta: makeRepo(), files: manySkills(40) };
    const gh = new SlowGitHub([repo]);
    const result = await extractRepo(gh, repo.meta, new Map());
    expect(gh.peak).toBeGreaterThan(1);
    expect(gh.peak).toBeLessThanOrEqual(8);
    expect(result.skills.map((skill) => skill.name)).toEqual(
      Object.keys(repo.files).map((file) => file.split("/")[1]),
    );
    expect(result.invalid).toBe(0);
    expect(result.failedDownloads).toBe(0);
  });

  it("gives the same records as one read at a time would", async () => {
    const repo = { meta: makeRepo(), files: manySkills(25) };
    const parallel = await extractRepo(new SlowGitHub([repo]), repo.meta, new Map());
    const plain = await extractRepo(new FakeGitHub([repo]), repo.meta, new Map());
    expect(parallel.skills).toEqual(plain.skills);
  });

  it("counts an unreadable SKILL.md and an invalid one without losing the others", async () => {
    const files = manySkills(12);
    files["skills/skill-005/SKILL.md"] = "# No front matter";
    const repo = { meta: makeRepo(), files };
    const gh = new SlowGitHub([repo]);
    gh.failFileFor.add("acme/skills/skills/skill-003/SKILL.md");
    const result = await extractRepo(gh, repo.meta, new Map());
    expect(result.skills).toHaveLength(10);
    expect(result.invalid).toBe(1);
    expect(result.failedDownloads).toBe(1);
    expect(result.skills.map((skill) => skill.name)).not.toContain("skill-003");
    expect(result.skills.map((skill) => skill.name)).not.toContain("skill-005");
    expect(console.warn).toHaveBeenCalledWith("Invalid SKILL.md front matter: acme/skills:skills/skill-005");
  });

  it("keeps the previous record of a skill whose SKILL.md cannot be read, as not re-read", async () => {
    const repo = { meta: makeRepo(), files: manySkills(6) };
    const first = await extractRepo(new FakeGitHub([repo]), repo.meta, new Map());
    const known = new Map(first.skills.map((skill) => [skill.id, skill]));
    repo.files["skills/skill-002/SKILL.md"] = skillMd("skill-002", "Changed description.");
    const gh = new SlowGitHub([repo]);
    gh.failFileFor.add("acme/skills/skills/skill-002/SKILL.md");
    const second = await extractRepo(gh, repo.meta, known);
    const kept = second.skills.find((skill) => skill.name === "skill-002");
    expect(kept?.description).toBe("Description of skill-002.");
    expect(kept?.license).toMatchObject({ outcome: "ambiguous", unread: "skill-file" });
    expect(second.failedDownloads).toBe(1);
  });
});
