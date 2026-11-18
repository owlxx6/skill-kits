import { describe, expect, it } from "vitest";
import { renderShareCard } from "../src/lib/og-image";

describe("share image", () => {
  it("renders a 1200 x 630 PNG", async () => {
    const png = await renderShareCard({ eyebrow: "Kit · 2 collections", title: "Resume & career agent", lines: ["1   example/repo"], footer: "Reviewed agent skills" });
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  }, 20_000);
});
