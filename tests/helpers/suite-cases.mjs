// why: a shared suite registers its cases through the `test` it is handed, so
// a file that only calls the suite shows no test of its own to a static
// reader (SonarCloud S2187). The file collects the cases instead and registers
// each one with its own `test`, under the same name, options and body.
export function suiteCases(suite, ...args) {
  const cases = [];
  suite(
    (...entry) => {
      cases.push(entry);
    },
    ...args
  );
  return cases;
}
