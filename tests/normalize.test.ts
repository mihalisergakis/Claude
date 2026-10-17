import { describe, expect, it } from "vitest";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeWebsite } from "@/lib/normalize";

describe("normalize", () => {
  it("normalizes domains", () => {
    expect(normalizeDomain("https://WWW.WasatchTeam.com/about")).toBe("wasatchteam.com");
    expect(normalizeDomain("wasatchteam.com")).toBe("wasatchteam.com");
    expect(normalizeDomain("not a url")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });

  it("normalizes websites", () => {
    expect(normalizeWebsite("wasatchteam.com")).toBe("https://wasatchteam.com");
    expect(normalizeWebsite("http://x.com/team/")).toBe("http://x.com/team/");
  });

  it("normalizes emails and rejects junk", () => {
    expect(normalizeEmail(" Mailto:Jane@Team.COM ")).toBe("jane@team.com");
    expect(normalizeEmail("jane at team")).toBeNull();
  });

  it("normalizes US phones only", () => {
    expect(normalizePhone("(801) 555-0100")).toBe("+18015550100");
    expect(normalizePhone("1-801-555-0100")).toBe("+18015550100");
    expect(normalizePhone("555-0100")).toBeNull();
  });
});
