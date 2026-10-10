import { afterEach, describe, expect, it, vi } from "vitest";
import { DDRAGON_VERSIONS_URL, fetchLolPatch, LOL_PATCH_NOTES_URL, parseVersions } from "../src/sources/ddragon";
import { fetchPatches, getGame } from "../src/sources/registry";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ddragon", () => {
  it("uses major.minor of the newest version as patch id", () => {
    expect(parseVersions(["16.19.1", "16.19.0", "16.18.1"], 123)).toEqual([
      { patchId: "16.19", title: "Patch 16.19", url: LOL_PATCH_NOTES_URL, contents: null, image: null, publishedAt: 123 },
    ]);
  });

  it("gives the same id for build-only bumps", () => {
    expect(parseVersions(["16.19.2"], 0)[0]?.patchId).toBe(parseVersions(["16.19.1"], 0)[0]?.patchId);
  });

  it("rejects unexpected data", () => {
    expect(() => parseVersions([], 0)).toThrow();
    expect(() => parseVersions({}, 0)).toThrow();
    expect(() => parseVersions(["lolpatch_7.20"], 0)).toThrow();
  });

  it("fetches versions.json", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(["16.20.1"]));
    expect((await fetchLolPatch(5))[0]?.patchId).toBe("16.20");
    expect(spy).toHaveBeenCalledWith(DDRAGON_VERSIONS_URL, { cache: "no-store" });
  });

  it("is the source used for lol", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(["16.20.1"]));
    expect((await fetchPatches(getGame("lol")!))[0]?.patchId).toBe("16.20");
  });

  it("throws on HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(fetchLolPatch()).rejects.toThrow("HTTP 500");
  });
});
