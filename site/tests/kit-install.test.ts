import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/lib/catalog";
import { canInstallRepository } from "../src/lib/installation";
import { installNote, kitInstallPlan, partLabel } from "../src/lib/kit-install";

describe("kit install note", () => {
  it("numbers the parts the way the explorer shows them", () => {
    expect(partLabel([3])).toBe("Part 3");
    expect(partLabel([3, 4])).toBe("Parts 3 and 4");
    expect(partLabel([1, 3, 4])).toBe("Parts 1, 3 and 4");
  });

  it("says nothing when every part is a whole-repository install", () => {
    expect(installNote([1, 2, 3], [], 3)).toBe("");
  });

  it("separates whole-repository parts from skill-by-skill parts", () => {
    expect(installNote([3, 4], [1, 2], 4)).toBe(
      "Parts 3 and 4 install as whole repositories. Parts 1 and 2 are installed skill by skill. Open the kit to choose.",
    );
    expect(installNote([2], [1], 2)).toBe(
      "Part 2 installs as a whole repository. Part 1 is installed skill by skill. Open the kit to choose.",
    );
  });

  it("does not offer a command when no part is a whole-repository install", () => {
    expect(installNote([], [1, 2, 3], 3)).toBe("Every part is installed skill by skill. Open the kit to choose.");
    expect(installNote([], [1], 1)).toBe("This part is installed skill by skill. Open the kit to choose.");
  });
});

describe("kit install plan on the real catalog", () => {
  const catalog = loadCatalog();

  for (const kit of catalog.kits) {
    it(`${kit.id}: the command covers exactly the whole-repository parts`, () => {
      const collections = kit.collections.flatMap((id) => catalog.collections.find((entry) => entry.id === id) ?? []);
      const whole = collections.filter((entry) => canInstallRepository(catalog, entry));
      const plan = kitInstallPlan(catalog, kit.title, collections);

      const lines = plan.command === "" ? [] : plan.command.split(" && ");
      expect(lines).toHaveLength(whole.length);
      whole.forEach((entry, index) => expect(lines[index]).toMatch(new RegExp(`^npx skills add ${entry.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@[a-f0-9]{40}$`)));
      // A note appears exactly when some part is left out of the command.
      expect(plan.note === "").toBe(whole.length === collections.length);
      if (whole.length === 0) expect(plan.command).toBe("");
    });
  }
});
