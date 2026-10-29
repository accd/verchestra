import { root } from "astro:config/server";

// The site is a projection of the repository two directories up. A page
// cannot find it through `import.meta.url`: at build time that names the
// prerender chunk under `dist/`, not the source file, so a relative walk lands
// in the wrong place. Astro's own project root is the stable anchor.
export const repositoryRoot = new URL("../../", root);
