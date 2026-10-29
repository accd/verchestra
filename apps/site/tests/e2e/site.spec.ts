import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const templates = [
  { name: "product landing", path: "" },
  { name: "community", path: "community/" },
  { name: "canonical roadmap", path: "roadmap/" },
  { name: "documentation", path: "docs/" },
  { name: "database matrix", path: "docs/integrations/database-capability-matrix/" },
  { name: "qualification evidence", path: "docs/qualification/t68-validation/" },
  { name: "recovery", path: "404.html" }
];

for (const template of templates) {
  test(`${template.name} template has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(template.path);
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}

test("landing presents the honest delivery and qualification contract", async ({ page }) => {
  await page.goto("");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "AI delivery that survives the model, the machine, and the handoff."
  );
  await expect(page.getByLabel("Current public status")).toContainText("0.0.0-qualification");
  await expect(page.getByLabel("Current public status")).toContainText("T77 verified");
  await expect(page.getByLabel("Current public status")).toContainText("1.0 decision: signed hold");
  await expect(page.getByText("SAP ASE / Sybase", { exact: true })).toBeVisible();
  await expect(page.getByText("OpenCode / Qwen", { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href^="/"]:not([href^="/verchestra/"])')).toHaveCount(0);
});

// why: the redesigned landing page carries one concrete artefact per section.
// The two drawings are inline SVG with a role, a title, and a description, and
// the install block names a real build; a page that lost either would still
// pass the status assertions above.
test("landing renders the install block, both diagrams, and the derived numbers", async ({ page }) => {
  await page.goto("");
  await expect(page.getByLabel("Current public status")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  const install = page.locator("pre.install");
  await expect(install).toBeVisible();
  await expect(install).toHaveAttribute("tabindex", "0");
  await expect(install).toContainText(/npx verchestra@0\.0\.0-qualification(?:\.\d+)? --version/u);
  await expect(install).toContainText("self-test --profile smoke");
  await expect(page.locator(".diagram[role=img]")).toHaveCount(2);
  await expect(page.getByRole("img", { name: /delivery path/u })).toBeVisible();
  await expect(page.getByRole("img", { name: /architecture/u })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /capabilities, \d+ public reports/u })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What travels. What stays." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Read the signed 1\.0 hold/u })).toHaveAttribute(
    "href",
    "https://github.com/accd/verchestra/blob/main/docs/qualification/release-decision-1.0.0.md"
  );
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Evidence" })).toBeVisible();
});

test("mobile navigation and the status remain usable in the first viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  const status = page.getByLabel("Current public status");
  await expect(status).toBeInViewport();
  // The install block follows the status on a phone, and the drawings give
  // way to the same data as text: the stage list and the architecture edges.
  await expect(page.locator("pre.install")).toBeVisible();
  // The page clips its own overflow, so the viewport-width check elsewhere
  // cannot see a hero column the install block has pushed past the screen;
  // the block itself must end inside the viewport and scroll its content.
  const installBox = await page.locator("pre.install").boundingBox();
  expect(installBox && installBox.x + installBox.width <= 390, "the install block fits the viewport").toBe(true);
  await expect(page.locator("pre.install")).toHaveCSS("overflow-x", "auto");
  await expect(page.locator(".diagram")).toHaveCount(2);
  for (const diagram of await page.locator(".diagram").all()) await expect(diagram).toBeHidden();
  await expect(page.locator("ol.delivery-list")).toBeVisible();
  await expect(page.locator("ol.delivery-list > li")).toHaveCount(6);
  await expect(page.locator("ul.diagram-text")).toBeVisible();
  await expect(page.locator("ul.diagram-text > li").first()).toContainText("vestra CLI → Application workflows");
  // The capability matrix stacks into cards: no column header on screen, and
  // every cell names its column.
  const headerHeight = await page
    .locator(".works-today__table thead")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(headerHeight).toBeLessThanOrEqual(1);
  const evidenceCell = page.locator(".works-today__table td[data-label=Evidence]").first();
  await expect(evidenceCell).toBeVisible();
  await expect(evidenceCell).toHaveCSS("display", "block");
  const menu = page.locator("details.mobile-nav > summary");
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link")).toHaveCount(4);
});

test("theme selection persists across product and documentation surfaces", async ({ page }) => {
  await page.goto("");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("docs/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("documentation pages share the product chrome and render one heading", async ({ page }) => {
  await page.goto("docs/");
  const productNav = page.getByRole("navigation", { name: "Product navigation" });
  await expect(productNav.getByRole("link")).toHaveText(["Docs", "Roadmap", "Community"]);
  await expect(productNav.getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
  await expect(productNav.getByRole("link", { name: "Roadmap" })).not.toHaveAttribute("aria-current", "page");
  const undersized = await productNav
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => link.getBoundingClientRect()).filter((box) => box.width < 44 || box.height < 44)
    );
  expect(undersized).toEqual([]);

  const footerNav = page.getByRole("navigation", { name: "Footer navigation" });
  await expect(footerNav.getByRole("link")).toHaveText([
    "Documentation",
    "Agent guide",
    "LLM summary",
    "Discussions",
    "Issues"
  ]);
  await expect(footerNav.getByRole("link", { name: "LLM summary" })).toHaveAttribute("href", "/verchestra/llms.txt");
  await expect(page.locator(".product-footer__wordmark")).toHaveAttribute("href", "/verchestra/");

  await page.goto("roadmap/");
  await expect(productNav.getByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");
  await expect(productNav.getByRole("link", { name: "Docs" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator("h1")).toHaveCount(1);

  await page.goto("docs/architecture/system-overview/");
  await expect(page.locator("h1")).toHaveCount(1);
});

test("the mobile documentation menu lists the product navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("docs/");
  await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  const links = page.locator(".product-links a");
  await expect(links).toHaveText(["Docs", "Roadmap", "Community"]);
  await expect(links.first()).toHaveAttribute("aria-current", "page");
  for (const link of await links.all()) {
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box && box.height >= 44 && box.width >= 44, "menu link is at least 44 by 44").toBe(true);
  }
});

// why: the dark page tokens are unlayered, so Starlight's layered light palette
// never applied: a light documentation page kept the dark page background.
test("light documentation pages have a white page and no Axe violations", async ({ page }) => {
  for (const path of ["docs/", "roadmap/"]) {
    await page.goto(path);
    await page.evaluate(() => {
      localStorage.setItem("starlight-theme", "light");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${path} in light: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }
});

test("keyboard users can skip to content and open documentation search", async ({ page }) => {
  await page.goto("");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/u);

  await page.goto("docs/");
  const searchButton = page.getByRole("button", { name: "Search" });
  await expect(searchButton).toBeEnabled();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByPlaceholder("Search");
  await search.fill("SAP ASE");
  await expect(dialog.getByRole("link", { name: "SAP ASE and Sybase" }).first()).toBeVisible();
});

// why: axe 4.14's label-content-name-mismatch (WCAG 2.5.3). The accessible name
// must contain the shortcut the button shows, whichever platform key it shows.
test("the documentation search button's name contains the shortcut it shows", async ({ page }) => {
  await page.goto("docs/");
  const searchButton = page.locator("button[data-open-modal]");
  const hint = searchButton.locator(":scope > kbd");
  await expect(hint).toBeVisible();
  const keys = (await hint.locator("kbd").allTextContents()).map((key) => key.trim());
  expect(keys.length).toBeGreaterThan(1);
  await expect(searchButton).toHaveAccessibleName(`Search ${keys.join(" ")}`);
});

test("deep routes, roadmap links, community calls to action, and recovery resolve under the base path", async ({
  page
}) => {
  await page.goto("docs/workflows/cross-environment-handoff/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cross-environment handoff");

  await page.goto("roadmap/");
  // The qualification-range badge renders in a responsive large/small pair; the
  // hidden variant is first in the DOM, so target the visible T77 text directly
  // rather than whichever variant happens to come first.
  await expect(page.getByText(/T77/u).and(page.locator(":visible")).first()).toBeVisible();

  await page.goto("community/");
  await expect(page.getByRole("link", { name: /Join GitHub Discussions/u })).toHaveAttribute(
    "href",
    "https://github.com/accd/verchestra/discussions"
  );
  await expect(page.getByRole("link", { name: /Read the guide/u })).toHaveAttribute(
    "href",
    "/verchestra/docs/community/contributing/"
  );
  await expect(page.getByRole("link", { name: /Open the agent guide/u })).toHaveAttribute(
    "href",
    "/verchestra/docs/community/contributing-with-agents/"
  );

  await page.goto("docs/community/contributing-with-agents/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contributing with coding agents");
  await expect(page.getByRole("link", { name: /Concise llms\.txt/u })).toHaveAttribute(
    "href",
    "https://accd.github.io/verchestra/llms.txt"
  );

  await page.goto("404.html");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This delivery path does not exist.");
});

test("reduced motion disables decorative transitions and Mermaid renders without replacing its text equivalent", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("");
  for (const selector of [".button--primary", ".text-link", ".site-nav a"]) {
    const durations = await page
      .locator(selector)
      .first()
      .evaluate((element) =>
        getComputedStyle(element)
          .transitionDuration.split(",")
          .map((duration) => Number.parseFloat(duration))
      );
    expect(durations.every((duration) => duration === 0)).toBe(true);
  }
  const primaryButton = page.locator(".button--primary").first();
  await primaryButton.hover();
  await expect(primaryButton).toHaveCSS("transform", "none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  const authoredDuration = await page
    .locator(".button--primary")
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(authoredDuration).toBeGreaterThan(0);

  await page.goto("docs/architecture/system-overview/");
  const diagram = page.locator(".mermaid-diagram");
  await expect(diagram).toHaveAttribute("role", "img");
  await expect(diagram.locator("svg")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  const darkDiagram = await diagram.innerHTML();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await expect.poll(() => diagram.innerHTML()).not.toBe(darkDiagram);
  expect((await diagram.innerHTML()).toLowerCase()).toContain("#ffffff");
});

test("product touch targets meet the 44 by 44 CSS pixel contract", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  const undersized = await page.locator("a:visible, button:visible, summary:visible").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const box = element.getBoundingClientRect();
      return box.width < 44 || box.height < 44
        ? [
            {
              label: element.getAttribute("aria-label") ?? element.textContent?.trim(),
              width: box.width,
              height: box.height
            }
          ]
        : [];
    })
  );
  expect(undersized).toEqual([]);
});

test("the landing page makes no external font, analytics, or runtime API requests", async ({ page }) => {
  const external = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) external.add(url.origin);
  });
  await page.goto("");
  await page.waitForLoadState("networkidle");
  expect([...external]).toEqual([]);
});

test("public surfaces fit the required viewport matrix in both themes", async ({ page }) => {
  const surfaces = ["", "community/", "roadmap/", "docs/", "404.html"];
  const viewports = [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const theme of ["dark", "light"] as const) {
      for (const path of surfaces) {
        await page.goto(path);
        await page.evaluate((selectedTheme) => {
          localStorage.setItem("starlight-theme", selectedTheme);
        }, theme);
        await page.reload();

        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const overflow = await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `${path || "landing"} at ${viewport.width}px in ${theme} theme`).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("representative public surfaces have no Axe violations", async ({ page }) => {
  for (const path of ["", "community/", "roadmap/", "docs/", "404.html"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${path || "landing"}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }
});
