const CHECKED_PROTOCOLS = new Set(["http:", "https:"]);

// Selection is an allowlist, not a deny-list: the checker only reasons about pages
// this site publishes, and naming schemes to exclude would silently admit every
// scheme nobody thought to name.
export function checkableLinkTarget(value, pageUrl) {
  if (value.startsWith("#")) return null;
  const target = new URL(value, pageUrl);
  return CHECKED_PROTOCOLS.has(target.protocol) ? target : null;
}
