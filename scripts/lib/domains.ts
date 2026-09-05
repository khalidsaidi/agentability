// help.netflix.com and netflix.com are one brand — collapse hosts to their root.
const TWO_PART_TLD = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;

export function rootDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  return parts.slice(-(TWO_PART_TLD.test(h) ? 3 : 2)).join(".");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
