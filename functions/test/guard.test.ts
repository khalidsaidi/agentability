// Run: npx tsx test/guard.test.ts  (from functions/). Exits non-zero on any miss.
// Each case is something a hostile visitor could submit to the public check.

import { guardedFetch, normalizeDomain, requestContext, isPublicAddress } from "../src/guard";
import { evaluateSite, configureFetch } from "../../scripts/lib/evaluate-site";

let failed = 0;
const ok = (name: string, pass: boolean, extra = "") => {
  if (!pass) failed += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

async function blocked(url: string): Promise<string | null> {
  const ctx: { blocked?: string } = {};
  try {
    await requestContext.run(ctx, () => guardedFetch(url, { redirect: "manual" }));
    return null;
  } catch (e) {
    return ctx.blocked ?? `not a block: ${(e as Error).message}`;
  }
}

async function main() {
  console.log("normalizeDomain");
  const valid: Array<[string, string]> = [
    ["example.com", "example.com"],
    ["https://Example.com/pricing?x=1", "example.com"],
    ["www.bbc.co.uk", "www.bbc.co.uk"],
    ["bücher.de", "xn--bcher-kva.de"],
  ];
  for (const [i, want] of valid) ok(`accepts ${i}`, normalizeDomain(i) === want, String(normalizeDomain(i)));
  for (const bad of ["", "localhost", "127.0.0.1", "[::1]", "http://10.0.0.1", "example.com:8080", "user:pw@example.com", "foo.local", "metadata.google.internal", "ftp://example.com", "a".repeat(400), "nodot", "-bad-.com", "javascript:alert(1)", 42]) {
    ok(`rejects ${JSON.stringify(bad).slice(0, 40)}`, normalizeDomain(bad) === null);
  }

  console.log("\naddress ranges");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:a00:1::"]) {
    ok(`refuses ${ip}`, !isPublicAddress(ip));
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) ok(`allows ${ip}`, isPublicAddress(ip));

  console.log("\nguardedFetch refuses");
  const attacks = [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/computeMetadata/v1/",
    "http://metadata.google.internal/",
    "http://[::1]/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://[::ffff:127.0.0.1]/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://localtest.me/", // public name that resolves to 127.0.0.1
    "http://example.com:8080/",
    "file:///etc/passwd",
  ];
  for (const a of attacks) {
    const r = await blocked(a);
    ok(a, r !== null && !r.startsWith("not a block"), r ?? "WENT THROUGH");
  }

  console.log("\nguardedFetch allows a public site");
  const res = await guardedFetch("https://example.com/", { redirect: "manual" });
  ok("https://example.com/ answers", res.status === 200, String(res.status));

  console.log("\nthe auditor, through the guard");
  configureFetch(guardedFetch);
  // A public homepage that redirects to a private address. The first hop is
  // stubbed (public redirect services refuse scripted clients); every later hop
  // goes through the real guard via the auditor's own redirect loop.
  {
    configureFetch(async (input, init) => {
      if (String(input) === "https://example.com/") {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
      }
      return guardedFetch(input, init);
    });
    const ctx: { blocked?: string } = {};
    await requestContext.run(ctx, () => evaluateSite("example.com"));
    ok("homepage redirecting to 127.0.0.1 is refused at the hop", Boolean(ctx.blocked), ctx.blocked ?? "NOT BLOCKED");
    configureFetch(guardedFetch);
  }
  {
    const ctx: { blocked?: string } = {};
    const r = await requestContext.run(ctx, () => evaluateSite("localtest.me"));
    ok("evaluateSite(localtest.me) is blocked, not audited", Boolean(ctx.blocked) && r.status !== "complete", ctx.blocked);
  }
  {
    const r = await evaluateSite("apify.com");
    ok("evaluateSite(apify.com) completes through the guard", r.status === "complete", `score ${r.score}`);
  }

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

main();
