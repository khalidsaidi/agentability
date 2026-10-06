// help.netflix.com and netflix.com are one brand — collapse hosts to their root.
const TWO_PART_TLD = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;

export function rootDomain(host: string): string {
  // Callers sometimes hand us a URL or a host with a path attached.
  const h = host.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].replace(/^www\./, "");
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
