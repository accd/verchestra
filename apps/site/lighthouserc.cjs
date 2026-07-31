module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm preview --host 127.0.0.1 --port 4323",
      startServerReadyPattern: "Local",
      startServerReadyTimeout: 120000,
      url: ["http://127.0.0.1:4323/verchestra/"],
      // A single Lighthouse run treats one CPU-contention blip on the shared
      // CI runner as the site's performance budget (issue #110: PR #108
      // scored 0.92 against no site-code change, then three separate CI
      // samples of the same code all scored a perfect 1). Three runs plus
      // median aggregation below absorbs one bad draw without hiding a
      // regression that would depress two or more of the three.
      numberOfRuns: 3,
      settings: {
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage",
        preset: "desktop",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"]
      }
    },
    assert: {
      // No top-level default: lhci's own default ("optimistic") resolves to
      // Math.max across runs for a minScore assertion, which is MORE lenient
      // than "median" (PR #139 review point 1). Every assertion below sets
      // its aggregationMethod explicitly so nothing silently inherits a
      // default neither this file nor the review chose.
      assertions: {
        // "median" deliberately tolerates one bad draw in three — the whole
        // point of issue #110's fix. Every other assertion below stays as
        // strict as the pre-change numberOfRuns: 1 baseline: "pessimistic"
        // fails on any single bad run (Math.min for minScore, Math.max for
        // maxNumericValue), so a real regression in accessibility, SEO, LCP,
        // or CLS can't hide behind two clean runs.
        "categories:performance": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 1, aggregationMethod: "pessimistic" }],
        "categories:best-practices": ["error", { minScore: 1, aggregationMethod: "pessimistic" }],
        "categories:seo": ["error", { minScore: 1, aggregationMethod: "pessimistic" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "pessimistic" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "pessimistic" }]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci"
    }
  }
};
