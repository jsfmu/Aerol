# Data sources, verification and limits

Checked 2026-11-15 unless stated.

| Source | Status | Used for | Limits |
|---|---|---|---|
| [NASA RadLab](https://visualization.osdr.nasa.gov/radlab/gui/overview/) ISS DosTel1/2, 2015-03-27 → 2016-03-02 | bundled (585,235 rows; SHA-256 in `aerol/data/snapshot.json`) | Observed station dose rate, cumulative station dose | Absorbed dose rate (µGy/h) at a Columbus-module location. Area monitor ≠ personal dosimeter; not converted to Sv. Days with zero coverage stay null. |
| [RadLab API docs](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) | **HTTP 500 at check** | — | Units carried from the 2026-11-14 export query. |
| [Al-Turki et al. 2024](https://www.nature.com/articles/s42003-024-06014-x) Suppl. Data 2 | bundled | Observed TERRA (TW, UUAGGG, 11 samples) | One astronaut; no pre-flight personal baseline → no fold change computed. In vitro radiation raised TERRA; simulated microgravity did not. |
| [NASA Twins Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7580864/) | text verified | Mission dosimetry records | 76.18 mGy physical dosimeter dose, 146.34 mSv effective dose. Not spread over days or used to calibrate anything. |
| NTRS 20160012724 (slide 24) | bundled mapping | FD → calendar dates for TERRA samples | Dates only; clock times unverified; post-flight dates derived from landing + R days. |
| [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) LSDS-7 CBC | **downloaded & bundled** (`aerol/data/osd569_LSDS-7_cbc_submitted.csv`, SHA-256 in research.json) | Observed WBC + differential, 4 crew | Inspiration4 (3-day flight). L-92, L-44, L-3, R+1, R+45, R+82, R+194 (C003 R+1 present). Thousand/µL = 10⁹/L; differentials cells/µL ÷ 1000. No in-flight samples, no TERRA, sample clock times unknown. Different people from the Twins Study — never paired. |
| [Crucian et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC5515498/) | text verified | Timing windows and qualitative findings | n=23. L-180 baseline chosen because later pre-flight samples may reflect pre-mission stress. WBC/granulocytes up in flight; lymphocytes/monocytes unaltered; landing surge. Values only in figures — no counts imported. |
| [NASA-STD-3001 §4.8](https://www.nasa.gov/reference/4-0-human-performance/) | text verified | Context only | Career limit: effective dose < 600 mSv (NASA Q). BFO 30-day 250 mGy-Eq, 1-year 500 mGy-Eq. |
| [NTRS 20160009163](https://ntrs.nasa.gov/api/citations/20160009163/downloads/20160009163.pdf) | reachable, not parsed | — | No values taken. |
| [NOAA SEP catalog](https://umbra.nascom.nasa.gov/SEP/) | bundled | Event markers | GOES >10 MeV flux (pfu), not ISS dose; no attribution of station peaks. |
| combined_radiation_report.pdf (team) | attachment | Graph structure, illustrative projection references | See corrections below. |

## Corrections applied to the combined report

- Its deep-space TERRA/WBC curves are illustrative projections, stored as `digitized_reference` of a projection — not measured outcomes.
- Radiation shares (TERRA 60%, WBC/granulocytes 10%, lymphocytes 0%) and post-flight fractions are adjustable assumptions, not constants.
- The 340-day constant-rate total (625.60 mSv) and the 6-month projection (≈335 mSv) use different durations and are not merged.
- 1.84 mSv/day is a historical deep-space cruise reference (MSL RAD), not a TERRA measurement, a universal rate or a safety threshold.
- The Twins Study was on the ISS; a deep-space version is hypothetical. Its 625.6 mSv is compared with nothing — the actual mission recorded 146.34 mSv effective dose.
- The report’s “104% of the 600 mSv career limit” compares a dose-equivalent arithmetic total with an effective-dose limit; AEROL does not show that percentage.
- The report has no landing-day TERRA value; none is fabricated (the simulation does not plan a TERRA sample at R+0).
- “NASA limits one event to 250 mSv” does not match the standard’s quantity: 250 mGy-Eq is a 30-day blood-forming-organ limit.
- A pre-flight TERRA rise from psychological stress is a requested hypothesis, labeled as such everywhere.
- The report’s “ISS (original)” WBC % values are read by eye (±5 pp); their upstream source and baseline are not stated.

## Not verified / open items

- RadLab API documentation (server error at check time).
- Exact sample clock times for TERRA and Inspiration4 CBC.
- Specimen type for the TERRA supplementary values (left null).
- Device placement of the Twins “physical dosimeter” (recorded as `unspecified`).
- No hardware integration exists: the wristband and dosimeter are simulated; BLE/real-time links are not implemented.

Public data keep their providers’ terms; the MIT code license does not relicense them.
