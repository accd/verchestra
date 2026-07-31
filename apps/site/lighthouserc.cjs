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
      // Default is "optimistic" (best of N runs), which would let a single
      // good draw mask two bad ones. "median" requires the middle run to
      // clear the bar, so a real regression across most runs still fails.
      aggregationMethod: "median",
      assertions: {
        "categories:performance": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci"
    }
  }
};
