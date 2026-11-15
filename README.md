# AEROL team starter

One interactive crew dashboard, a phone web-app layout, and a shared Python backend.
No bone-health features. No invented wearable readings or built-in TERRA predictor.

## Run in two steps

Requires Python 3.10+; the app has no third-party Python or JavaScript dependencies.

```sh
cd Aerol
python3 -m aerol
```

- Desktop: http://127.0.0.1:8000/
- Phone layout: http://127.0.0.1:8000/mobile/
- API health: http://127.0.0.1:8000/api/health

Both layouts use the same live Python API. The mobile path is an installable PWA,
not a native iOS/Android binary. All scripts, styles, icons and historical data are local.

## What works

- Interactive ISS radiation timeline with detector, date and duration controls.
- Solar-proton-event catalog markers, explicitly separated from ISS dose measurements.
- Actual dated Scott Kelly TERRA points and selectable exploratory correlations.
- Wearable readings: HR, RHR, RMSSD, estimated respiratory rate, wrist SpO2,
  skin temperature, acceleration and rotation.
- External readings: confirmed SpO2, blood pressure, ultrasound blood-flow velocity,
  WBC with full absolute differential, CRP, personal dosimetry and laboratory TERRA.
- Measurement entry, optional personal baseline, source, collection time and notes.
- Corrected-NN RMSSD calculation and three-axis motion calculation APIs.
- Local SQLite follow-up log and illustrative wristband alert walkthrough.
- Model input construction, quality checks, inference adapter and forecast UI.
- Offline public historical reference after the first successful online visit.

Stress, sleep and recovery are shown as unavailable until their own algorithms are
implemented. The website does not acquire raw PPG, ECG, cuff or lab data by itself:
the device team sends records through the API. See docs/API.md.

## Connect your prediction model

Edit `aerol/model_adapter.py`. Load your model once in that module, implement
`is_ready()` and `predict(features, horizon_days)`, and update `MODEL_INFO`.
Alternatively set `AEROL_MODEL_MODULE=your_package.your_adapter` before startup.

The model receives radiation features from the chosen historical ISS window.
Return the raw normalized TERRA abundance, not the UI's x1,000 display value:

```python
def predict(features, horizon_days):
    # Run your trained model here.
    return {"value": your_prediction, "explanation": your_summary}
```

`POST /api/predict` returns HTTP 503 until a model is installed. The supplied app
does not fit a model to the eight Scott samples or turn r into a dose-response curve.
Local crew vital signs are not silently joined to Scott's historic exposure. Extend
the input contract only when you have correctly matched subjects and timestamps.
See docs/MODEL_HANDOFF.md for units, response schema and an integration example.

## Open on a phone

For a browser preview on the same Wi-Fi:

```sh
python3 -m aerol --host 0.0.0.0 --port 8000
```

Visit `http://YOUR_COMPUTER_LAN_IP:8000/mobile/` on the phone. Do not enter 0.0.0.0
as the phone's destination. A local HTTP LAN preview can display the app but does
not normally enable service-worker/PWA installation. Use HTTPS hosting for a
phone installation. In Safari use Share → Add to Home Screen; in Chrome use its
Install app menu when available. A manifest and 192/512px icons are included.

The bundled WSGI development server is for local demonstration. For hosting, serve
`aerol.server:application` with a production WSGI server behind HTTPS. Preserve the
root URL paths. Set a persistent `AEROL_DB` file path for records. If API access
needs a token, set `AEROL_API_TOKEN`; enter it in the model screen to connect.
Keep authentication at the hosting layer before using non-public crew information.

## Data included

`aerol/data/iss-radiation.csv.gz` contains all **585,235** original public NASA
RadLab rows (DosTel1 and DosTel2, March 27, 2015 through March 2, 2016). The app
uses derived daily summaries for responsive rendering. Source URLs, SHA256,
data units and methods are in `aerol/data/snapshot.json` and docs/DATA.md.

TERRA is a normalized UUAGGG RNA motif abundance, not telomere length or a DNA
injury score. Station dosimetry is not personal dosimetry. Associations are
exploratory, one astronaut, and confounded by common time trends.

## Tests

```sh
python3 -m unittest discover -s tests -v
```

Unit tests cover provenance, persistence, validation, HRV, motion, matched-feature
calculations, missing coverage, model integration, token enforcement and routes.
No simulator alert is a live mission instruction. Data entry and logs stay local;
the app does not send messages or contact flight operations.

## Files to give the team

- `aerol/server.py`: Python API, SQLite storage, validation and radiation features.
- `aerol/model_adapter.py`: replace with the team's inference code.
- `aerol/static/index.html`, `mobile.html`, `app.js`, `styles.css`: both interfaces.
- `aerol/static/sw.js`, `manifest.webmanifest`, `icons/`: PWA installation/offline shell.
- `aerol/data/`: full source readings and display/reference data.
- `docs/`: API examples, model contract, scientific provenance and limitations.

Code is MIT licensed. Research data retain their original provider terms and
required citations; see docs/DATA.md. This package is supplied as source code,
not a published cloud deployment.
