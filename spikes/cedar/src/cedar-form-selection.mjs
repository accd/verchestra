export function selectCedarReleaseForm(candidates) {
  const selected = candidates.find((candidate) =>
    candidate.official === true &&
    candidate.exactVersion === true &&
    candidate.hermetic === true &&
    candidate.platformMatrix === true &&
    candidate.differential === true
  );
  if (selected) return selected;
  const error = new Error("no Cedar execution form satisfies the release qualification contract");
  error.code = "VES_CEDAR_FORM_UNQUALIFIED";
  throw error;
}
