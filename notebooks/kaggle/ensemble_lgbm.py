"""Ансамбль: профиль 4 недель + остаток LightGBM.

Вес остатка выбирается по апрелю–маю (срез 31 марта). Сентябрь–октябрь
считается моделью, которая эти месяцы не видела. Ноябрь–декабрь пишется
от среза 31 октября.
"""

from __future__ import annotations

import csv
from datetime import date, timedelta
from pathlib import Path

import lightgbm as lgb
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
LABELS = ROOT / "data" / "kaggle_mstrans"
ENR = ROOT / "data" / "kaggle_enrichment"
OUT = ROOT / "BERT" / "submission_ensemble.csv"

ROUTES = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50]
START = date(2025, 1, 1)
END = date(2025, 12, 31)
SNOW = {71, 73, 75, 77, 85, 86}
RAIN = {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99}
# Четверти: зима 30.12.2024–12.01.2025, весна 24–31.03.2025,
# лето с 26.05.2025, осень 25.10–02.11.2025, зима с 31.12.2025.
QUARTER_BREAKS = (
    (date(2025, 1, 1), date(2025, 1, 12)),
    (date(2025, 3, 24), date(2025, 3, 31)),
    (date(2025, 5, 26), date(2025, 8, 31)),
    (date(2025, 10, 25), date(2025, 11, 2)),
    (date(2025, 12, 31), date(2025, 12, 31)),
)
# Модули: 29.12.2024–08.01.2025, 15–24.02, 05–13.04, лето с 31.05,
# затем 04–12.10, 15–23.11 и 31.12.2025.
MODULE_BREAKS = (
    (date(2025, 1, 1), date(2025, 1, 8)),
    (date(2025, 2, 15), date(2025, 2, 24)),
    (date(2025, 4, 5), date(2025, 4, 13)),
    (date(2025, 5, 31), date(2025, 8, 31)),
    (date(2025, 10, 4), date(2025, 10, 12)),
    (date(2025, 11, 15), date(2025, 11, 23)),
    (date(2025, 12, 31), date(2025, 12, 31)),
)
SUMMER_BREAK = (date(2025, 5, 26), date(2025, 8, 31))
MORNING_PEAK = {7, 8, 9}
EVENING_PEAK = {17, 18, 19}
FEATURE_NAMES = [
    "route", "hour", "dow", "days_ahead",
    "weekend", "day_off", "preholiday", "short_day", "holiday_id", "is_holiday",
    "quarter_break", "module_break", "summer_break", "school_off_share",
    "morning_peak", "evening_peak", "weekday_peak",
    "base", "lag1", "lag2", "lag3", "lag4", "n_lags",
    "temp", "precip", "wind", "snowfall", "rain", "snow",
    "offices", "acc7", "acc30", "tram7", "route_level",
]
CATEGORICAL = ["route", "hour", "dow", "holiday_id"]


def daterange(start, end):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def in_ranges(day, ranges):
    return any(start <= day <= end for start, end in ranges)


def school_calendar(day):
    quarter = int(in_ranges(day, QUARTER_BREAKS))
    module = int(in_ranges(day, MODULE_BREAKS))
    summer = int(SUMMER_BREAK[0] <= day <= SUMMER_BREAK[1])
    if summer or (quarter and module):
        share = 1.0
    elif quarter or module:
        share = 0.5
    else:
        share = 0.0
    return quarter, module, summer, share


def ewm(values):
    if not values:
        return 0.0
    total = weight = 0.0
    for index, value in enumerate(values):
        factor = 0.75 ** index
        total += factor * value
        weight += factor
    return total / weight


