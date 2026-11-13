import { describe, expect, it } from "vitest";
import { compareText } from "../pipeline/lib/text";

describe("compareText", () => {
  it("orders by code unit", () => {
    expect(compareText("B", "a")).toBe(-1);
    expect(compareText("a-b", "ab")).toBe(-1);
    expect(compareText("b", "a")).toBe(1);
    expect(compareText("same", "same")).toBe(0);
  });
});
