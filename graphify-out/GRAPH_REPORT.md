# Graph Report - Aerol  (2026-11-15)

## Corpus Check
- Corpus is ~49,707 words - fits in a single context window. You may not need a graph.

## Summary
- 564 nodes · 1715 edges · 17 communities (14 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.85)
- Token cost: 247,095 input · 0 output

## Community Hubs (Navigation)
- Events & Explanations
- Mission Schedule & Phases
- Python Backend & Radiation
- App Shell & API Docs
- Schema & Record Export
- Observed Research Adapters
- Chart Engine
- Shared Store & Clock
- Python Record Validator
- API Test Suite
- Old Desktop Preview
- Old Mobile Preview
- Learned Model Adapter
- Icon 192px
- SVG Icon
- Icon 512px
- Service Worker

## God Nodes (most connected - your core abstractions)
1. `isNum()` - 63 edges
2. `esc()` - 48 edges
3. `mountTimeline()` - 43 edges
4. `mountEarth()` - 43 edges
5. `missionLabel()` - 41 edges
6. `$$` - 38 edges
7. `fmt()` - 36 edges
8. `Store` - 28 edges
9. `iso()` - 23 edges
10. `TimeChart` - 23 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `validate_batch()`  [EXTRACTED]
  scripts/build_research_data.py → aerol/schema.py
- `watch-app route container` --implements--> `Astronaut Watch Simulator`  [INFERRED]
  aerol/static/index.html → README.md
- `earth-app route container` --implements--> `Earth Research Dashboard`  [INFERRED]
  aerol/static/index.html → README.md
- `Transport (mission timeline section)` --implements--> `Shared Simulation Clock`  [INFERRED]
  aerol/static/index.html → README.md
- `Six Canonical Mission Phases` --shares_data_with--> `Shared record fields (value_origin, mission_phase, exposure_region)`  [INFERRED]
  README.md → docs/SCHEMA.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AEROL versioned record schemas** — docs_schema_aerol_terra_v1, docs_schema_aerol_wbc_v1, docs_schema_aerol_radiation_v1, docs_schema_aerol_event_v1, docs_schema_shared_fields [EXTRACTED 1.00]
- **Bundled observed research datasets** — docs_data_nasa_radlab_dostel, docs_data_al_turki_2024, docs_data_osd_569_cbc, docs_data_noaa_sep_catalog [EXTRACTED 1.00]
- **Transparent temporal simulation pipeline** — docs_model_terra_simulator, docs_model_wbc_simulator, docs_model_stress_hypothesis, docs_model_radiation_arithmetic, docs_model_scenario_sensitivity_range [INFERRED 0.85]
- **Radiation exposure to TERRA response evidence flow** — desktop_preview_dostel2, desktop_preview_radiation_environment_chart, desktop_preview_molecular_response_chart, desktop_preview_terra, desktop_preview_exposure_terra_covariation [INFERRED 0.85]
- **Overview KPI Cards (radiation, TERRA, paired samples, crew)** — mobile_preview_station_dose_rate, mobile_preview_terra_reference, mobile_preview_paired_research_samples, mobile_preview_crew_measurements [EXTRACTED 1.00]

## Communities (17 total, 3 thin omitted)

### Community 0 - "Events & Explanations"
Cohesion: 0.06
Nodes (85): buildEvents(), curveExtrema(), dedupe(), EXPLAIN, lagInspector(), sampleExtrema(), valuesAround(), baselineOnly (+77 more)

### Community 1 - "Mission Schedule & Phases"
Cohesion: 0.07
Nodes (73): explainEvent(), dostelRecord(), SEVERITY_LABEL, DEFAULT_SCENARIO, missionLabel(), PHASE_LABEL, PRESETS, REGION_LABEL (+65 more)

### Community 2 - "Python Backend & Radiation"
Cohesion: 0.06
Nodes (39): main(), Server, ingest_readings(), integrate_pieces(), _num(), worked_checks(), add_reading(), api() (+31 more)

### Community 3 - "App Shell & API Docs"
Cohesion: 0.05
Nodes (52): AEROL index.html App Shell, earth-app route container, Transport (mission timeline section), /ui/main.js module entry, watch-app route container, AEROL_API_TOKEN bearer auth, GET /api/bootstrap (metric registry), POST /api/hrv (RMSSD) (+44 more)

