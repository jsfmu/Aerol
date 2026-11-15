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
| http://127.0.0.1:8000/ | **Astronaut watch** simulator + demo walkthrough |
| http://127.0.0.1:8000/earth/ | **Earth research dashboard** (physicians & researchers) |
| http://127.0.0.1:8000/mobile/ | Watch only (phone layout) |

Both experiences share one store and one simulation clock (synced across tabs), so the watch and
the dashboard never disagree. The ground view is deliberately delayed by simulated packets.

## Demo walkthrough (≈3 minutes)

Use the **Demo walkthrough** panel on the watch page:

1. **Watch status** — FD18, inside the magnetosphere; Home shows mission time, recovery estimate, status, top action.
2. **Mission progression** — the shared clock plays; it auto-pauses when a new alert fires.
3. **Exposure change** — belt transit then magnetosphere exit (explicit trajectory events); 0.7 → 1.84 mSv/day.
4. **Actionable watch alert** — what changed, the reading, threshold, status, one next action.
5. **Health-check workflow** — sustained resting-HR rise escalates to Caution during a simulated comm outage: record symptoms, begin follow-up, contact onboard crew medical support.
6. **Earth research review** — queued packets arrive; physicians review and message back; researchers inspect TERRA/WBC projections.
7. **Landing and recovery** — dose plateaus, R+0 WBC result (simulated lab) triggers a configured-change review, TERRA relaxes toward 1.0×.

More detail: [docs/DEMO.md](docs/DEMO.md).

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
node --test tests/js/*.test.mjs              # JS core: phases, dose math, models, alerts, link, schema (16 tests)
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
aerol/static/ui/           watch, transport, charts, Earth dashboard views
aerol/static/data/         research.json (validated observed records)
aerol/data/                source files (RadLab raw export, snapshot, OSD-569 CBC CSV)
scripts/                   data build + fixture generation
tests/                     Python + Node tests, shared fixtures
```

Code is MIT licensed. Research data keep their providers’ terms and citations (see docs/DATA.md).
