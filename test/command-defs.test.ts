import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSION, COMMANDS } from "../src/command-defs";
import { GAMES } from "../src/sources/registry";

describe("command definitions", () => {
  it("defines the five commands of §7, guild-only", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(["setup", "games", "status", "test", "help"]);
    for (const c of COMMANDS) {
      expect(c.contexts).toEqual([0]);
      expect(c.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(c.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("restricts everything except /help to Manage Server", () => {
    for (const c of COMMANDS) {
      const perm = "default_member_permissions" in c ? c.default_member_permissions : undefined;
      expect(perm).toBe(c.name === "help" ? undefined : ADMIN_PERMISSION);
    }
  });

  it("offers every game in /test", () => {
    const test = COMMANDS.find((c) => c.name === "test")!;
    const choices = "options" in test ? (test.options[0] as { choices: { value: string }[] }).choices : [];
    expect(choices.map((c) => c.value)).toEqual(GAMES.map((g) => g.key));
  });
});
