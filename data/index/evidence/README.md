# Evidence for the published error rates

Every number in ../validation.json and on /methodology/ comes from a file here,
so a figure can be checked against the thing it was computed from rather than
taken on description.

| file | what it is |
|---|---|
| `kept-census-2026-11-02.tsv` | All 189 drawn domains with the title and description read for each. The kept-side rate is one error (netkeiba.com) in the 153 that could be read. |
| `kept-census-walls.tsv` | The domains the census could not read, each cross-checked against our own stored audit. 36 corroborated, 9 overturned because our auditor had read them. The far edge counts the 36 as wrong keeps. |
| `probe-final-rule.txt` | `npm run probe-filter`, seed 2026, pool e15d222a8342. Prints the rule for "unreadable" at the top. |
| `probe-live-1337.txt` | Same, seed 1337. |
| `probe-live-5150.txt` | Same, seed 5150. |
| `probe-withdrawn.txt` | `POOL=withdrawn npm run probe-filter` — the readability control over removed domains, which is what showed the premise "filtered sites wall bots more" to be unproven (13.6% vs 6.9%, Fisher p = 0.189). |

A wall cannot be hand-read; that is what makes it a wall. The far edge therefore
counts every corroborated wall as a wrong keep, which is the most conservative
treatment available, rather than claiming a hand verdict on a page nobody could
retrieve.
