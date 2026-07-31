import { readFile, readdir } from "node:fs/promises";

import { docsLoader } from "@astrojs/starlight/loaders";
import type { Loader, LoaderContext } from "astro/loaders";

import {
  assertProjectStatus,
  canonicalContentFilePath,
  compileQualificationStatus,
  extractDescription,
  extractTitle,
  isCanonicalSourcePath,
  QUALIFICATION_REPORT_FILE,
  repositoryContentSources,
  resolveRepositoryPath,
  rewriteCanonicalLinks,
  validateUniqueRoutes,
  type RepositoryContentSource
} from "./repository-content.ts";

async function loadCanonicalEntries(context: LoaderContext, repositoryRoot: URL): Promise<Set<string>> {
  validateUniqueRoutes(repositoryContentSources);
  const status = await compileQualificationStatus(repositoryRoot);
  await assertProjectStatus(repositoryRoot, status);

  const qualificationDirectory = resolveRepositoryPath(repositoryRoot, "docs/qualification");
  const qualificationSources: RepositoryContentSource[] = (await readdir(qualificationDirectory))
    .filter((entry) => QUALIFICATION_REPORT_FILE.test(entry))
    .sort()
    .map((entry, index) => ({
      id: `qualification-${entry.replace(/\.md$/i, "")}`,
      sourcePath: `docs/qualification/${entry}`,
      route: `docs/qualification/${entry.replace(/\.md$/i, "")}`,
      section: "Qualification",
      order: index + 1,
      search: true
    }));

  const sources = [...repositoryContentSources, ...qualificationSources];
  validateUniqueRoutes(sources);
  const canonicalIds = new Set(sources.map((source) => source.route));

  for (const source of sources) {
    const sourceFilePath = resolveRepositoryPath(repositoryRoot, source.sourcePath);
    const originalMarkdown = await readFile(sourceFilePath, "utf8");
    const markdown = rewriteCanonicalLinks(originalMarkdown, source, sources, context.config.base);
    const title = source.title ?? extractTitle(originalMarkdown);
    const description = source.description ?? extractDescription(originalMarkdown);
    const data = await context.parseData({
      id: source.route,
      data: {
        title,
        description,
        pagefind: source.search,
        sidebar: {
          label: title,
          order: source.order
        }
      }
    });

    context.store.set({
      id: source.route,
      data,
      body: markdown,
      filePath: canonicalContentFilePath(source.route),
      digest: context.generateDigest(`${JSON.stringify(data)}\n${markdown}`),
      rendered: await context.renderMarkdown(markdown)
    });
  }

  return canonicalIds;
}

export function repositoryDocsLoader(): Loader {
  const localDocs = docsLoader();
  return {
    name: "verchestra-repository-docs-loader",
    async load(context) {
      await localDocs.load(context);
      const repositoryRoot = new URL("../../", context.config.root);
      let canonicalIds = await loadCanonicalEntries(context, repositoryRoot);

      const reloadCanonicalEntries = async (changedPath: string) => {
        if (!isCanonicalSourcePath(repositoryRoot, changedPath)) return;
        for (const id of canonicalIds) context.store.delete(id);
        canonicalIds = await loadCanonicalEntries(context, repositoryRoot);
      };

      context.watcher?.on("add", reloadCanonicalEntries);
      context.watcher?.on("change", reloadCanonicalEntries);
      context.watcher?.on("unlink", reloadCanonicalEntries);
    }
  };
}
