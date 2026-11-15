"""Build aerol/static/data/research.json from bundled, verified sources.

Run:  python3 scripts/build_research_data.py
Every generated record is validated with aerol.schema before writing.
Nothing here is invented: values come from the files listed in SOURCES, and anything
read by eye from a chart is labeled digitized_reference with its reading uncertainty.
"""
import csv
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aerol import schema  # noqa: E402

DATA = ROOT / 'aerol' / 'data'
OUT = ROOT / 'aerol' / 'static' / 'data' / 'research.json'
CBC = DATA / 'osd569_LSDS-7_cbc_submitted.csv'

TWINS = {
    'mission_id': 'ISS-OneYear-2015', 'study_id': 'NASA-Twins-Study', 'label': 'NASA Twins Study — ISS one-year mission',
    'launch_utc': '2015-03-27T19:42:57Z', 'landing_utc': '2016-03-02T04:26:00Z', 'flight_days': 340,
    'timing_source': 'Public mission record (Soyuz TMA-16M launch / TMA-18M landing); not contained in the TERRA data file.',
    'phase_convention': 'Flight split into thirds (early/mid/late), the convention used by the combined radiation report; not a NASA-defined phase boundary.',
    'region': 'inside_magnetosphere',
}
I4 = {
    'mission_id': 'Inspiration4-2021', 'study_id': 'OSD-569', 'label': 'SpaceX Inspiration4 (3-day free-flyer, ~585 km)',
    'launch_utc': '2021-09-16T00:02:56Z', 'landing_utc': '2021-09-18T23:06:49Z', 'flight_days': 2.96,
    'timing_source': 'Public mission record; the CBC file gives only L-/R+ day labels, so sample clock times are unknown.',
    'region': 'inside_magnetosphere',
}

