import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHermeticDistributionBundle,
  verifyHermeticDistributionBundle
} from "../../packages/distribution/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { bundleInput, components, releaseId, sha } from "../helpers/hermetic-bundle-fixture.mjs";

const rejects = (input, code = "VES_DISTRIBUTION_INPUT_INVALID") =>
  assert.throws(() => buildHermeticDistributionBundle(input), { code });

test("mixed release component is rejected", () => {
  const values = components();
  values[1].releaseId = "release:other:1.0.0:win32-x64";
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_RELEASE_MIXED");
});

for (const [field, value] of [
  ["platform", "linux"],
  ["arch", "arm64"]
]) {
  test(`wrong target ${field} is rejected`, () => {
    const values = components();
    values[0][field] = value;
    rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_PLATFORM_MISMATCH");
  });
}

test("unlicensed executable component is rejected", () => {
  const values = components();
  values[0].licenseRefs = [];
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_LICENSE_MISSING");
});

test("unattested code component is rejected", () => {
  const values = components();
  values[1].attestationRefs = [];
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_ATTESTATION_MISSING");
});

for (const field of ["componentId", "logicalPath"]) {
  test(`duplicate ${field} is rejected`, () => {
    const values = components();
    values[1][field] = values[0][field];
    rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_DUPLICATE_COMPONENT");
  });
}

for (const unsafe of ["../escape", "/absolute", "C:/machine/path", "a\\b", ".", "CON", "components//double"]) {
  test(`unsafe bundle path is rejected: ${unsafe}`, () => {
    const values = components();
    values[1].logicalPath = unsafe;
    rejects(bundleInput({ components: values }));
  });
}

for (const [field, value] of [
  ["contentDigest", "sha256:bad"],
  ["sizeBytes", 0],
  ["kind", "runtime-plugin"],
  ["platform", "windows"],
  ["arch", "amd64"]
]) {
  test(`invalid component ${field} is rejected`, () => {
    const values = components();
    values[1][field] = value;
    rejects(bundleInput({ components: values }));
  });
}

test("runtime resolver request is rejected", () => rejects(bundleInput({ runtimeResolver: true })));
test("unknown download URL authority is rejected", () =>
  rejects({ ...bundleInput(), registryUrl: "https://registry" }));
test("credential field is rejected", () => rejects({ ...bundleInput(), signingToken: "secret" }));

test("license reference must resolve to a license component", () => {
  const values = components();
  values[1].licenseRefs = ["license:missing"];
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_LICENSE_MISSING");
});

test("attestation reference must resolve to provenance or evaluation", () => {
  const values = components();
  values[1].attestationRefs = ["sbom:cyclonedx"];
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_ATTESTATION_MISSING");
});

test("zero-version runtime or range-like runtime is rejected", () => {
  rejects(bundleInput({ target: { platform: "win32", arch: "x64", nodeVersion: ">=24" } }));
});

test("forged release digest fails semantic verification", () => {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  assert.throws(() => verifyHermeticDistributionBundle({ ...bundle, releaseDigest: sha("forged") }), {
    code: "VES_DISTRIBUTION_BUNDLE_INVALID"
  });
});

test("release identity is byte-identical across locales with a Unicode canonical member", () => {
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  const materialFor = (locale) => {
    process.env.LANG = locale;
    process.env.LC_ALL = locale;
    const bundle = buildHermeticDistributionBundle(bundleInput());
    // The release schema intentionally restricts identity names to portable ASCII. The
    // canonical identity envelope still exercises a Unicode member name at the encoder boundary.
    const bytes = canonicalizeJsonV2({ é: "unicode-member", manifest: bundle });
    return { bytes, releaseDigest: bundle.releaseDigest };
  };
  try {
    const first = materialFor("en_US.UTF-8");
    const second = materialFor("fr_FR.UTF-8");
    assert.equal(first.bytes, second.bytes);
    assert.equal(first.releaseDigest, second.releaseDigest);
    assert.match(first.bytes, /"é"/u);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

test("unknown component field cannot smuggle an install script", () => {
  const values = components();
  values[1].installScript = "curl example";
  rejects(bundleInput({ components: values }));
});

test("release identity must be exact on every component", () => {
  const values = components();
  values[1].releaseId = `${releaseId}:extra`;
  rejects(bundleInput({ components: values }), "VES_DISTRIBUTION_RELEASE_MIXED");
});
