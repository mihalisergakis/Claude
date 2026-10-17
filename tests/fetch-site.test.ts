import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchSite, htmlToText } from "@/lib/research/fetch-site";

const pages: Record<string, string> = {
  "/robots.txt": "User-agent: *\nDisallow: /private\n",
  "/": `<html><head><style>.x{}</style><script>var a=1</script></head><body>
    <h1>Wasatch Home Team</h1><p>Serving Layton &amp; Kaysville</p>
    <a href="/our-team">Meet the team</a> <a href="/private/agents">Private agents</a>
    <a href="https://zillow.com/profile">Zillow</a> <a href="mailto:hello@wasatchteam.test">Email us</a>
    <a href="tel:801-555-0100">Call</a></body></html>`,
  "/our-team": `<html><body><h2>Our Agents</h2><ul><li>Jane Doe, Team Lead</li><li>John Roe, Buyer Agent</li></ul>
    <p>Reach Jane at jane@wasatchteam.test</p><img src="logo@2x.png"></body></html>`,
  "/private/agents": "<p>secret</p>",
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = pages[req.url ?? "/"];
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": req.url === "/robots.txt" ? "text/plain" : "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("htmlToText", () => {
  it("drops scripts/styles and decodes entities", () => {
    const text = htmlToText("<style>a{}</style><script>x()</script><p>A &amp; B</p><p>C</p>");
    expect(text).toBe("A & B\nC");
  });
});

describe("fetchSite", () => {
  it("follows team/contact links on the same site, honors robots.txt, and finds published contacts", async () => {
    const result = await fetchSite(`${base}/`);
    expect(result.error).toBeNull();
    const urls = result.pages.map((p) => new URL(p.url).pathname);
    expect(urls).toEqual(["/", "/our-team"]); // /private disallowed, zillow off-site
    const emails = result.pages.flatMap((p) => p.emails).sort();
    expect(emails).toEqual(["hello@wasatchteam.test", "jane@wasatchteam.test"]); // logo@2x.png ignored
    expect(result.pages[0].phones).toContain("801-555-0100");
    expect(result.pages[1].text).toContain("Jane Doe, Team Lead");
  });

  it("refuses sites whose robots.txt disallows the start page", async () => {
    pages["/robots.txt"] = "User-agent: *\nDisallow: /\n";
    const result = await fetchSite(`${base}/`);
    expect(result.blockedByRobots).toBe(true);
    expect(result.pages).toHaveLength(0);
    pages["/robots.txt"] = "User-agent: *\nDisallow: /private\n";
  });
});