def load():
    days = list(daterange(START, END))
    index = {day: pos for pos, day in enumerate(days)}
    series = np.zeros((len(ROUTES), len(days), 24), np.float32)
    observed = {}
    for name in ("labels_day_train.csv", "labels_day_test.csv"):
        with (LABELS / name).open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle, delimiter=";"):
                observed[(int(row["route"]), date.fromisoformat(row["date"]), int(row["hour"]))] = float(row["boardings"])
    route_pos = {route: pos for pos, route in enumerate(ROUTES)}
    for (route, day, hour), value in observed.items():
        pos = index.get(day)
        row = route_pos.get(route)
        if pos is None or row is None or day > date(2025, 10, 31):
            continue
        series[row, pos, hour] = value

    holiday_name = {}
    flags = {}
    with (ENR / "holidays_2025.csv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            day = date.fromisoformat(row["date"])
            name = row["holiday"] or "none"
            holiday_name[day] = name
            flags[day] = (
                int(row["day_off"]),
                int(row["weekend"]),
                int(row["preholiday"]),
                int(row["short_day"]),
                int(name not in ("none", "")),
            )
    names = sorted({name for name in holiday_name.values() if name not in ("none", "")})
    holiday_id = {name: pos + 1 for pos, name in enumerate(names)}

    weather = {}
    with (ENR / "weather_hourly.csv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            weather[(int(row["route"]), date.fromisoformat(row["date"]), int(row["hour"]))] = (
                float(row["temp"]),
                float(row["precip"]),
                float(row["wind"]),
                int(float(row["code"])),
                float(row["snowfall"]),
            )
    office = {}
    with (ENR / "route_day.csv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            office[(int(row["route"]), date.fromisoformat(row["date"]))] = (
                float(row["offices"]),
                float(row["acc7"]),
                float(row["acc30"]),
                float(row["tram7"]),
            )
    return days, index, series, holiday_name, holiday_id, flags, weather, office


def day_regime(day, holiday_name):
    if holiday_name.get(day, "none") not in ("none", ""):
        return "holiday"
    _quarter, _module, summer, share = school_calendar(day)
    if summer:
        return "summer"
    if share > 0:
        return "short"
    return "school"


def context_at(series, days, index, holiday_name, office, cutoff):
    cutoff_pos = index[cutoff]
    weekly = np.zeros((len(ROUTES), 7, 24), np.float32)
    regime_profile = {
        kind: np.zeros((len(ROUTES), 7, 24), np.float32)
        for kind in ("school", "short", "summer")
    }
    regime_count = {
        kind: np.zeros((len(ROUTES), 7, 24), np.float32)
        for kind in ("school", "short", "summer")
    }
    lags = np.zeros((len(ROUTES), 7, 24, 4), np.float32)
    n_lags = np.zeros((len(ROUTES), 7, 24), np.float32)
    for route in range(len(ROUTES)):
        for dow in range(7):
            pos = cutoff_pos
            while pos >= 0 and days[pos].weekday() != dow:
                pos -= 1
            for hour in range(24):
                values = []
                regime_values = {kind: [] for kind in regime_profile}
                cursor = pos
                while cursor >= 0 and (
                    len(values) < 4 or any(len(pool) < 4 for pool in regime_values.values())
                ):
                    value = float(series[route, cursor, hour])
                    if len(values) < 4:
                        values.append(value)
                    kind = day_regime(days[cursor], holiday_name)
                    if kind in regime_values and len(regime_values[kind]) < 4:
                        regime_values[kind].append(value)
                    cursor -= 7
                n_lags[route, dow, hour] = len(values)
                for slot, value in enumerate(values):
                    lags[route, dow, hour, slot] = value
                weekly[route, dow, hour] = ewm(values)
                for kind, pool in regime_values.items():
                    regime_profile[kind][route, dow, hour] = ewm(pool)
                    regime_count[kind][route, dow, hour] = len(pool)
    regime_ratio = {}
    for kind in ("short", "summer"):
        matched = np.zeros((len(ROUTES), 24), np.float32)
        regular = np.zeros((len(ROUTES), 24), np.float32)
        matched_days = regular_days = 0
        for pos in range(cutoff_pos + 1):
            current = day_regime(days[pos], holiday_name)
            if current == kind:
                matched += series[:, pos, :]
                matched_days += 1
            elif current == "school":
                regular += series[:, pos, :]
                regular_days += 1
        ratio = np.ones((len(ROUTES), 24), np.float32)
        if matched_days >= 5 and regular_days >= 5:
            regular_mean = regular / regular_days
            usable = regular_mean > 1
            ratio[usable] = (matched[usable] / matched_days) / regular_mean[usable]
        regime_ratio[kind] = np.clip(ratio, 0.45, 1.05)
    holiday_base = np.zeros((len(ROUTES), 24), np.float32)
    holiday_days = [
        index[day]
        for day, name in holiday_name.items()
        if name not in ("none", "") and day <= cutoff
    ]
    holiday_days.sort(reverse=True)
    for route in range(len(ROUTES)):
        for hour in range(24):
            pool = [float(series[route, pos, hour]) for pos in holiday_days[:6]]
            holiday_base[route, hour] = ewm(pool) if len(pool) >= 2 else 0.0
    level = series[:, max(0, cutoff_pos - 13):cutoff_pos + 1].mean(axis=(1, 2))
    office_at = []
    for route in ROUTES:
        office_at.append(office.get((route, cutoff), (0.0, 0.0, 0.0, 0.0)))
    return (
        weekly, lags, n_lags, holiday_base, level, np.asarray(office_at, np.float32),
        regime_profile, regime_count, regime_ratio,
    )


def build_frame(bundle, cutoff, first, last, with_target):
    days, index, series, holiday_name, holiday_id, flags, weather, office = bundle
    weekly, lags, n_lags, holiday_base, level, office_at, regime_profile, regime_count, regime_ratio = context_at(
        series, days, index, holiday_name, office, cutoff
    )
    cutoff_pos = index[cutoff]
    positions = [index[day] for day in daterange(first, last) if day > cutoff and (index[day] - cutoff_pos) <= 61]
    rows = len(positions) * len(ROUTES) * 24
    frame = np.zeros((rows, len(FEATURE_NAMES)), np.float32)
    target = np.zeros(rows, np.float32) if with_target else None
    base_col = FEATURE_NAMES.index("base")
    cursor = 0
    for pos in positions:
        day = days[pos]
        ahead = pos - cutoff_pos
        day_off, weekend, preholiday, short_day, is_holiday = flags[day]
        name = holiday_name[day]
        dow = day.weekday()
        quarter, module, summer, school_share = school_calendar(day)
        for route, route_no in enumerate(ROUTES):
            for hour in range(24):
                # Календарь остаётся признаком. База — последние 4 такие же недели,
                # иначе октябрьские недели выпадают из прогноза ноября.
                if is_holiday and holiday_base[route, hour] > 0:
                    base = float(holiday_base[route, hour])
                else:
                    base = float(weekly[route, dow, hour])
                morning_peak = int(hour in MORNING_PEAK)
                evening_peak = int(hour in EVENING_PEAK)
                weekday_peak = int((morning_peak or evening_peak) and not weekend and not is_holiday)
                temp, precip, wind, code, snowfall = weather.get((route_no, day, hour), (0.0, 0.0, 0.0, 0, 0.0))
                snow = int(snowfall > 0 or code in SNOW)
                rain = int((not snow) and (precip >= 0.2 or code in RAIN))
                offices, acc7, acc30, tram7 = office_at[route]
                frame[cursor] = (
                    route_no, hour, dow, ahead,
                    weekend, day_off, preholiday, short_day, holiday_id.get(name, 0), is_holiday,
                    quarter, module, summer, school_share,
                    morning_peak, evening_peak, weekday_peak,
                    base, lags[route, dow, hour, 0], lags[route, dow, hour, 1],
                    lags[route, dow, hour, 2], lags[route, dow, hour, 3], n_lags[route, dow, hour],
                    temp, precip, wind, snowfall, rain, snow,
                    offices, acc7, acc30, tram7, level[route],
                )
                if with_target:
                    target[cursor] = series[route, pos, hour] - base
                cursor += 1
    return frame, target


def collect_training(bundle, last_target, step_days):
    days, index, *_rest = bundle
    frames = []
    targets = []
    cutoff = START + timedelta(days=28)
    while cutoff < last_target:
        horizon_last = min(last_target, cutoff + timedelta(days=61))
        if horizon_last > cutoff:
            frame, target = build_frame(bundle, cutoff, cutoff + timedelta(days=1), horizon_last, True)
            if len(frame):
                frames.append(frame)
                targets.append(target)
        cutoff += timedelta(days=step_days)
    return np.concatenate(frames), np.concatenate(targets)


def fit(frame, target):
    categorical = [FEATURE_NAMES.index(name) for name in CATEGORICAL]
    split = int(len(frame) * 0.9)
    train = lgb.Dataset(frame[:split], label=target[:split], feature_name=FEATURE_NAMES, categorical_feature=categorical, free_raw_data=False)
    valid = lgb.Dataset(frame[split:], label=target[split:], feature_name=FEATURE_NAMES, categorical_feature=categorical, reference=train, free_raw_data=False)
    return lgb.train(
        {
            "objective": "regression_l1",
            "learning_rate": 0.05,
            "num_leaves": 31,
            "min_child_samples": 200,
            "lambda_l2": 1.0,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 1,
            "verbosity": -1,
            "seed": 7,
        },
        train,
        num_boost_round=400,
        valid_sets=[valid],
        callbacks=[lgb.early_stopping(40, verbose=False)],
    )


def score_window(bundle, model, cutoff, first, last, weight):
    frame, residual = build_frame(bundle, cutoff, first, last, True)
    base = frame[:, FEATURE_NAMES.index("base")]
    holiday = frame[:, FEATURE_NAMES.index("is_holiday")] > 0
    actual = residual + base
    correction = model.predict(frame)
    delta = weight * correction
    limit = 0.15 * np.maximum(base, 1.0)
    delta = np.clip(delta, -limit, limit)
    delta[holiday] = 0.0
    forecast = np.maximum(0.0, base + delta)
    absolute = np.abs(forecast - actual).sum()
    denom = actual.sum()
    return float(absolute / denom), float(1.0 - absolute / denom), float(np.abs(correction).mean())


def choose_weight(bundle, model, cutoff, first, last):
    best = None
    for weight in (0.0, 0.05, 0.1, 0.2, 0.35, 0.5, 1.0):
        error, value, magnitude = score_window(bundle, model, cutoff, first, last, weight)
        print(f"  weight {weight:.2f} WAPE {error:.4f} score {value:.4f} mean|corr| {magnitude:.1f}")
        if best is None or value > best[0]:
            best = (value, weight, error)
    return best


def write_submission(bundle, model, weight):
    days, index, *_rest = bundle
    frame, _residual = build_frame(bundle, date(2025, 10, 31), date(2025, 11, 1), date(2025, 12, 31), False)
    base = frame[:, FEATURE_NAMES.index("base")]
    holiday = frame[:, FEATURE_NAMES.index("is_holiday")] > 0
    delta = weight * model.predict(frame)
    limit = 0.15 * np.maximum(base, 1.0)
    delta = np.clip(delta, -limit, limit)
    delta[holiday] = 0.0
    forecast = np.maximum(0.0, base + delta)
    lookup = {}
    cursor = 0
    for day in daterange(date(2025, 11, 1), date(2025, 12, 31)):
        for route in ROUTES:
            for hour in range(24):
                lookup[(route, day.isoformat(), hour)] = int(round(float(forecast[cursor])))
                cursor += 1
    template = LABELS / "test_submission.csv"
    with template.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    missing = 0
    for row in rows:
        key = (int(row["route"]), row["date"], int(row["hour"]))
        if key not in lookup:
            missing += 1
            row["prediction"] = "0"
        else:
            row["prediction"] = str(lookup[key])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["route", "date", "hour", "prediction"], delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    values = [int(row["prediction"]) for row in rows]
    print(f"submission {OUT} rows {len(rows)} missing {missing} mean {sum(values) / len(values):.1f} zeros {sum(value == 0 for value in values)}")


def main():
    bundle = load()
    print("train through Mar 31, choose weight on Apr-May")
    frame, target = collect_training(bundle, date(2025, 3, 31), 3)
    print(f"rows {len(frame)}")
    model = fit(frame, target)
    value, weight, error = choose_weight(bundle, model, date(2025, 3, 31), date(2025, 4, 1), date(2025, 5, 31))
    print(f"chosen weight {weight:.2f} apr-may score {value:.4f} WAPE {error:.4f}")

    print("train through Aug 31, score Sep-Oct with frozen weight")
    frame, target = collect_training(bundle, date(2025, 8, 31), 3)
    print(f"rows {len(frame)}")
    model = fit(frame, target)
    for trial in (0.0, weight):
        error, value, _magnitude = score_window(bundle, model, date(2025, 8, 31), date(2025, 9, 1), date(2025, 10, 31), trial)
        label = "profile" if trial == 0.0 else "ensemble"
        print(f"sep-oct {label} weight {trial:.2f} WAPE {error:.4f} score {value:.4f}")

    print("refit through Oct 31 for Nov-Dec")
    frame, target = collect_training(bundle, date(2025, 10, 31), 3)
    print(f"rows {len(frame)}")
    model = fit(frame, target)
    importance = sorted(zip(FEATURE_NAMES, model.feature_importance()), key=lambda item: -item[1])
    print("importance", ", ".join(f"{name} {score}" for name, score in importance[:8]))
    write_submission(bundle, model, weight)


if __name__ == "__main__":
    main()
