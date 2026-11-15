# Graph Report - Aerol  (2026-11-15)

## Corpus Check
- Corpus is ~6,607 words - fits in a single context window. You may not need a graph.

## Summary
- 176 nodes · 303 edges · 14 communities (8 shown, 6 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.85)
- Token cost: 226,342 input · 0 output

## Community Hubs (Navigation)
- Docs, API & Views
- Frontend app.js
- WSGI Server & API
- API Test Suite
- Desktop Radiation/TERRA Dashboard
- CLI Entry Point
- Mobile Overview Screen
- Model Adapter Contract
- Icon 192px
- Icon 512px
- SVG Icon
- Service Worker
- Crew Measurements Card

## God Nodes (most connected - your core abstractions)
1. `APITests` - 15 edges
2. `APIError` - 13 edges
3. `api()` - 13 edges
4. `overview()` - 13 edges
5. `render()` - 10 edges
6. `AEROL Team Starter` - 10 edges
7. `add_reading()` - 9 edges
8. `application()` - 9 edges
9. `panelHeading()` - 9 edges
10. `AEROL API reference` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Interactive ISS Radiation Timeline` --shares_data_with--> `NASA RadLab DosTel1/DosTel2 ISS data`  [INFERRED]
  README.md → docs/DATA.md
- `Historical radiation filter bar (detector/date/timeline)` --shares_data_with--> `NASA RadLab DosTel1/DosTel2 ISS data`  [INFERRED]
  aerol/static/index.html → docs/DATA.md
- `/api/tasks follow-up tasks` --shares_data_with--> `Local SQLite follow-up log`  [INFERRED]
  docs/API.md → README.md
- `AEROL API reference` --references--> `AEROL_API_TOKEN authentication`  [EXTRACTED]
  docs/API.md → README.md
- `Add measurement dialog` --shares_data_with--> `/api/readings endpoint`  [INFERRED]
  aerol/static/index.html → docs/API.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Model prediction flow** — docs_api_api_predict, docs_api_api_features, docs_model_handoff_feature_contract, docs_model_handoff_adapter_interface, readme_model_adapter [INFERRED 0.85]
- **TERRA-radiation evidence base** — docs_data_nasa_radlab, docs_data_al_turki_2024, docs_data_ntrs_20160012724, docs_data_exploratory_association, docs_data_twins_study [EXTRACTED 1.00]
- **Radiation exposure to molecular response narrative** — desktop_preview_radiation_environment_chart, desktop_preview_molecular_response_chart, desktop_preview_what_the_data_can_tell_us, desktop_preview_connected_companion [INFERRED 0.85]
- **Overview Metric Cards** — mobile_preview_station_dose_rate, mobile_preview_terra_reference, mobile_preview_paired_research_samples, mobile_preview_crew_measurements [EXTRACTED 1.00]

## Communities (14 total, 6 thin omitted)

### Community 0 - "Docs, API & Views"
Cohesion: 0.08
Nodes (35): Desktop dashboard entry (index.html), Historical radiation filter bar (detector/date/timeline), Add measurement dialog, Workspace views (overview, radiation, measurements, model, followup), Mobile layout entry (mobile.html), /api/bootstrap metric registry, /api/features endpoint, /api/hrv RMSSD endpoint (+27 more)

### Community 1 - "Frontend app.js"
Cohesion: 0.14
Nodes (34): api(), boot(), changeView(), comparison(), dailyRows(), drawChart(), drawVisible(), esc() (+26 more)

### Community 2 - "WSGI Server & API"
Cohesion: 0.19
Nodes (15): add_reading(), api(), APIError, application(), connection(), features(), finite(), iso() (+7 more)

### Community 4 - "Desktop Radiation/TERRA Dashboard"
Cohesion: 0.23
Nodes (11): Aerol Desktop Dashboard Preview, Your Connected Companion (watch workflow demo), DosTel2 Station Detector, KPI Stat Cards (dose rate, TERRA, paired samples, crew measurements), The Molecular Response Chart (TERRA abundance), The Radiation Environment Chart (DosTel2 dose rate), Scott Kelly (Twins Study samples), Dark Sidebar Navigation (Follow-up) (+3 more)

### Community 7 - "Mobile Overview Screen"
Cohesion: 0.25
Nodes (8): Mission Health Overview Screenshot, NASA Historical Reference (ISS Scott Kelly mission), Overview Dashboard (The bigger picture), Paired Research Samples Card, Station Dose Rate Card (DosTel2), Latest TERRA Reference Card, Top Nav: Overview, Radiation & TERRA, Measurements, Model, Follow-up, Detector/View-through/Timeline Controls

### Community 9 - "Icon 192px"
Cohesion: 0.67
Nodes (4): Aerol App Icon 192px, Aerol Brand Color Palette (dark teal, mint, amber, white), Orbit Logo Motif (planet ring with satellite), PWA / Home-screen App Icon (192x192)

### Community 10 - "Icon 512px"
Cohesion: 0.67
Nodes (4): Aerol App Icon (512x512), Brand Color Palette (dark teal, mint, white, amber), Orbit / Planet Logo Mark, PWA / Web App Manifest Icon

### Community 11 - "SVG Icon"
Cohesion: 0.67
Nodes (3): Aerol Icon Color Palette (#163f43, #b8e2d0, white, #e8b876), Aerol App Icon (icon.svg), Planet-and-Orbit Motif

## Knowledge Gaps
- **22 isolated node(s):** `Wearable and external readings`, `aerol.server:application WSGI app`, `Workspace views (overview, radiation, measurements, model, followup)`, `/api/motion endpoint`, `/api/bootstrap metric registry` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 50 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `application()` connect `WSGI Server & API` to `API Test Suite`, `CLI Entry Point`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `render()` (e.g. with `followup()` and `measurements()`) actually correct?**
  _`render()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Wearable and external readings`, `aerol.server:application WSGI app`, `Workspace views (overview, radiation, measurements, model, followup)` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Docs, API & Views` be split into smaller, more focused modules?**
  _Cohesion score 0.07557354925775979 - nodes in this community are weakly interconnected._
- **Why does `APITests` connect `API Test Suite` to `Package & Test Imports`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Should `Frontend app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14453781512605043 - nodes in this community are weakly interconnected._