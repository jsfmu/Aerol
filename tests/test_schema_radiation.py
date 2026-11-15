import json
import unittest
from pathlib import Path

from aerol import schema, radiation

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / 'tests' / 'fixtures' / 'records.json').read_text())


class SchemaParity(unittest.TestCase):
    """Same fixtures as tests/js/core.test.mjs — keeps the Python and JS validators aligned."""

    def test_valid_fixtures(self):
        for r in FIXTURES['valid']:
            self.assertEqual(schema.validate_record(r), [], r.get('record_id') or r.get('event_id'))

    def test_invalid_fixtures(self):
        for case in FIXTURES['invalid']:
            self.assertTrue(schema.validate_record(case['record']), case['why'])

    def test_future_leakage(self):
        res = schema.validate_batch(FIXTURES['leakage_batch'])
        self.assertFalse(res['valid'])

    def test_bundled_research_records_are_valid_and_honest(self):
        data = json.loads((ROOT / 'aerol' / 'static' / 'data' / 'research.json').read_text())
        res = schema.validate_batch(data['records'])
        self.assertTrue(res['valid'], [r for r in res['results'] if r['errors']][:3])
        terra = [r for r in data['records'] if r['schema_version'] == 'aerol.terra.v1']
        self.assertEqual(len(terra), 11)
        self.assertTrue(all(r['terra_fold_change'] is None for r in terra))
        i4 = [r for r in data['records'] if r.get('study_id') == 'OSD-569']
        self.assertEqual(len(i4), 28)
        self.assertTrue(all(r['wbc_unit'] == '10^9/L' and r['original_unit'] == 'Thousand/uL' for r in i4))
        digitized = [r for r in data['records'] if r.get('value_origin') == 'digitized_reference']
        self.assertTrue(all(r['aggregate'] and r['astronaut_id'] is None and r['wbc_total'] is None for r in digitized))
        self.assertIsNone(data['report_projection']['terra_pct']['landing'])
        missing = [row for row in data['dostel_daily']['rows'] if row[-1] is None]
        self.assertTrue(missing, 'zero-coverage days stay null')


class RadiationMath(unittest.TestCase):
    def test_worked_checks(self):
        a, b = radiation.worked_checks()
        self.assertEqual(a['computed'], 10.42)
        self.assertEqual(b['computed'], 625.6)

    def test_reset_gap_and_transition_split(self):
        H = radiation.HOUR_MS
        rep = radiation.ingest_readings([
            {'t': 0, 'device_id': 'd', 'kind': 'cumulative', 'unit': 'mSv', 'value': 1.0},
            {'t': H, 'device_id': 'd', 'kind': 'cumulative', 'unit': 'mSv', 'value': 1.1},
            {'t': 2 * H, 'device_id': 'd', 'kind': 'cumulative', 'unit': 'mSv', 'value': 0.05},
        ])
        self.assertEqual(len(rep['resets']), 1)
        self.assertAlmostEqual(rep['total_mSv'], 0.15)
        self.assertEqual(rep['gaps'][0]['reason'], 'counter_reset_unrecorded_interval')
        rep = radiation.ingest_readings([
            {'t': 0, 'device_id': 'z', 'kind': 'rate', 'unit': 'mSv/day', 'value': 0.7},
            {'t': 2 * H, 'device_id': 'z', 'kind': 'rate', 'unit': 'mSv/day', 'value': 1.84},
        ], transitions=[H])
        self.assertAlmostEqual(rep['total_mSv'], (0.7 + 1.84) / 24)
        rep = radiation.ingest_readings([
            {'t': 0, 'device_id': 'y', 'kind': 'rate', 'unit': 'mSv/day', 'value': 0.7},
            {'t': 10 * H, 'device_id': 'y', 'kind': 'rate', 'unit': 'mSv/day', 'value': 0.7},
        ])
        self.assertEqual(rep['total_mSv'], 0)
        self.assertEqual(len(rep['gaps']), 1)


if __name__ == '__main__':
    unittest.main()
