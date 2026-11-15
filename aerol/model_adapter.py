"""The team's single integration point for a trained prediction model.

Replace is_ready() and predict() with your model-loading and inference code.
The app never turns a historical correlation into a prediction automatically.
"""

MODEL_INFO = {
    'name': 'Team prediction model', 'version': 'not-installed',
    'target': 'terra_uuaggg_normalized_abundance',
    'units': 'normalized_abundance', 'validated': False,
}


def is_ready():
    return False


def predict(features, horizon_days):
    """Return {'value': float, 'explanation': str}; optional lower/upper bounds.

    features contains station radiation, time coverage, flight day and provenance.
    The target is the source RNA motif abundance (e.g. 0.002), NOT its display
    multiplication by 1,000, telomere length, a personal radiation dose or risk.
    Do not train a clinical predictor from these eight samples alone.
    """
    raise NotImplementedError('Connect the team model in aerol/model_adapter.py')
