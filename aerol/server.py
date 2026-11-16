"""Dependency-free WSGI backend. Local runner: python -m aerol."""
import csv
import hmac
import importlib
import io
import json
import math
import mimetypes
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timedelta, timezone

from . import schema as record_schema
from . import radiation as rad

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / 'static'
DATA = ROOT / 'data'
SNAPSHOT = json.loads((DATA / 'snapshot.json').read_text())
DB = Path(os.environ.get('AEROL_DB', str(ROOT.parent / 'local-data' / 'aerol.sqlite3')))
MODEL = importlib.import_module(os.environ.get('AEROL_MODEL_MODULE', 'aerol.model_adapter'))

METRICS = [
    ('hr', 'Heart rate', 'bpm', 'wearable', 'PPG / ECG'),
    ('rhr', 'Resting heart rate', 'bpm', 'wearable', 'Rest-qualified PPG / ECG'),
    ('hrv', 'HRV · RMSSD', 'ms', 'wearable', 'Artifact-corrected NN intervals'),
    ('respiration', 'Respiratory rate', 'breaths/min', 'wearable', 'Estimated from PPG modulation'),
    ('spo2', 'Wrist SpO₂', '%', 'wearable', 'Calibrated red / infrared PPG'),
    ('skin_temperature', 'Skin temperature', '°C', 'wearable', 'Wrist sensor; not core temperature'),
    ('movement', 'Movement', 'm/s²', 'wearable', '3-axis accelerometer magnitude'),
    ('gyroscope', 'Rotation', '°/s', 'wearable', '3-axis gyroscope magnitude'),
    ('clinical_spo2', 'Confirmed SpO₂', '%', 'external', 'Medical-grade pulse oximeter'),
    ('systolic', 'Systolic pressure', 'mmHg', 'external', 'Sphygmomanometer'),
    ('diastolic', 'Diastolic pressure', 'mmHg', 'external', 'Sphygmomanometer'),
    ('blood_flow', 'Blood-flow velocity', 'cm/s', 'external', 'Ultrasound; record vessel and protocol'),
    ('wbc', 'White blood cells', '×10⁹/L', 'external', 'CBC blood draw'),
    ('neutrophils', 'Neutrophils · absolute', '×10⁹/L', 'external', 'CBC differential'),
    ('lymphocytes', 'Lymphocytes · absolute', '×10⁹/L', 'external', 'CBC differential'),
    ('monocytes', 'Monocytes · absolute', '×10⁹/L', 'external', 'CBC differential'),
    ('eosinophils', 'Eosinophils · absolute', '×10⁹/L', 'external', 'CBC differential'),
    ('basophils', 'Basophils · absolute', '×10⁹/L', 'external', 'CBC differential'),
    ('crp', 'C-reactive protein', 'mg/L', 'external', 'Blood draw; assay-specific interpretation'),
    ('personal_dose_rate', 'Personal dose rate', 'µGy/h', 'external', 'Personal dosimeter; separate from ISS area monitor'),
    ('personal_total_dose', 'Personal cumulative dose', 'mGy', 'external', 'Personal dosimeter; absorbed dose, not dose equivalent'),
    ('terra', 'TERRA laboratory result', 'normalized abundance', 'external', 'RNA assay; normalization must match the reference'),
]
REGISTRY = {r[0]: dict(zip(('id', 'label', 'unit', 'group', 'method'), r)) for r in METRICS}


class APIError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def connection():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript('''CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY, metric TEXT NOT NULL, value REAL NOT NULL,
      baseline REAL, timestamp TEXT NOT NULL, source TEXT NOT NULL,
      device TEXT NOT NULL, note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
      record_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, value_origin TEXT,
      body TEXT NOT NULL, stored_at TEXT NOT NULL);''')
    return con


def finite(value, label='value'):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise APIError(label + ' must be a finite number')
    return float(value)


def iso(value):
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise ValueError()
        return stamp.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, AttributeError):
        raise APIError('timestamp must be ISO 8601 with a timezone')


def now():
    return datetime.now(timezone.utc).isoformat()


def text(value, limit=500):
    if not isinstance(value, str) or len(value) > limit:
        raise APIError('Invalid text field')
    return value


def readings():
    with connection() as con:
        rows = [dict(r) for r in con.execute('SELECT * FROM readings ORDER BY timestamp DESC, id DESC LIMIT 500')]
    latest = {}
    for row in rows:
        latest.setdefault(row['metric'], row)
    return {'latest': latest, 'history': rows, 'profile': 'Local crew workspace',
            'inferences': {k: None for k in ('stress', 'sleep', 'recovery')}}


