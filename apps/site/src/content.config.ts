import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

import { repositoryDocsLoader } from "./lib/repository-docs-loader.ts";

export const collections = {
  docs: defineCollection({
    loader: repositoryDocsLoader(),
    schema: docsSchema()
  })
};
