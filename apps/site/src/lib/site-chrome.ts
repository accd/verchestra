// The product chrome the Starlight pages share with the product pages: the
// same section links in the documentation header and mobile menu, and the same
// footer links. ProductLayout.astro keeps its own copy, since the product pages
// are not Starlight pages; both copies name the same targets.

export interface ChromeLink {
  readonly label: string;
  readonly href: string;
}

export interface NavigationLink extends ChromeLink {
  readonly current: boolean;
}

export function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/u, "")}`;
}

// Docs is current on every page below docs/, which includes the community
// guides; Roadmap only on the roadmap itself, since nothing lives below it.
export function productNavigation(base: string, pathname: string): readonly NavigationLink[] {
  const docs = withBase(base, "docs/");
  const roadmap = withBase(base, "roadmap/");
  const community = withBase(base, "community/");
  return [
    { label: "Docs", href: docs, current: pathname.startsWith(docs) },
    { label: "Roadmap", href: roadmap, current: pathname === roadmap },
    { label: "Community", href: community, current: pathname.startsWith(community) }
  ];
}

export function productFooterLinks(base: string): readonly ChromeLink[] {
  return [
    { label: "Documentation", href: withBase(base, "docs/") },
    { label: "Agent guide", href: withBase(base, "docs/community/contributing-with-agents/") },
    { label: "LLM summary", href: withBase(base, "llms.txt") },
    { label: "Discussions", href: "https://github.com/accd/verchestra/discussions" },
    { label: "Issues", href: "https://github.com/accd/verchestra/issues" }
  ];
}
