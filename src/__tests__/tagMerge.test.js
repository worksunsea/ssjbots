import { describe, it, expect } from "vitest";
import { mergeTagNames } from "../tagMerge.js";

describe("mergeTagNames", () => {
  it("replaces every source tag with the target", () => {
    expect(mergeTagNames(["vip", "gold", "rotary"], ["vip", "gold"], "premium")).toEqual(["premium", "rotary"]);
  });
  it("does not duplicate when the contact already has the target", () => {
    expect(mergeTagNames(["premium", "vip"], ["vip", "premium"], "premium")).toEqual(["premium"]);
  });
  it("leaves contacts without any source tag untouched (same array)", () => {
    const tags = ["rotary"];
    expect(mergeTagNames(tags, ["vip"], "premium")).toBe(tags);
  });
  it("handles null/undefined tag lists", () => {
    expect(mergeTagNames(null, ["vip"], "x")).toEqual([]);
    expect(mergeTagNames(undefined, ["vip"], "x")).toEqual([]);
  });
});
