# Architecture deepening, second round: tasks

One task per pull request unless a task names more. The coordinator owns this
file. Each task records its evidence in `validation-t<n>.md`. The waves run two
tasks at a time on disjoint files.

| Task | Requirement | Review card | Wave | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | ADR2-1 | 2 | 1 | — | In progress |
| T2 | ADR2-2 | 3 | 1 | — | In progress |
| T3 | ADR2-3 | 4 | 2 | — | Planned |
| T8 | ADR2-8 | 9 | 2 | — | Planned |
| T6 | ADR2-6 | 7 | 3 | T3 | Planned |
| T7 | ADR2-7 | 8, residue of C6 | 3 | — | Planned |
| T4 | ADR2-4 | 5 | 4 | T1 | Planned |
| T9 | ADR2-9 | residue of C2 | 4 | — | Planned |
| T5 | ADR2-5 | 6 | 5 | — | Planned |
| T10 | ADR2-10 | residue of C8 | 5 | — | Planned |
| T11 | ADR2-11 | residue of C7 | 5 | — | Planned |