SOURCES = [
    {'id': 'radlab', 'title': 'NASA RadLab — ISS DosTel1/DosTel2', 'url': 'https://visualization.osdr.nasa.gov/radlab/gui/overview/',
     'status': 'bundled', 'checked': '2026-11-15',
     'note': '585,235 rows bundled (accessed 2026-11-14). Absorbed dose rate, µGy/h, area monitors in the Columbus module — not personal dosimeters.'},
    {'id': 'radlab_api', 'title': 'RadLab API documentation', 'url': 'https://visualization.osdr.nasa.gov/radlab/gui/data-api/',
     'status': 'inaccessible_at_check', 'checked': '2026-11-15',
     'note': 'Returned HTTP 500 on 2026-11-15. Units are carried from the bundled 2026-11-14 export query (absorbed_dose_rate, µGy/h).'},
    {'id': 'osd569', 'title': 'Inspiration4 whole blood / CBC — NASA OSDR OSD-569 (LSDS-7)', 'url': 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569',
     'status': 'bundled', 'checked': '2026-11-15', 'sha256': None,
     'note': '4 crew (C001–C004), L-92, L-44, L-3, R+1, R+45, R+82, R+194. WBC in thousand/µL (= 10⁹/L); differentials in cells/µL; lab ranges per row. No in-flight samples, no TERRA.'},
    {'id': 'terra', 'title': 'Al-Turki et al. 2024, Commun Biol — TERRA increases in response to spaceflight', 'url': 'https://www.nature.com/articles/s42003-024-06014-x',
     'status': 'bundled', 'checked': '2026-11-15',
     'note': 'Supplementary Data 2, subject TW, UUAGGG normalized abundance (8 in-flight, 3 post-flight). Paper: in vitro ionizing radiation increased TERRA; simulated microgravity did not.'},
    {'id': 'twins', 'title': 'NASA Twins Study (PMC7580864)', 'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7580864/',
     'status': 'verified_text', 'checked': '2026-11-15',
     'note': 'Reports a physical dosimeter dose of 76.18 mGy and an effective dose of 146.34 mSv for the one-year mission.'},
    {'id': 'crucian', 'title': 'Crucian et al. 2015 — Alterations in adaptive immunity persist during long-duration spaceflight (PMC5515498)', 'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5515498/',
     'status': 'verified_text', 'checked': '2026-11-15',
     'note': 'n=23 ISS crew. Samples L-180, L-45, ~FD14, months 2–4, ~6 months, 3 h after landing (R+0), R+30. L-180 used as baseline because later pre-flight samples may reflect pre-mission stress. WBC and granulocytes rose in flight; lymphocytes/monocytes unaltered; landing surge attributed in literature to stress-induced neutrophil demargination. Values are only in figures (not tabulated) — no absolute counts are imported.'},
    {'id': 'nasa_std', 'title': 'NASA-STD-3001 Vol. 1 — 4.8 Ionizing radiation', 'url': 'https://www.nasa.gov/reference/4-0-human-performance/',
     'status': 'verified_text', 'checked': '2026-11-15',
     'note': 'Career limit: total career effective dose < 600 mSv (NASA effective dose, NASA Q, 2012 cancer model). Table 4.8-1: blood-forming organs 250 mGy-Eq (30-day), 500 mGy-Eq (1-year). The combined report’s “250 mSv per event” paraphrase does not match this table’s quantity or units.'},
    {'id': 'ntrs', 'title': 'NASA radiation research reference (NTRS 20160009163)', 'url': 'https://ntrs.nasa.gov/api/citations/20160009163/downloads/20160009163.pdf',
     'status': 'downloaded_not_parsed', 'checked': '2026-11-15', 'note': 'PDF reachable (8 MB). Not machine-parsed in this build; no values are taken from it.'},
    {'id': 'ntrs_timeline', 'title': 'NASA Twins Study collection timeline (NTRS 20160012724, slide 24)', 'url': 'https://ntrs.nasa.gov/citations/20160012724',
     'status': 'bundled', 'note': 'Used for FD→calendar mapping of TERRA samples (dates only; clock times not verified).'},
    {'id': 'sep', 'title': 'NOAA solar proton event catalog (hosted by NASA)', 'url': 'https://umbra.nascom.nasa.gov/SEP/', 'status': 'bundled',
     'note': 'GOES >10 MeV proton flux (pfu). Not ISS dose.'},
    {'id': 'report', 'title': 'combined_radiation_report.pdf (team-supplied)', 'url': None, 'status': 'attachment',
     'note': 'Illustrative projections. 340-day constant-rate total (625.60 mSv) and the 6-month biological projection (≈335 mSv) use different durations and are not merged. Radiation shares (60/10/0%) are adjustable assumptions.'},
]