def add_reading(body):
    metric = body.get('metric')
    if metric not in REGISTRY:
        raise APIError('Unknown metric')
    value = finite(body.get('value'))
    baseline = None if body.get('baseline') is None else finite(body['baseline'], 'baseline')
    if metric in ('spo2', 'clinical_spo2') and not 0 <= value <= 100:
        raise APIError('SpO₂ must be between 0 and 100 percent')
    if metric not in ('skin_temperature',) and value < 0:
        raise APIError('This metric cannot be negative')
    source = body.get('source', 'manual')
    if source not in ('manual', 'device', 'laboratory'):
        raise APIError('source must be manual, device or laboratory')
    with connection() as con:
        cursor = con.execute('INSERT INTO readings(metric,value,baseline,timestamp,source,device,note) VALUES(?,?,?,?,?,?,?)',
            (metric, value, baseline, iso(body.get('timestamp', now())), source,
             text(body.get('device', ''), 120), text(body.get('note', ''))))
        identifier = cursor.lastrowid
    return {'id': identifier, **readings()}


def rmssd(body):
    values = body.get('nn_intervals_ms')
    if not isinstance(values, list) or not 2 <= len(values) <= 20000:
        raise APIError('Provide 2–20,000 artifact-corrected NN intervals in milliseconds')
    values = [finite(v, 'NN interval') for v in values]
    if any(v <= 0 for v in values):
        raise APIError('NN intervals must be positive')
    result = math.sqrt(sum((b-a)**2 for a, b in zip(values, values[1:])) / (len(values)-1))
    return {'rmssd_ms': result, 'interval_count': len(values),
            'method': 'sqrt(mean(diff(NN_ms)^2))', 'stress_score': None,
            'note': 'Artifact-corrected NN intervals are required. PPG pulse-rate variability is an estimate, not interchangeable with ECG HRV.'}


def model_status():
    try:
        ready = bool(MODEL.is_ready())
    except Exception:
        ready = False
    return {**MODEL.MODEL_INFO, 'available': ready}


def motion(body):
    result = {'source': 'device', 'timestamp': iso(body.get('timestamp', now()))}
    for key, unit in [('accelerometer', 'm/s²'), ('gyroscope', '°/s')]:
        axes = body.get(key)
        if axes is None:
            continue
        if not isinstance(axes, dict) or set(axes) != {'x','y','z'}:
            raise APIError(key+' requires x, y and z')
        axes = {k: finite(v,k) for k,v in axes.items()}
        result[key] = {'axes': axes, 'magnitude': math.sqrt(sum(v*v for v in axes.values())), 'units': unit}
    if not any(k in result for k in ('accelerometer', 'gyroscope')):
        raise APIError('Supply accelerometer or gyroscope axes')
    return result


