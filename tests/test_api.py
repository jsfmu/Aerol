import io
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from wsgiref.util import setup_testing_defaults
from aerol import server


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(server,'DB',Path(self.temp.name)/'test.sqlite3')
        self.db_patch.start()
        self.token_patch = patch.dict('os.environ',{},clear=True)
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop();self.db_patch.stop();self.temp.cleanup()

    def request(self,path,body=None,method=None,extra=None):
        env={};setup_testing_defaults(env)
        payload=json.dumps(body).encode() if body is not None else b''
        env.update(PATH_INFO=path,REQUEST_METHOD=method or ('POST' if body is not None else 'GET'),
                   CONTENT_TYPE='application/json',CONTENT_LENGTH=str(len(payload)),**{'wsgi.input':io.BytesIO(payload)})
        env.update(extra or {})
        response=[]
        data=b''.join(server.application(env,lambda status,headers:response.append((status,headers))))
        status=int(response[0][0].split()[0])
        return status,json.loads(data) if data.startswith(b'{') else data

    def test_bootstrap_provenance_and_sample_count(self):
        status,data=self.request('/api/bootstrap')
        self.assertEqual(status,200)
        self.assertEqual(data['provenance']['radiation']['raw_records'],585235)
        self.assertEqual(sum(t['in_flight'] for t in data['terra']),8)
        self.assertFalse(data['provenance']['radiation']['personal_dosimetry'])
        self.assertFalse(any('bone' in m['id'] for m in data['metrics']))
        self.assertEqual(data['crew']['latest'],{})

    def test_record_is_saved_separately_and_ordered_by_collection_time(self):
        self.request('/api/readings',{'metric':'hr','value':64,'timestamp':'2026-11-15T10:00:00Z','source':'device'})
        self.request('/api/readings',{'metric':'hr','value':72,'timestamp':'2026-11-14T10:00:00Z','source':'manual'})
        status,data=self.request('/api/readings')
        self.assertEqual(status,200);self.assertEqual(data['latest']['hr']['value'],64)
        self.assertEqual(len(server.SNAPSHOT['terra']),11)

    def test_spo2_bad_data_and_boolean_rejected(self):
        for body in [{'metric':'spo2','value':101},{'metric':'hr','value':True},{'metric':'wbc','value':-2},{'metric':'hr','value':float('nan')}]:
            self.assertEqual(self.request('/api/readings',body)[0],400)

    def test_rmssd_formula_and_raw_axes(self):
        status,data=self.request('/api/hrv',{'nn_intervals_ms':[800,810,790]})
        self.assertEqual(status,200);self.assertAlmostEqual(data['rmssd_ms'],math.sqrt(250))
        self.assertIsNone(data['stress_score'])
        status,data=self.request('/api/motion',{'accelerometer':{'x':3,'y':4,'z':0}})
        self.assertEqual(status,200);self.assertEqual(data['accelerometer']['magnitude'],5)

    def test_features_reconcile_to_precomputed_matching(self):
        status,data=self.request('/api/features',{'as_of':'2015-09-24','detector':'DosTel1','window_days':7,'horizon_days':7})
        self.assertEqual(status,200)
        expected=next(r for r in server.SNAPSHOT['matched'] if r['instrument_id']=='DosTel1' and r['timepoint']=='FD181' and r['window_days']==7 and r['cutoff_shift_days']==0)
        self.assertAlmostEqual(data['mean_station_dose_rate_uGy_h'],expected['mean_rate_uGy_h'],places=9)
        self.assertFalse(data['personal_dosimetry']);self.assertIsNone(data['wearable_data'])

    def test_insufficient_coverage_does_not_become_prediction(self):
        status,_=self.request('/api/features',{'as_of':'2016-02-24','window_days':7,'horizon_days':7})
        self.assertEqual(status,422)

    def test_missing_and_installed_model_contract(self):
        request={'as_of':'2015-09-24','window_days':7,'horizon_days':7}
        self.assertEqual(self.request('/api/predict',request)[0],503)
        class TestModel:
            MODEL_INFO={'name':'Unit-test fixture','version':'test','validated':False}
            @staticmethod
            def is_ready():return True
            @staticmethod
            def predict(features,horizon_days):return {'value':0.002,'explanation':'Test fixture only'}
        with patch.object(server,'MODEL',TestModel):
            status,data=self.request('/api/predict',request)
        self.assertEqual(status,200);self.assertEqual(data['prediction']['display_x1000'],2)
        self.assertEqual(data['forecast_date'],'2015-10-01')

    def test_cross_origin_post_and_path_traversal(self):
        self.assertEqual(self.request('/api/readings',{'metric':'hr','value':60},extra={'HTTP_ORIGIN':'https://other.example'})[0],403)
        self.assertEqual(self.request('/../server.py')[0],404)

    def test_tasks_persist_without_sending_anything(self):
        status,data=self.request('/api/tasks',{'kind':'terra_research','status':'planned'})
        self.assertEqual(status,200);self.assertEqual(len(data['tasks']),1)
        self.assertEqual(self.request('/api/tasks')[1]['tasks'][0]['kind'],'terra_research')

    def test_optional_token_is_enforced(self):
        with patch.dict('os.environ',{'AEROL_API_TOKEN':'test-token'}):
            self.assertEqual(self.request('/api/readings')[0],401)
            self.assertEqual(self.request('/api/readings',extra={'HTTP_AUTHORIZATION':'Bearer test-token'})[0],200)

    def test_both_entry_points_and_manifest(self):
        self.assertEqual(self.request('/')[0],200)
        self.assertEqual(self.request('/mobile/')[0],200)
        self.assertEqual(self.request('/manifest.webmanifest')[0],200)

if __name__=='__main__':unittest.main()
