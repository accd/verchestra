# Architecture deepening, second round: tasks

One task per pull request unless a task names more. The coordinator owns this
file. Each task records its evidence in `validation-t<n>.md`. The waves run two
tasks at a time on disjoint files.

| Task | Requirement | Review card      | Wave | Depends on | Status                                                                      |
| ---- | ----------- | ---------------- | ---- | ---------- | --------------------------------------------------------------------------- |
| T1   | ADR2-1      | 2                | 1    | —          | Done (#485 security fix, AD-057; #486, AD-058)                              |
| T2   | ADR2-2      | 3                | 1    | —          | Done (#488, AD-059; #489)                                                   |
| T3   | ADR2-3      | 4                | 2    | —          | Done (#498, AD-060; follow-up #500, AD-065)                                 |
| T8   | ADR2-8      | 9                | 2    | —          | Done (#487)                                                                 |
| T6   | ADR2-6      | 7                | 3    | T3         | Part 1 done (#504, AD-063); part 2 not merged (#505 closed, owner decision) |
| T7   | ADR2-7      | 8, residue of C6 | 3    | —          | Done (#501, AD-062; #502; #503)                                             |
| T4   | ADR2-4      | 5                | 4    | T1         | Done (#506, AD-066)                                                         |
| T9   | ADR2-9      | residue of C2    | 4    | —          | Done (#499, AD-061)                                                         |
| T5   | ADR2-5      | 6                | 5    | —          | Done (#507, AD-067)                                                         |
| T10  | ADR2-10     | residue of C8    | 5    | —          | Done (#496)                                                                 |
| T11  | ADR2-11     | residue of C7    | 5    | —          | Done (#497)                                                                 |