def features(body):
    detector = body.get('detector', 'DosTel1')
    if detector not in ('DosTel1', 'DosTel2'):
        raise APIError('Invalid detector')
    window = body.get('window_days', 7)
    horizon = body.get('horizon_days', 7)
    if type(window) is not int or window not in (1, 7, 30):
        raise APIError('window_days must be 1, 7 or 30')
    if type(horizon) is not int or not 1 <= horizon <= 30:
        raise APIError('horizon_days must be an integer from 1 to 30')
    try:
        end = datetime.strptime(body.get('as_of', ''), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        raise APIError('as_of must be YYYY-MM-DD')
    if not datetime(2015, 3, 28).date() <= end <= datetime(2016, 3, 3).date():
        raise APIError('as_of is outside the bundled mission period')
    start = end - timedelta(days=window)
    rows = [r for r in SNAPSHOT['daily'] if r['instrument_id'] == detector and start.isoformat() <= r['date'] < end.isoformat()]
    hours = sum(r['covered_hours'] for r in rows)
    dose = sum(r['observed_dose_uGy'] for r in rows)
    coverage = hours / (window * 24)
    if coverage < 0.8:
        raise APIError('Less than 80% radiation time coverage for this window', 422)
    return {'detector': detector, 'as_of': end.isoformat(), 'window_days': window,
            'horizon_days': horizon, 'mean_station_dose_rate_uGy_h': dose/hours,
            'coverage_fraction': coverage, 'observed_station_dose_uGy': dose,
            'flight_day': (end-datetime(2015, 3, 27).date()).days,
            'personal_dosimetry': False, 'source': 'NASA RadLab ISS Columbus station detectors',
            'cutoff': '00:00 UTC at start of as_of date',
            'wearable_data': None, 'note': 'Local crew measurements are not merged into Scott Kelly’s historical records.'}


def prediction(body):
    inputs = features(body)
    if not model_status()['available']:
        raise APIError('No prediction model installed. Connect aerol/model_adapter.py.', 503)
    try:
        result = MODEL.predict(inputs, inputs['horizon_days'])
        value = finite(result['value'], 'prediction')
        if not 0 <= value <= 1:
            raise ValueError('Normalized abundance must be between 0 and 1')
        output = {'value': value, 'display_x1000': value*1000,
                  'explanation': text(result.get('explanation', ''), 2000)}
        if 'lower' in result or 'upper' in result:
            lower, upper = finite(result.get('lower')), finite(result.get('upper'))
            if not 0 <= lower <= value <= upper <= 1:
                raise ValueError('Invalid interval')
            output.update(lower=lower, upper=upper)
    except Exception as error:
        raise APIError('The model returned an invalid result. Check the adapter contract.', 502) from error
    return {'kind': 'model_prediction', 'model': model_status(), 'inputs': inputs,
            'prediction': output, 'units': 'normalized_abundance',
            'forecast_date': (datetime.fromisoformat(inputs['as_of'])+timedelta(days=inputs['horizon_days'])).date().isoformat()}


def validate_records(body):
    records = body.get('records')
    if not isinstance(records, list) or not 1 <= len(records) <= 2000:
        raise APIError('Provide "records": a list of 1–2,000 records')
    return record_schema.validate_batch(records)


def store_records(body):
    result = validate_records(body)
    if not result['valid']:
        raise APIError('Validation failed: ' + '; '.join(
            f"{r['record_id']}: {', '.join(r['errors'])}" for r in result['results'] if r['errors'])[:2000], 422)
    with connection() as con:
        for r in body['records']:
            rid = r.get('record_id') or r.get('event_id')
            con.execute('INSERT OR REPLACE INTO records(record_id,schema_version,value_origin,body,stored_at) VALUES(?,?,?,?,?)',
                        (rid, r['schema_version'], r.get('value_origin'), json.dumps(r, allow_nan=False), now()))
    return {'stored': len(body['records']), 'valid': True}


def list_records():
    with connection() as con:
        rows = [dict(r) for r in con.execute('SELECT body FROM records ORDER BY stored_at DESC LIMIT 2000')]
    return {'records': [json.loads(r['body']) for r in rows]}


def integrate(body):
    readings = body.get('readings')
    if not isinstance(readings, list) or not 1 <= len(readings) <= 50000:
        raise APIError('Provide "readings": a list of 1–50,000 dosimeter readings')
    gap = body.get('max_gap_hours', 2)
    if not isinstance(gap, (int, float)) or isinstance(gap, bool) or not 0 < gap <= 72:
        raise APIError('max_gap_hours must be between 0 and 72')
    transitions = body.get('transitions', [])
    if not isinstance(transitions, list):
        raise APIError('transitions must be a list of epoch-millisecond timestamps')
    return {**rad.ingest_readings(readings, gap, transitions), 'worked_checks': rad.worked_checks(),
            'quantity': 'dose equivalent (mSv); absorbed dose units are rejected rather than relabeled'}


def api(method, path, body):
    if method == 'GET' and path == '/api/health':
        return {'status': 'ok', 'version': '2.0.0'}
    if method == 'GET' and path == '/api/schema':
        return {'versions': list(record_schema.VALIDATORS), 'value_origins': record_schema.VALUE_ORIGINS,
                'shared_fields': record_schema.SHARED_FIELDS, 'terra_fields': record_schema.TERRA_FIELDS,
                'wbc_fields': record_schema.WBC_FIELDS, 'radiation_fields': record_schema.RADIATION_FIELDS,
                'event_fields': record_schema.EVENT_FIELDS}
    if method == 'POST' and path == '/api/records/validate':
        return validate_records(body)
    if path == '/api/records' and method == 'POST':
        return store_records(body)
    if path == '/api/records' and method == 'GET':
        return list_records()
    if method == 'POST' and path == '/api/radiation/integrate':
        return integrate(body)
    if method == 'GET' and path == '/api/bootstrap':
        return {**SNAPSHOT, 'metrics': list(REGISTRY.values()), 'crew': readings(), 'model': model_status()}
    if method == 'GET' and path == '/api/readings':
        return readings()
    if method == 'GET' and path == '/api/model':
        return model_status()
    if method == 'POST' and path == '/api/readings':
        return add_reading(body)
    if method == 'POST' and path == '/api/hrv':
        return rmssd(body)
    if method == 'POST' and path == '/api/motion':
        return motion(body)
    if method == 'POST' and path == '/api/features':
        return features(body)
    if method == 'POST' and path == '/api/predict':
        return prediction(body)
    if path == '/api/tasks' and method in ('GET', 'POST'):
        with connection() as con:
            if method == 'POST':
                kind = body.get('kind')
                if kind not in ('exposure_review', 'shelter_checkin', 'cbc_followup', 'terra_research'):
                    raise APIError('Unknown task kind')
                status = body.get('status', 'logged')
                if status not in ('planned', 'logged', 'complete'):
                    raise APIError('Invalid task status')
                con.execute('INSERT INTO tasks(kind,status,created_at,note) VALUES(?,?,?,?)',
                            (kind, status, now(), text(body.get('note', ''))))
            return {'tasks': [dict(r) for r in con.execute('SELECT * FROM tasks ORDER BY id DESC LIMIT 100')]}
    raise APIError('Route not found', 404)


def application(environ, start_response):
    method, path = environ.get('REQUEST_METHOD', 'GET'), environ.get('PATH_INFO', '/')
    headers = [('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'same-origin')]
    try:
        if path.startswith('/api/'):
            token = os.environ.get('AEROL_API_TOKEN')
            if token and path not in ('/api/health',) and not hmac.compare_digest(environ.get('HTTP_AUTHORIZATION', ''), 'Bearer '+token):
                raise APIError('API token required', 401)
            body = {}
            if method == 'POST':
                origin = environ.get('HTTP_ORIGIN')
                expected = environ.get('wsgi.url_scheme', 'http')+'://'+environ.get('HTTP_HOST', '')
                if origin and origin != expected:
                    raise APIError('Origin not allowed', 403)
                if environ.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
                    raise APIError('Content-Type must be application/json', 415)
                try:
                    length = int(environ.get('CONTENT_LENGTH', '0') or '0')
                    limit = 4_000_000 if path in ('/api/records', '/api/records/validate', '/api/radiation/integrate') else 65536
                    if not 0 < length <= limit:
                        raise APIError(f'JSON body must be 1–{limit:,} bytes', 413)
                    body = json.loads(environ['wsgi.input'].read(length))
                except (ValueError, UnicodeError):
                    raise APIError('Invalid JSON')
                if not isinstance(body, dict):
                    raise APIError('JSON body must be an object')
            payload = json.dumps(api(method, path, body), allow_nan=False).encode()
            headers += [('Content-Type', 'application/json'), ('Cache-Control', 'no-store')]
        else:
            if method != 'GET':
                raise APIError('Method not allowed', 405)
            route = {'/': 'index.html', '/mobile': 'index.html', '/mobile/': 'index.html',
                     '/earth': 'index.html', '/earth/': 'index.html', '/dashboard': 'index.html', '/dashboard/': 'index.html',
                     '/downloads/iss-radiation.csv.gz': '../data/iss-radiation.csv.gz'}.get(path)
            if path == '/downloads/iss-radiation.csv.gz':
                file = DATA / 'iss-radiation.csv.gz'
            else:
                file = (STATIC / (route or path.lstrip('/'))).resolve()
                if not file.is_relative_to(STATIC.resolve()):
                    raise APIError('Not found', 404)
            if not file.is_file():
                raise APIError('Not found', 404)
            payload = file.read_bytes()
            mime = ('application/manifest+json' if file.suffix == '.webmanifest' else
                    'text/javascript' if file.suffix in ('.js', '.mjs') else
                    mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
            headers += [('Content-Type', mime), ('Cache-Control', 'no-cache')]
    except APIError as error:
        payload = json.dumps({'error': error.message}).encode()
        start_response(f'{error.status} Error', headers+[('Content-Type', 'application/json'), ('Content-Length', str(len(payload)))])
        return [payload]
    except Exception:
        payload = b'{"error":"Internal server error"}'
        start_response('500 Internal Server Error', headers+[('Content-Type', 'application/json')])
        return [payload]
    start_response('200 OK', headers+[('Content-Length', str(len(payload)))])
    return [payload]
