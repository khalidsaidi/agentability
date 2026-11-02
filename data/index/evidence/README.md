# Evidence for the published error rates

Every number in ../validation.json and on /methodology/ comes from a file here,
so a figure can be checked against the thing it was computed from rather than
taken on description.

| file | what it is |
|---|---|
| `kept-census-2026-11-02.tsv` | All 189 drawn domains with the title and description read for each. The kept-side rate is one error (netkeiba.com) in the 153 that could be read. |
| `kept-census-walls.tsv` | The domains the census could not read, each cross-checked against our own stored audit. 36 corroborated, 9 overturned because our auditor had read them. The far edge counts the 36 as wrong keeps. |
| `kept-census-archive.tsv` | The archive pass: for each of the 36 domains no live fetch could read, the closest Internet Archive snapshot. 25 resolved, 11 did not and are what the far edge is made of. |
| `probe-final-rule.txt` | `npm run probe-filter`, seed 2026, pool e15d222a8342. Prints the rule for "unreadable" at the top. |
| `probe-live-1337.txt` | Same, seed 1337. |
| `probe-live-5150.txt` | Same, seed 5150. |
| `probe-withdrawn-census357.txt` | `POOL=withdrawn DRAW=999 npm run probe-filter` — a full census of all 357 removed domains. The premise test: 74 unreadable (20.7%) against 36 of 189 (19.0%) on the kept side, +1.7pp, 95% CI -5.3 to +8.7, Fisher p = 0.737. The premise is not supported. |
| `probe-withdrawn-sample66.txt` | The earlier 66-domain version of that control (13.6%). Superseded by the census above and kept so the change is visible. |

A wall cannot be hand-read; that is what makes it a wall. The far edge therefore
counts every corroborated wall as a wrong keep, which is the most conservative
treatment available, rather than claiming a hand verdict on a page nobody could
retrieve.
