# AEROL — astronaut watch + Earth research dashboard

**A watch that helps astronauts recognize changes, receive exposure alerts, and know when to get
checked — connected to research tools on Earth.**

NASA Space Apps Challenge prototype. Python (standard library) backend with SQLite, and a
dependency-free HTML/CSS/JavaScript front end. All devices are **simulated**: the proposed AEROL
wristband and a connected personal dosimeter. No real hardware is connected, no message reaches a
real person, and nothing here is a medical device or implies NASA endorsement.

## Run

```sh
python3 -m aerol            # Python 3.9+; no third-party packages
```

| URL | Experience |
|---|---|
| http://127.0.0.1:8000/ | **Astronaut watch** simulator |
| http://127.0.0.1:8000/dashboard/ | **Dashboard** — “View as” **crew member** (onboard, plain language, own data, no link delay) or **Earth physician & research team** (delayed ground view, review queues, research tools) |
| http://127.0.0.1:8000/mobile/ | Watch only (phone layout) |

Both experiences share one store and one simulation clock (synced across tabs), so the watch and
the dashboard never disagree. The ground view is deliberately delayed by simulated packets.

## Demo script for the video (≈3 minutes)

Drive these moments with the timeline bar (drag, ⏭ next event, ▶ play) and the watch:

1. **Watch status** — FD18, inside the magnetosphere; Home shows mission time, recovery estimate, status, top action.
2. **Mission progression** — the shared clock plays; it auto-pauses when a new alert fires.
3. **Exposure change** — belt transit then magnetosphere exit (explicit trajectory events); 0.7 → 1.84 mSv/day.
4. **Actionable watch alert** — what changed, the reading, threshold, status, one next action.
5. **Health-check workflow** — sustained resting-HR rise escalates to Caution during a simulated comm outage: record symptoms, begin follow-up, contact onboard crew medical support.
6. **Earth research review** — queued packets arrive; physicians review and message back; researchers inspect TERRA/WBC projections.
7. **Landing and recovery** — dose plateaus, R+0 WBC result (simulated lab) triggers a configured-change review, TERRA relaxes toward 1.0×.

More detail: [docs/DEMO.md](docs/DEMO.md).

## Self-care (gamified)

A **Self-care** screen on the watch and in the crew dashboard: six daily quests (wear the band, sleep
opportunity, exercise, check-in, hydration, wind-down), XP and levels, a streak (4 of 6 quests per
day), a 4-week heat map and badges. Points reward habits, never vitals; reporting symptoms always
earns points; nothing rewards ignoring an alert; no crew leaderboards. Days before you start using
the demo include clearly labeled simulated history so streaks are meaningful when jumping in time.

**Aerol Buddy.** A mission plant, your Aerol Buddy, is planted at launch and grows from completed quests (seed →
sprout → leaves → bud → bloom, ≈ two weeks of habits per flower); each bloom joins a personal
garden. A “Tend the garden” quest counts real plant care. The plant never wilts or dies: during a
health alert or while the band is offline it rests. Inspired by the zinnias grown in NASA’s Veggie
unit on the ISS (2016); not a NASA program.

## What is real, what is simulated

| Layer | Origin |
|---|---|
| NASA RadLab ISS DosTel1/2 absorbed dose rate (µGy/h, area monitors) | observed, bundled |
| Twins Study TERRA (subject TW, 11 samples, raw normalized abundance) | observed, bundled |
| Inspiration4 CBC (OSD-569, 4 crew, L-92…R+194, 10⁹/L) | observed, bundled |
| ISS immune study timing & findings (Crucian 2015, n=23) | published finding, qualitative only |
| “ISS (original)” WBC % from the team’s combined report | digitized_reference (±5 pp) |
| Watch vitals, dosimeter, lab draws, TERRA/WBC curves | **simulation** |
| Learned TERRA/WBC model | **unavailable** — insufficient matched data |

Sources, verification status and caveats: [docs/DATA.md](docs/DATA.md).

## Key design rules

- The watch never measures TERRA or WBC (laboratory assays). Radiation comes from a simulated personal dosimeter.
- Six canonical phases (`preflight | early_flight | mid_flight | late_flight | landing | after_return`) are separate from exposure regions (`ground | inside_magnetosphere | radiation_belt_transit | beyond_magnetosphere | unknown`) and from events.
- r(t) = dD/dt; dose is integrated over real elapsed time, split at transitions, and plateaus after landing.
- TERRA baseline: 1.0× = 0% change. Fold change = value ÷ matched personal baseline.
- Alerts: versioned rule registry, persistence windows, episode tracking/cooldowns, escalation on worsening; acknowledgment never resolves; a recovery score never suppresses an alert; missing data never shows “all clear”.
- No bone-density features.

Model and scoring: [docs/MODEL.md](docs/MODEL.md). Record contract (`aerol.terra.v1` etc.): [docs/SCHEMA.md](docs/SCHEMA.md). API: [docs/API.md](docs/API.md).

## Tests

```sh
python3 -m unittest discover -s tests -v     # API, schema parity, radiation integration (20 tests)
node --test tests/js/*.test.mjs              # JS core: phases, dose math, models, alerts, link, schema, self-care, garden (19 tests)
```

Rebuild the observed-data bundle after changing source files: `python3 scripts/build_research_data.py`
(every record is validated before writing). Regenerate validator fixtures: `node scripts/make_fixtures.mjs`.

## Layout

```
aerol/server.py            WSGI app: static routes, records API, radiation integration, legacy endpoints
aerol/schema.py            record validator (mirrors core/schema.js)
aerol/radiation.py         dose integration (mirrors core/radiation.js)
aerol/model_adapter.py     slot for a future trained model (learned mode)
aerol/static/core/         pure JS modules (schedule, radiation, models, vitals, rules, events, store, schema, research, export)
aerol/static/ui/           watch, transport, charts, dashboard views
aerol/static/data/         research.json (validated observed records)
aerol/data/                source files (RadLab raw export, snapshot, OSD-569 CBC CSV)
scripts/                   data build + fixture generation
tests/                     Python + Node tests, shared fixtures
```

Code is MIT licensed. Research data keep their providers’ terms and citations (see docs/DATA.md).