### Community 4 - "Schema & Record Export"
Cohesion: 0.10
Nodes (42): EXTREMA_RULE, toEventRecords(), simulationRecords(), timing(), RULESET_VERSION, PHASES, DOSE_QUANTITIES, emptyEvent() (+34 more)

### Community 5 - "Observed Research Adapters"
Cohesion: 0.11
Nodes (34): rateSteps(), correlationsTable(), dateMid(), dostelCumulative(), dostelRows(), dostelSegments(), i4Wbc(), missionTimes() (+26 more)

### Community 6 - "Chart Engine"
Cohesion: 0.19
Nodes (10): makeNote(), isNum(), gridRange(), M, niceTicks(), sampleAt(), shape(), shorten() (+2 more)

### Community 7 - "Shared Store & Clock"
Cohesion: 0.17
Nodes (4): scenarioFromPreset(), validateScenario(), defaultState(), Store

### Community 8 - "Python Record Validator"
Cohesion: 0.22
Nodes (14): _iso(), _null_or(), _num(), _prediction(), _require(), _shared(), _ts(), validate_batch() (+6 more)

### Community 10 - "Old Desktop Preview"
Cohesion: 0.17
Nodes (13): Aerol Desktop Dashboard Preview, Your Connected Companion Watch Demo Panel, Crew Measurements (local profile, 22 supported fields), DosTel2 Station Detector (Historical ISS), KPI Stat Tile Row (dose rate, TERRA, paired samples, crew measurements), The Molecular Response Chart (Scott Kelly TERRA samples), The Radiation Environment Chart (DosTel2 daily absorbed dose rate), Scott Kelly Laboratory Sample Data (+5 more)

### Community 11 - "Old Mobile Preview"
Cohesion: 0.22
Nodes (13): Mobile Preview Screenshot (Overview Dashboard), Add Measurement Action, Crew Measurements KPI (22 supported fields, local profile), DosTel2 Detector, Mission Health / Research Workspace, NASA Historical Reference (ISS Scott Kelly mission dates), Overview Dashboard - The bigger picture, Paired Research Samples KPI (seven-day comparison, >=80% coverage) (+5 more)

### Community 13 - "Icon 192px"
Cohesion: 0.50
Nodes (4): Aerol App Icon (192px), Aerol Brand Palette (dark teal, mint, amber, white), Aerol Orbital Logo Mark, PWA Manifest Icon

### Community 14 - "SVG Icon"
Cohesion: 0.67
Nodes (3): Aerol App Icon (orbit logo), Aerol Brand Palette (dark teal #163f43, mint #b8e2d0, amber #e8b876), Orbit / Planet Logo Motif

### Community 15 - "Icon 512px"
Cohesion: 1.00
Nodes (3): Aerol App Icon (512px), Aerol Brand Palette (dark teal background, mint ring, white orbit, amber dot), Aerol Orbit Logo Mark (planet ring with orbiting satellite)

## Knowledge Gaps
- **22 isolated node(s):** `Simulated Devices (wristband + personal dosimeter)`, `/ui/main.js module entry`, `GET /api/bootstrap (metric registry)`, `/api/tasks follow-up tasks`, `SQLite store (local-data/aerol.sqlite3, AEROL_DB)` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 107 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `isNum()` connect `Chart Engine` to `Events & Explanations`, `Mission Schedule & Phases`, `Schema & Record Export`, `Observed Research Adapters`, `Shared Store & Clock`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `isNum()` (e.g. with `computeModel()` and `mean()`) actually correct?**
  _`isNum()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Simulated Devices (wristband + personal dosimeter)`, `/ui/main.js module entry`, `GET /api/bootstrap (metric registry)` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Events & Explanations` be split into smaller, more focused modules?**
  _Cohesion score 0.05730059013896821 - nodes in this community are weakly interconnected._
- **Why does `Store` connect `Shared Store & Clock` to `Events & Explanations`, `Mission Schedule & Phases`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `mountTimeline()` (e.g. with `.add()` and `.focus()`) actually correct?**
  _`mountTimeline()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `Mission Schedule & Phases` be split into smaller, more focused modules?**
  _Cohesion score 0.07106293285155074 - nodes in this community are weakly interconnected._