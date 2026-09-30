import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// why: #408 (O2). Any write collaborator can read a repository secret by pushing
// a branch workflow, so the signing keys live only as secrets of protected
// environments: a required reviewer approves each run, and only `main` deploys.
// These assertions cover every workflow file, not just the three signing ones,
// so a new job that names a signing secret outside its environment fails here.

const WORKFLOWS = new URL("../../.github/workflows/", import.meta.url);

// invariant: each signing secret belongs to exactly one protected environment.
const SIGNING_SECRETS = Object.freeze({
  VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64: "tuf-release-signing",
  VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64: "tuf-release-signing",
  VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64: "t75-evidence-signing"
});

// why: the repository-level names held the keys retired by #408. A job bound to
// an environment would silently fall back to a repository secret of the same
// name, so no workflow may name them at all, in any job.
const RETIRED_REPOSITORY_SECRETS = Object.freeze([
  "VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64",
  "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64",
  "VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64"
]);

// invariant: the only jobs that may bind a signing environment, and exactly the
// signing secrets each one reads.
const SIGNING_JOBS = Object.freeze({
  "t76-publish-release.yml#publish": {
    environment: "tuf-release-signing",
    secrets: ["VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64", "VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64"]
  },
  "t76-refresh-timestamp.yml#refresh": {
    environment: "tuf-release-signing",
    secrets: ["VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64"]
  },
  "t75-evidence-signing.yml#attest": {
    environment: "t75-evidence-signing",
    secrets: ["VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64"]
  }
});

const SIGNING_ENVIRONMENTS = new Set(Object.values(SIGNING_SECRETS));

const workflowFiles = () =>
  readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(new URL(name, WORKFLOWS), "utf8") }));

// why: no YAML dependency exists here. Every workflow in this repository indents
// with two spaces, so a job is a two-space key under the top-level `jobs:` block.
const jobsOf = ({ name, text }) => {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === "jobs:");
  assert.ok(start >= 0, `${name} declares jobs`);
  const jobs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (header !== null) jobs.push({ id: `${name}#${header[1]}`, lines: [] });
    else if (jobs.length > 0) jobs.at(-1).lines.push(line);
  }
  return jobs.map(({ id, lines: body }) => {
    const text = body.join("\n");
    const environment =
      /^ {4}environment: ([A-Za-z0-9_-]+)\s*$/mu.exec(text)?.[1] ??
      /^ {4}environment:\s*\n {6}name: ([A-Za-z0-9_-]+)\s*$/mu.exec(text)?.[1] ??
      null;
    const secrets = [...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/gu)].map(([, secret]) => secret))].sort();
    return { id, environment, secrets, text };
  });
};

const allJobs = () => workflowFiles().flatMap(jobsOf);

test("the job parser sees every job the signing workflows declare", () => {
  const ids = allJobs().map(({ id }) => id);
  for (const id of Object.keys(SIGNING_JOBS)) assert.ok(ids.includes(id), `${id} is parsed`);
  // why: a parser that saw nothing would make every assertion below vacuous.
  assert.ok(ids.length >= 10, "every workflow's jobs are parsed");
});

test("each signing job binds its protected environment and reads exactly its own signing secrets", () => {
  const jobs = new Map(allJobs().map((job) => [job.id, job]));
  for (const [id, expected] of Object.entries(SIGNING_JOBS)) {
    const job = jobs.get(id);
    assert.equal(job.environment, expected.environment, `${id} binds ${expected.environment}`);
    assert.deepEqual(
      job.secrets.filter((secret) => Object.hasOwn(SIGNING_SECRETS, secret)),
      [...expected.secrets].sort(),
      `${id} reads exactly its own signing secrets`
    );
  }
});

test("no signing secret is read outside a job bound to its own environment", () => {
  for (const job of allJobs())
    for (const secret of job.secrets.filter((name) => Object.hasOwn(SIGNING_SECRETS, name)))
      assert.equal(
        job.environment,
        SIGNING_SECRETS[secret],
        `${job.id} reads ${secret} outside the ${SIGNING_SECRETS[secret]} environment`
      );
});

test("only the declared signing jobs may bind a signing environment", () => {
  for (const job of allJobs())
    if (SIGNING_ENVIRONMENTS.has(job.environment))
      assert.ok(Object.hasOwn(SIGNING_JOBS, job.id), `${job.id} binds ${job.environment} but is not a signing job`);
});

test("no workflow names a retired repository-level signing secret", () => {
  for (const { name, text } of workflowFiles()) {
    for (const secret of RETIRED_REPOSITORY_SECRETS)
      assert.equal(text.includes(`secrets.${secret}`), false, `${name} reads the retired repository secret ${secret}`);
    // why: the retired names share this suffix; the environment names do not.
    assert.doesNotMatch(text, /secrets\.[A-Za-z0-9_]*SIGNING_KEY_PKCS8_BASE64/u, name);
  }
});

test("no workflow hands its whole secret context to anything", () => {
  // hazard: each of these would expose every secret the job can see, including an
  // environment's signing keys, to code the shape tests above do not read.
  for (const { name, text } of workflowFiles()) {
    assert.doesNotMatch(text, /secrets: inherit/u, name);
    assert.doesNotMatch(text, /toJSON\(\s*secrets\s*\)/iu, name);
    assert.doesNotMatch(text, /secrets\[/u, name);
  }
});
