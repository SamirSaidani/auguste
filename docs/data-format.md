# Data format

Auguste keeps every run on the device. Runs leave the device only when the
user asks: download, share, or the optional repository sync. Each way uses one of
the formats below, so scripts and AI agents can read results without parsing the
screen.

## Run (JSON)

Written by the repository sync to `runs/YYYY/MM/DD/<timestamp>-<exercise>.json`
(UTC date), and found in the `history` array of a full backup.

| Field | Type | Meaning |
|---|---|---|
| `format` | number | Format version, currently 1 (sync files only) |
| `app` | string | `auguste` (`rhythm-trainer` in files from earlier versions; sync files only) |
| `date` | string | ISO 8601 UTC time the run ended |
| `id` | string | Exercise id, for example `diag-1` or an imported lesson id |
| `title` | string | Exercise title |
| `lines` | string | `all`, or the practised line numbers, for example `1,3` |
| `bpm` | number | Target tempo |
| `metro` | string | `all` every beat, `first` first beat, `fade` stops after 2 bars, `countin` count-in only |
| `guide` | boolean | The rhythm was played along |
| `percent` | number | (good + half of approx) / notes, 0 to 100 |
| `passed` | boolean | percent ≥ 90, no lost bar, extras ≤ 5 %, and in `countin` mode tempo within ±5 % |
| `counts` | object | `good`, `approx`, `off`, `missed`, `extra` |
| `offsetMs` | number | Median clap error in ms, negative = early |
| `tempo` | number | Tempo actually held (linear fit of the claps), or null |
| `driftPct` | number | Second-half tempo against first-half tempo, in %, or null |
| `lost` | number | Bars where at least half the notes are off or missed |
| `bars` | string | One letter per note, bars separated by spaces: `G` good, `a` approx, `x` off, `.` missed, `+n` extra claps in the bar |
| `sens` | number | Clap sensitivity setting, 1 to 10 |
| `report` | string | The same run as a text report (sync files only) |

Grading windows, in fractions of a sixteenth note at the run's tempo: good
within 30 % (at least 50 ms), approx within 50 % (at least 80 ms). A steady lead
or lag up to 40 ms is compensated before grading.

## Text report

Downloaded as `auguste-reports-YYYY-MM-DD.txt`, one block per run,
blocks separated by a blank line. The time is local.

```
RT1 | 2026-11-25 21:04 | diag-3 | lines all | 60 bpm | metro all | guide off
score 84% FAIL | good 25 | approx 4 | off 1 | missed 2 | extra 1 | offset -35ms | tempo 58.9 | drift -2.1% | lost 0 | sens 5
bars GGGGGG GaGG.GGG+1 GGGGGGGG GGxGGGGG
```

## Full backup

`auguste-backup-YYYY-MM-DD.json`:
`{"app": "auguste", "format": 1, "exported": "<ISO date>", "history": [runs], "lessons": [{"text": "<lesson source>"}]}`.
Restoring merges runs by `date` + `id`, so a backup can be restored twice safely.

## Repository sync

Settings: the repository's web address and an API key (access token).
`https://github.com/<owner>/<name>` selects GitHub; any other `https://<host>/<owner>/<name>`
is treated as Gitea or Forgejo, with its API at `https://<host>/api/v1`. When the
repository does not exist and belongs to the key's owner, the app creates it, private.
Prefer a key limited to that repository (GitHub fine-grained token, or the token of a
bot account that can only write there). The server must allow the app's origin through
CORS (Gitea: `[cors]` section of `app.ini`).

A setup link fills the settings in one step:
`<app URL>#sync=<base64url of {"kind","api","repo","token"}>`.
The app stores it and removes it from the address bar.
`scripts/setup-gitea-sync.py` creates the repository, a bot account limited to
it, the bot's token and this link.
