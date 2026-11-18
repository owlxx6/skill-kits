import type { Catalog, CatalogCollection } from "./catalog";
import { canInstallRepository, kitCommands } from "./installation";

// A part of a kit installs as a whole repository only when the catalog lists all of it at a pinned revision
// (canInstallRepository). The other parts are installed skill by skill. The home explorer says which is which,
// and its command covers only the whole-repository parts, so it never claims more than it installs.

/** "Part 3", "Parts 3 and 4", "Parts 1, 3 and 4" (positions start at 1). */
export function partLabel(positions: number[]): string {
  const noun = positions.length === 1 ? "Part" : "Parts";
  if (positions.length < 2) return `${noun} ${positions[0]}`;
  return `${noun} ${positions.slice(0, -1).join(", ")} and ${positions[positions.length - 1]}`;
}

/** One or two sentences about the parts that are not whole-repository installs; empty when every part is one. */
export function installNote(whole: number[], other: number[], total: number): string {
  if (other.length === 0) return "";
  if (whole.length === 0) return `${total === 1 ? "This part is" : "Every part is"} installed skill by skill. Open the kit to choose.`;
  return `${partLabel(whole)} ${whole.length === 1 ? "installs as a whole repository" : "install as whole repositories"}. `
    + `${partLabel(other)} ${other.length === 1 ? "is" : "are"} installed skill by skill. Open the kit to choose.`;
}

export interface KitInstallPlan {
  /** One line for the whole-repository parts, in kit order; empty when no part qualifies. */
  command: string;
  /** What the command covers, for its accessible name: "the Web app builder kit" or "parts 3 and 4 of the ... kit". */
  commandLabel: string;
  note: string;
}

export function kitInstallPlan(catalog: Catalog, kitTitle: string, collections: CatalogCollection[]): KitInstallPlan {
  const installable = collections.map((entry) => canInstallRepository(catalog, entry));
  const positions = (wanted: boolean) => installable.flatMap((ok, index) => (ok === wanted ? [index + 1] : []));
  const whole = positions(true);
  const other = positions(false);
  const wholeIds = collections.filter((_, index) => installable[index]).map((entry) => entry.id);
  return {
    command: wholeIds.length > 0 ? kitCommands(catalog, wholeIds).join(" && ") : "",
    commandLabel: other.length === 0 ? `the ${kitTitle} kit` : `${partLabel(whole).toLowerCase()} of the ${kitTitle} kit`,
    note: installNote(whole, other, collections.length),
  };
}
