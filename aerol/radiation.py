"""Server-side ionizing-radiation integration (mirrors aerol/static/core/radiation.js).

r(t) = dD/dt.  D(t + Δt) = D(t) + r(t) · Δt_days for piecewise-constant intervals.
Absorbed dose (Gy) is never relabeled as dose equivalent (Sv).
"""
HOUR_MS = 3600000
DAY_MS = 86400000
RATE_SCALE = {'mSv/day': 1.0, 'µSv/h': 24 / 1000, 'uSv/h': 24 / 1000}
TOTAL_SCALE = {'mSv': 1.0, 'µSv': 1 / 1000, 'uSv': 1 / 1000}


def integrate_pieces(pieces):
    return sum(p['rate'] * p['days'] for p in pieces)


def worked_checks():
    a = integrate_pieces([{'days': 7, 'rate': 0.7}, {'days': 3, 'rate': 1.84}])
    b = integrate_pieces([{'days': 340, 'rate': 1.84}])
    return [
        {'id': 'mixed_10_day', 'expected': 10.42, 'computed': round(a, 6), 'pass': abs(a - 10.42) < 1e-9},
        {'id': 'constant_340_day', 'expected': 625.6, 'computed': round(b, 6), 'pass': abs(b - 625.6) < 1e-9,
         'note': 'Hypothetical arithmetic projection, not the Twins Study exposure (76.18 mGy physical / 146.34 mSv effective).'},
    ]


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float('inf'), float('-inf'))


def ingest_readings(readings, max_gap_hours=2.0, transitions=()):
    """readings: [{t (ms), device_id, kind: 'rate'|'cumulative', value, unit, interval_start?, interval_end?}]"""
    rep = {'total_mSv': 0.0, 'increments': [], 'gaps': [], 'resets': [], 'duplicates_dropped': 0,
           'conflicts': [], 'rejected': [], 'notes': [], 'coverage_hours': 0.0}
    clean, seen = [], {}
    for r in readings:
        if not _num(r.get('t')) or not _num(r.get('value')):
            rep['rejected'].append({'reading': r, 'reason': 'missing timestamp or value (null is kept as missing, never zero)'})
            continue
        scale = (RATE_SCALE if r.get('kind') == 'rate' else TOTAL_SCALE).get(r.get('unit'))
        if scale is None:
            rep['rejected'].append({'reading': r, 'reason': f"unit {r.get('unit')} is not a supported dose-equivalent unit; absorbed dose (Gy) is not relabeled as Sv"})
            continue
        key = (r.get('device_id'), r.get('kind'), r['t'])
        v = r['value'] * scale
        if key in seen:
            if abs(seen[key] - v) < 1e-12:
                rep['duplicates_dropped'] += 1
            else:
                rep['conflicts'].append({'t': r['t'], 'device_id': r.get('device_id'), 'kept': seen[key], 'dropped': v})
            continue
        seen[key] = v
        clean.append(dict(r, v=v))
    max_gap = max_gap_hours * HOUR_MS
    tx = sorted(t for t in transitions if _num(t))
    for device in sorted({r.get('device_id') for r in clean}, key=str):
        rows = sorted((r for r in clean if r.get('device_id') == device), key=lambda r: r['t'])
        cum = [r for r in rows if r['kind'] == 'cumulative']
        rates = [r for r in rows if r['kind'] == 'rate']
        if len(cum) >= 2:
            if rates:
                rep['notes'].append(f'{device}: {len(rates)} rate readings ignored because a cumulative counter covers the device.')
            for a, b in zip(cum, cum[1:]):
                dose, method = b['v'] - a['v'], 'cumulative_difference'
                if dose < 0:
                    rep['resets'].append({'device_id': device, 't': b['t']})
                    rep['gaps'].append({'device_id': device, 't0': a['t'], 't1': b['t'], 'reason': 'counter_reset_unrecorded_interval'})
                    dose, method = b['v'], 'counter_reset'
                rep['increments'].append({'device_id': device, 't0': a['t'], 't1': b['t'], 'dose': dose, 'method': method})
                rep['coverage_hours'] += (b['t'] - a['t']) / HOUR_MS
            continue
        inst = [r for r in rates if not (_num(r.get('interval_start')) and _num(r.get('interval_end')))]
        last_end = None
        for r in sorted((r for r in rates if r not in inst), key=lambda r: r['interval_start']):
            start = r['interval_start'] if last_end is None else max(r['interval_start'], last_end)
            if r['interval_end'] <= start:
                continue
            if last_end is not None and start - last_end > max_gap:
                rep['gaps'].append({'device_id': device, 't0': last_end, 't1': start})
            rep['increments'].append({'device_id': device, 't0': start, 't1': r['interval_end'], 'dose': r['v'] * (r['interval_end'] - start) / DAY_MS, 'method': 'rate_x_interval'})
            rep['coverage_hours'] += (r['interval_end'] - start) / HOUR_MS
            last_end = r['interval_end']
        for a, b in zip(inst, inst[1:]):
            if b['t'] - a['t'] > max_gap:
                rep['gaps'].append({'device_id': device, 't0': a['t'], 't1': b['t']})
                continue
            cut = next((x for x in tx if a['t'] < x < b['t']), None)
            if cut is not None:
                dose, method = (a['v'] * (cut - a['t']) + b['v'] * (b['t'] - cut)) / DAY_MS, 'split_at_transition'
            else:
                dose, method = (a['v'] + b['v']) / 2 * (b['t'] - a['t']) / DAY_MS, 'trapezoid'
            rep['increments'].append({'device_id': device, 't0': a['t'], 't1': b['t'], 'dose': dose, 'method': method})
            rep['coverage_hours'] += (b['t'] - a['t']) / HOUR_MS
    rep['increments'].sort(key=lambda x: x['t1'])
    rep['total_mSv'] = sum(i['dose'] for i in rep['increments'])
    return rep
