# Init Probe Scaffold Validation

Author validation on `feat/234-init-probe-scaffold`. No independent verifier
has reviewed it yet, and none is claimed.

| Requirement | Evidence (file:line — assertion) | Result |
| --- | --- | --- |
| IPS-01 | `tests/unit/probe-scaffold.test.mjs:43`: exactly the eight engines. `tests/contract/cli-surface.test.mjs:113` and `:118`: the manifest values equal `PROBE_SCAFFOLD_ENGINES` and `PROBE_SCAFFOLD_LANGUAGES`. `tests/e2e/init-probe-scaffold-e2e.test.mjs:117`: an unsupported engine or language exits 2. | PASS |
| IPS-02 | `tests/unit/probe-scaffold.test.mjs:53`–`:60`: two generations are byte-equal and match the pinned contract 1 digest, per engine. `:63`–`:78`: sorted keys, one trailing LF, no CR, ASCII only, no trailing whitespace, no product version, no date. `:85`: a different directory yields identical bytes. | PASS |
| IPS-03 | `tests/unit/probe-scaffold.test.mjs:110`–`:132`: accepted and refused directories, including traversal, uppercase, a leading dot, depth, other roots, backslashes, and a reserved name. `tests/e2e/init-probe-scaffold-e2e.test.mjs:105`–`:121`: every refusal exits 2 with the named argument and writes nothing, including a probe option without `--probe-engine`. | PASS |
| IPS-04 | `tests/integration/safe-init-probe-scaffold.test.mjs:40` and `:44`: the preview lists every file as a create and writes zero bytes. `:56`: applied bytes equal the generator's. `:60`: the ownership manifest records each file as tracked with a digest. `:82`–`:84`: a repeat is a no-op. `:95`–`:99`: a filled-in connection is `VES_INIT_TARGET_CONFLICT` and nothing changes. `tests/e2e/init-probe-scaffold-e2e.test.mjs:64`, `:77`, `:86`–`:87`: the same through the binary. | PASS |
| IPS-05 | `tests/contract/probe-scaffold-typecheck.test.mjs:119`–`:122`: each copied type is identical to the published one (36 identity checks across eight engines). `:125`–`:135`: making one copied field optional fails the identity check with TS2344. | PASS |
| IPS-06 | `tests/unit/probe-scaffold.test.mjs:92`–`:97`: every connection names driver candidates in a `TODO(driver)` comment and exports `VES_PROBE_DRIVER_TODO`. `tests/contract/probe-scaffold-kit.test.mjs:149`: the thrown error carries that code and the method name. | PASS |
| IPS-07 | `tests/contract/probe-scaffold-kit.test.mjs:160`: a conforming published fixture passes. `:177`: the kit's session calls equal the published adapter's. `:180`–`:191` and `:194`–`:204`: a principal or session the adapter rejects fails the kit before any row streams, and the connection is released. `:211`, `:215`, `:222`, `:227`: identity, row shape, row limit, and product each fail with their own code. `:266`: a pass against the published `node:sqlite` connection on a real file. | PASS |
| IPS-08 | `tests/contract/probe-scaffold-kit.test.mjs:149`: the in-process kit run fails with `VES_PROBE_DRIVER_TODO`. `:242`–`:245`: `node --test` on the generated file exits 1 with that code, per engine. `tests/e2e/init-probe-scaffold-e2e.test.mjs:99`–`:101`: the same in a workspace initialized by the binary. | PASS |
| IPS-09 | `tests/contract/probe-scaffold-typecheck.test.mjs:121`–`:122`: `tsc` under the repository's strictness with NodeNext resolution reports nothing. `:151`: the ESLint sensor proves the rules run on `.mts`. `:162`: no finding. `:176`: every file is in Prettier format. | PASS |
| IPS-10 | `tests/unit/probe-scaffold.test.mjs:101` and `:106`: no manifest or lockfile is emitted, and generated imports are only sibling `.mts` files and `node:` built-ins. `tests/integration/safe-init-probe-scaffold.test.mjs:72` and `tests/e2e/init-probe-scaffold-e2e.test.mjs:81`: the team's `package.json` is byte-identical after apply. | PASS |
| IPS-11 | `tests/unit/probe-scaffold.test.mjs:152`–`:168`: the generator's only imports are `@verchestra/domain`, the scanner error, and its templates, and it names no `Date`, `process`, random source, or dynamic import. | PASS |
| IPS-12 | `tests/contract/cli-surface.test.mjs:111`: option names and values. `:79`: the full init option list. `pnpm test:architecture`: the doctor read-only closure and secret-composition closure guards still pass with the new code. | PASS |

## Discrimination sensor

Each mutant was applied to the committed source, run against the six suites
above (`probe-scaffold`, `probe-scaffold-kit`, `probe-scaffold-typecheck`,
`cli-surface`, `safe-init-probe-scaffold`, `init-probe-scaffold-e2e`; baseline
155 pass), and restored from Git.

| Mutant | Failing tests |
| --- | --- |
| M1 PostgreSQL kit accepts any `transaction_read_only` read-back | 2 |
| M2 generated `inspectPrincipal` returns instead of throwing `TODO(driver)` | 33 |
| M3 MariaDB kit binds milliseconds instead of seconds | 2 |
| M4 generator stamps a timestamp into the header | 20 |
| M5 CLI manifest drops `mongodb` | 2 |
| M6 CLI skips `--probe-dir` validation | 2 |
| M7 kit skips the database identity check | 16 |
| M8 kit does not release the connection on failure | 16 |
| M9 copied PostgreSQL contract drops a field | 3 |
