import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://accd.github.io",
  base: "/verchestra",
  output: "static",
  trailingSlash: "always",
  integrations: [
    sitemap(),
    starlight({
      title: "Verchestra",
      description: "Verified AI software delivery that survives the model, the machine, and the handoff.",
      customCss: ["./src/styles/global.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/accd/verchestra"
        }
      ],
      sidebar: [
        {
          label: "Start here",
          items: [{ label: "Overview", slug: "docs" }]
        },
        {
          label: "Architecture",
          items: [{ label: "System overview", slug: "docs/architecture/system-overview" }]
        },
        {
          label: "Qualification evidence",
          collapsed: true,
          items: [{ autogenerate: { directory: "docs/qualification", collapsed: true } }]
        },
        {
          label: "Community",
          collapsed: true,
          items: [{ autogenerate: { directory: "docs/community", collapsed: true } }]
        }
      ]
    })
  ]
});