def iso(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def day_window(date_str):
    d = datetime.fromisoformat(date_str + 'T00:00:00+00:00')
    return iso(d), iso(d + timedelta(days=1))


def twins_phase(fd=None, r=None):
    if r is not None:
        return 'landing' if r <= 3 else 'after_return'
    third = TWINS['flight_days'] / 3
    return 'early_flight' if fd < third else 'mid_flight' if fd < 2 * third else 'late_flight'


def shared(**kw):
    base = {k: None for k in schema.SHARED_FIELDS}
    base['aggregate'] = False
    base.update(kw)
    return base


def terra_records(snapshot):
    out = []
    for t in snapshot['terra']:
        tp = t['timepoint']
        start, end = day_window(t['date'])
        fd = int(tp[2:]) if tp.startswith('FD') else None
        r = int(tp[2:]) if tp.startswith('R+') else None
        rec = shared(
            schema_version=schema.TERRA_SCHEMA, record_id=f'twins-terra-TW-{tp}', astronaut_id='TW', mission_id=TWINS['mission_id'],
            study_id='Al-Turki-2024-SD2', cohort_id='NASA Twins Study — flight subject (n=1)', timestamp_utc=None,
            time_window_start=start, time_window_end=end, mission_day=fd, return_day=r,
            mission_phase=twins_phase(fd, r), exposure_region='inside_magnetosphere' if fd is not None else 'ground',
            trajectory_source='ISS low Earth orbit (public mission record)', value_origin='observed',
            source_reference='Al-Turki et al. 2024, Commun Biol 7, Supplementary Data 2 (TW, UUAGGG); dates via NTRS 20160012724',
            quality_flag='date_derived_from_R_plus' if r is not None else 'clock_time_unverified',
        )
        rec.update({k: None for k in schema.TERRA_FIELDS})
        rec.update(specimen=None, assay_method='UUAGGG RNA motif abundance as published (see source methods)',
                   raw_value=t['normalized_abundance'], raw_unit='normalized_abundance (source scale)',
                   normalization_method='As published in Supplementary Data 2',
                   baseline_id=None, baseline_value=None, baseline_window=None,
                   terra_fold_change=None, terra_percent_change=None)
        out.append(rec)
    return out


def cbc_records():
    rows = list(csv.DictReader(CBC.open(encoding='utf-8-sig')))
    by = {}
    for row in rows:
        by.setdefault((row['SUBJECT_ID'], row['TEST_DATE']), {})[row['ANALYTE']] = row
    order = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194']
    pop = {'neutrophils': 'NEUTROPHILS', 'lymphocytes': 'LYMPHOCYTES', 'monocytes': 'MONOCYTES', 'eosinophils': 'EOSINOPHILS', 'basophils': 'BASOPHILS'}
    out = []
    for subject in sorted({k[0] for k in by}):
        baseline = None
        for label in order:
            a = by.get((subject, label))
            if not a or 'WHITE BLOOD CELL COUNT' not in a:
                continue
            w = a['WHITE BLOOD CELL COUNT']
            assert w['UNITS'] == 'Thousand/uL'
            total = float(w['VALUE'])
            rid = f'i4-wbc-{subject}-{label}'
            if label == 'L-92':
                baseline = (rid, total)
            pre = label.startswith('L-')
            n = int(label[2:])
            diff_abs = {}
            diff_pct = {}
            for key, name in pop.items():
                ab = a.get('ABSOLUTE ' + name)
                if ab:
                    assert ab['UNITS'] == 'cells/uL'
                    diff_abs[key] = round(float(ab['VALUE']) / 1000.0, 6)
                pc = a.get(name)
                diff_pct[key] = float(pc['VALUE']) if pc else None
            rec = shared(
                schema_version=schema.WBC_SCHEMA, record_id=rid, astronaut_id=subject, mission_id=I4['mission_id'], study_id='OSD-569',
                cohort_id='Inspiration4 crew (n=4)', timestamp_utc=None, time_window_start=None, time_window_end=None,
                mission_day=-n if pre else None, return_day=n if not pre else None,
                mission_phase='preflight' if pre else ('landing' if n <= 3 else 'after_return'),
                exposure_region='ground', trajectory_source='Not applicable (ground sample)', value_origin='observed',
                source_reference='NASA OSDR OSD-569, LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv',
                quality_flag='day_label_only_clock_time_unknown',
            )
            rec.update({k: None for k in schema.WBC_FIELDS})
            rec.update(
                specimen='whole blood', assay_method='Clinical CBC with differential (per OSDR study)', wbc_total=total, wbc_unit='10^9/L',
                original_value=total, original_unit='Thousand/uL', conversion_note='1 thousand/µL = 10^9/L (identity); differentials: cells/µL ÷ 1000',
                differential_absolute=diff_abs, differential_percent=diff_pct,
                lab_reference_low=float(w['RANGE_MIN']), lab_reference_high=float(w['RANGE_MAX']), reference_source='Range reported per row in OSD-569 CBC file',
                baseline_id=baseline[0] if baseline else None, baseline_value=baseline[1] if baseline else None,
                percent_change_from_baseline=round(100 * (total / baseline[1] - 1), 4) if baseline else None,
                relative_change_only=False, relative_change_percent=None, measurement_status='measured',
            )
            out.append(rec)
    return out


DIGITIZED_WBC = [  # combined_radiation_report.pdf p.3, "ISS (original)" dashed WBC line, read by eye (±5 percentage points)
    ('early_flight', 14, None, 15), ('mid_flight', 90, None, 12), ('late_flight', 180, None, 21), ('landing', None, 0.125, 65), ('after_return', None, 30, 2),
]


def digitized_records():
    out = []
    for phase, md, rd, pct in DIGITIZED_WBC:
        rec = shared(
            schema_version=schema.WBC_SCHEMA, record_id=f'report-iss-wbc-{phase}', astronaut_id=None, mission_id=None, study_id='combined_radiation_report',
            cohort_id='ISS long-duration crew as plotted in the combined report (upstream source not stated)', aggregate=True, sample_size=None,
            mission_day=md, return_day=rd, mission_phase=phase, exposure_region='inside_magnetosphere' if md is not None else 'ground',
            trajectory_source='ISS (as labeled in report)', value_origin='digitized_reference',
            source_reference='combined_radiation_report.pdf p.3, dashed “ISS (original)” WBC line; likely derived from Crucian et al. 2015 Fig. 1a (unverified)',
            quality_flag='read_by_eye_pm5pp_baseline_definition_not_stated',
        )
        rec.update({k: None for k in schema.WBC_FIELDS})
        rec.update(wbc_unit='10^9/L', relative_change_only=True, relative_change_percent=float(pct), measurement_status='reference')
        out.append(rec)
    return out


def dosimetry_records():
    common = dict(mission_id=TWINS['mission_id'], study_id='NASA-Twins-Study', cohort_id='NASA Twins Study — flight subject (n=1)', astronaut_id='TW',
                  time_window_start='2015-03-27T19:42:57Z', time_window_end='2016-03-02T04:26:00Z', mission_day=None,
                  mission_phase=None, exposure_region='inside_magnetosphere', trajectory_source='ISS low Earth orbit',
                  value_origin='observed', source_reference='Garrett-Bakelman/Twins Study report, PMC7580864', quality_flag='mission_total')
    out = []
    a = shared(schema_version=schema.RADIATION_SCHEMA, record_id='twins-dose-physical', **common)
    a.update({k: None for k in schema.RADIATION_FIELDS})
    a.update(original_value=76.18, original_unit='mGy', dose_quantity='absorbed_dose', cumulative_value=76.18, cumulative_unit='mGy',
             detector_id=None, detector_type='unspecified', personal_dosimeter=None,
             conversion_assumptions='Source text: “physical dosimeter dose”; device placement not specified in the text.')
    b = shared(schema_version=schema.RADIATION_SCHEMA, record_id='twins-dose-effective', **common)
    b.update({k: None for k in schema.RADIATION_FIELDS})
    b.update(original_value=146.34, original_unit='mSv', dose_quantity='nasa_effective_dose', cumulative_value=146.34, cumulative_unit='mSv',
             detector_type='model', personal_dosimeter=None, conversion_assumptions='Effective dose as reported by NASA in the source; method per source.')
    out += [a, b]
    return out


def rate_or_none(v):
    return v if isinstance(v, (int, float)) and v == v else None  # empty string in source = no coverage → null, never 0


def dostel_record(row):
    start, end = day_window(row['date'])
    rate = rate_or_none(row['mean_rate_uGy_h'])
    r = shared(schema_version=schema.RADIATION_SCHEMA, record_id=f"radlab-{row['instrument_id']}-{row['date']}", astronaut_id=None,
               mission_id=TWINS['mission_id'], study_id='NASA-RadLab', cohort_id=None, timestamp_utc=None,
               time_window_start=start, time_window_end=end, mission_day=row['flight_day'], return_day=None,
               mission_phase=twins_phase(min(row['flight_day'], 339.9)) if row['flight_day'] < 340 else 'late_flight',
               exposure_region='inside_magnetosphere', trajectory_source='ISS low Earth orbit', value_origin='observed',
               source_reference='NASA RadLab ISS export (daily time-weighted mean from bundled raw rows)',
               quality_flag='ok' if row['eligible'] else ('no_coverage' if rate is None else 'coverage_below_80pct'))
    r.update({k: None for k in schema.RADIATION_FIELDS})
    r.update(original_value=rate, original_unit='µGy/h', dose_quantity='absorbed_dose', rate_value=rate,
             rate_unit='µGy/h', interval_start=start, interval_end=end, cumulative_value=None, cumulative_unit=None,
             detector_id=row['instrument_id'], detector_type='area_monitor', personal_dosimeter=False,
             conversion_assumptions='None. Absorbed dose rate is kept in µGy/h; not converted to Sv.', coverage_fraction=row['coverage'])
    return r


def event(**kw):
    e = {'schema_version': schema.EVENT_SCHEMA, **{k: None for k in schema.EVENT_FIELDS}}
    e.update(affected_metrics=[], related_record_ids=[], possible_contributors=[], source_references=[])
    e.update(kw)
    return e


def evidence_events(snapshot):
    ev = [
        event(event_id='crucian2015-inflight-wbc', event_type='cohort_finding', phase='early_flight', region='inside_magnetosphere',
              affected_metrics=['wbc', 'granulocytes'], definition='Published cohort finding (n=23 ISS crew), paired comparison with L-180 baseline.',
              observed_change='Absolute WBC and granulocytes higher than L-180 during flight (significant at early and late timepoints); lymphocytes and monocytes unaltered.',
              possible_contributors=['Spaceflight adaptation (microgravity, confinement)', 'Stress hormones', 'Radiation contribution not isolated'],
              evidence_status='supported', source_references=['https://pmc.ncbi.nlm.nih.gov/articles/PMC5515498/'],
              suggested_action='Context only; compare individual results with personal baseline.'),
        event(event_id='crucian2015-landing-surge', event_type='cohort_finding', phase='landing', region='ground',
              affected_metrics=['wbc', 'neutrophils'], definition='WBC surge after landing (sample ~3 h after landing).',
              observed_change='WBC elevated at R+0 relative to baseline.',
              possible_contributors=['Stress-induced neutrophil demargination (cited by the authors)', 'Re-entry and readaptation'],
              evidence_status='supported', source_references=['https://pmc.ncbi.nlm.nih.gov/articles/PMC5515498/'],
              suggested_action='Interpret landing-day WBC with landing timing in mind.'),
        event(event_id='crucian2015-baseline-choice', event_type='method_note', phase='preflight', region='ground', affected_metrics=['wbc'],
              definition='Baseline selection rationale.',
              observed_change='The study used L-180 as baseline because samples collected closer to launch may be influenced by pre-mission stress.',
              possible_contributors=['Pre-mission stress'], evidence_status='supported', source_references=['https://pmc.ncbi.nlm.nih.gov/articles/PMC5515498/'],
              suggested_action='Use an early pre-flight baseline window.'),
        event(event_id='i4-l3-wbc', event_type='observation', phase='preflight', region='ground', affected_metrics=['wbc'],
              related_record_ids=[f'i4-wbc-C00{i}-L-3' for i in range(1, 5)],
              definition='Inspiration4 pre-flight CBC pattern.',
              observed_change='WBC at L-3 exceeded L-44 in all four crew (7.0 vs 5.5; 7.2 vs 5.4; 9.8 vs 9.3; 10.6 vs 6.4 ×10⁹/L).',
              possible_contributors=['Pre-mission stress (hypothesis)', 'Training, travel, sampling time of day', 'Normal variation'],
              evidence_status='observed', source_references=['https://osdr.nasa.gov/bio/repo/data/studies/OSD-569'],
              suggested_action='Descriptive only (n=4); cause not established.'),
        event(event_id='alturki2024-mechanism', event_type='mechanism_evidence', affected_metrics=['terra'],
              definition='Cell-model evidence on TERRA regulation.',
              observed_change='In vitro ionizing radiation (2 Gy γ-rays) increased TERRA transcription; simulated microgravity did not.',
              possible_contributors=['Telomeric DNA damage response'], evidence_status='supported',
              source_references=['https://www.nature.com/articles/s42003-024-06014-x'],
              suggested_action='Supports radiation as a candidate contributor; does not establish dose-response in astronauts.'),
        event(event_id='hypothesis-preflight-terra-stress', event_type='hypothesis', phase='preflight', affected_metrics=['terra'],
              definition='Requested simulation hypothesis.',
              observed_change='No bundled dataset contains a pre-flight TERRA rise; this is modeled as an adjustable stress contribution.',
              possible_contributors=['Psychological pre-mission stress (hypothesis)'], evidence_status='hypothesis', source_references=[],
              suggested_action='Test with pre-flight serial TERRA samples before relying on it.'),
    ]
    for e in snapshot['events']:
        ev.append(event(event_id=f"sep-{e['date']}", event_type='solar_particle_event', start_time=e['peak_utc'], phase=None, region=None,
                        affected_metrics=['goes_proton_flux'], definition='GOES >10 MeV proton event (catalog).',
                        observed_change=f"Peak flux {e['peak_pfu']} pfu at {e['peak_utc']}.",
                        possible_contributors=['Solar activity'], evidence_status='observed', source_references=['https://umbra.nascom.nasa.gov/SEP/'],
                        suggested_action='Marker only — not ISS dosimetry and not attributed to a station dose-rate peak.'))
    return ev


REPORT_PROJECTION = {
    'label': 'Combined report — deep-space projection at 1.84 mSv/day (illustrative; read by eye ±5 pp)',
    'source': 'combined_radiation_report.pdf p.3 (solid lines)',
    'note': 'Illustrative model output, not measured deep-space astronaut data. Radiation shares (TERRA 60%, WBC/granulocytes 10%, lymphocytes 0%) and post-flight fractions are adjustable assumptions. No landing-day TERRA value exists in the report.',
    'terra_pct': {'preflight': 0, 'early_flight': 105, 'mid_flight': 57, 'late_flight': 295, 'landing': None, 'after_return': 22},
    'wbc_pct': {'preflight': 0, 'early_flight': 17, 'mid_flight': 14, 'late_flight': 25, 'landing': 67, 'after_return': 3},
    'totals': {'six_month_projection_mSv': 335, 'six_month_basis': '≈182 days × 1.84 mSv/day (report p.3)',
               'constant_340_day_mSv': 625.6, 'constant_340_basis': '340 days × 1.84 mSv/day (report p.1)'},
}


def main():
    snapshot = json.loads((DATA / 'snapshot.json').read_text())
    records = terra_records(snapshot) + cbc_records() + digitized_records() + dosimetry_records() + evidence_events(snapshot)
    dostel = [dostel_record(r) for r in snapshot['daily']]
    check = schema.validate_batch(records + dostel)
    bad = [r for r in check['results'] if r['errors']]
    if bad:
        for r in bad[:10]:
            print(r)
        raise SystemExit(f'{len(bad)} invalid records')
    for s in SOURCES:
        if s['id'] == 'osd569':
            s['sha256'] = hashlib.sha256(CBC.read_bytes()).hexdigest()
    payload = {
        'generated_by': 'scripts/build_research_data.py', 'built': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'schema_versions': list(schema.VALIDATORS), 'missions': {'twins': TWINS, 'inspiration4': I4}, 'sources': SOURCES,
        'records': records,
        'dostel_daily': {'fields': ['instrument_id', 'date', 'flight_day', 'eligible', 'coverage', 'covered_hours', 'observed_dose_uGy', 'mean_rate_uGy_h'],
                         'rows': [[r['instrument_id'], r['date'], r['flight_day'], r['eligible'], round(r['coverage'], 5), round(r['covered_hours'], 4),
                                   round(r['observed_dose_uGy'], 4), None if rate_or_none(r['mean_rate_uGy_h']) is None else round(r['mean_rate_uGy_h'], 5)] for r in snapshot['daily']],
                         'note': 'Compact form; the dashboard expands each row into an aerol.radiation.v1 record (validated at build time).'},
        'correlations': snapshot['correlations'], 'correlation_note': snapshot['provenance']['comparison']['note'],
        'report_projection': REPORT_PROJECTION,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {OUT.relative_to(ROOT)}: {len(records)} records + {len(dostel)} DosTel daily records (all valid)')


if __name__ == '__main__':
    main()
