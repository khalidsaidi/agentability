import fs from "node:fs/promises";
import path from "node:path";

type SsrAssets = {
  scriptSrc: string;
  cssHref: string | null;
};

function matchFirst(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[1] ?? null;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const indexPath = path.join(repoRoot, "apps/web/dist/index.html");
  const outDir = path.join(repoRoot, "apps/functions/src/ssr");
  const outPath = path.join(outDir, "asset-manifest.ts");

  let html = "";
  try {
    html = await fs.readFile(indexPath, "utf8");
  } catch (error) {
    throw new Error("Missing apps/web/dist/index.html. Run pnpm -C apps/web build first.");
  }

  const scriptSrc =
    matchFirst(html, /<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/) ?? "";
  const cssHref =
    matchFirst(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/) ?? null;

  if (!scriptSrc) {
    throw new Error("Unable to locate the Vite entry script in dist/index.html.");
  }

  const assets: SsrAssets = { scriptSrc, cssHref };

  await fs.mkdir(outDir, { recursive: true });
  const content = [
    "export const SSR_ASSETS = " + JSON.stringify(assets, null, 2) + " as const;",
    "",
  ].join("\n");
  await fs.writeFile(outPath, content, "utf8");
  console.log(`SSR asset manifest written: ${path.relative(repoRoot, outPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("SSR asset manifest build failed:", error);
    process.exit(1);
  });
}
