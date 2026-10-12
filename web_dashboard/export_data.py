#!/usr/bin/env python3
"""Read-only, allowlisted dashboard export. No training, email, or network calls."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import statistics
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def number(value, integer=False):
    try:
        n = float(str(value).replace(",", "").strip())
        if not math.isfinite(n) or (integer and not n.is_integer()):
            return None
        return int(n) if integer else n
    except (ValueError, TypeError):
        return None


def read_daily(root):
    result = {}
    for path in sorted((root / "slotdata/anaslo_kicona_46_no_juggler").glob("????-??-??_daily.csv")):
        day = path.name[:10]
        date.fromisoformat(day)
        units = []
        seen = set()
        for r in rows(path):
            machine = r.get("機種名", "").strip()
            unit = number(r.get("台番号"), True)
            if r.get("日付") != day or unit is None or unit in seen or not machine:
                raise ValueError(f"Invalid/duplicate unit-day in {path.name}")
            seen.add(unit)
            if "ジャグラー" in machine:
                continue
            item = {"unit": unit, "machine": machine}
            for field, col in [("games", "G数"), ("diff", "差枚"), ("bb", "BB"), ("rb", "RB")]:
                item[field] = number(r.get(col), True)
            item["played"] = item["games"] is not None and item["games"] > 0
            units.append(item)
        if not units:
            raise ValueError(f"Empty daily export: {path.name}")
        result[day] = sorted(units, key=lambda r: r["unit"])
    if not result:
        raise ValueError("No daily source files")
    return result


def read_hits(root):
    grouped = defaultdict(list)
    bad = set()
    latest = None
    for path in sorted((root / "slotdata/papimo_kicona_chigasaki").glob("*_hits.csv")):
        file_rows = rows(path)
        unassignable = any(not DATE.fullmatch(r.get("日付", "")) for r in file_rows)
        file_keys = []
        bad_dates = set()
        for r in file_rows:
            day = r.get("日付", "")
            if not DATE.fullmatch(day):
                continue
            latest = max(latest or day, day)
            unit = number(r.get("台番"), True)
            if unit is None:
                bad_dates.add(day)
                continue
            key = (day, unit)
            file_keys.append(key)
            grouped[key].append({"machine": r.get("機種"), "time": r.get("時間", ""),
                                 "g": number(r.get("スタート"), True),
                                 "signal": r.get("ステータス", "").strip().upper(),
                                 "no": number(r.get("回数"), True)})
        bad.update(key for key in file_keys if unassignable or key[0] in bad_dates)
        # A malformed unit cannot establish that some other unit's table is safe.
        bad.update((day, None) for day in bad_dates)
    return grouped, bad, latest


def hit_detail(day, unit, events, bad):
    counts = Counter(e["signal"] for e in events)
    known = all(unit[k] is not None and unit[k] >= 0 for k in ("games", "bb", "rb"))
    duplicates = len({tuple(e.values()) for e in events}) != len(events)
    identity = any(e["machine"] != unit["machine"] for e in events)
    if not known:
        quality = "invalid_daily"
    elif not unit["played"]:
        quality = "no_play"
    elif (day, unit["unit"]) in bad or (day, None) in bad:
        quality = "invalid_events"
    elif identity:
        quality = "identity_mismatch"
    elif duplicates or any(e["signal"] not in ("BIG", "REG") for e in events):
        quality = "invalid_events"
    elif not events:
        quality = "missing"
    elif counts["BIG"] != unit["bb"] or counts["REG"] != unit["rb"]:
        quality = "counter_mismatch"
    elif any(e["g"] is None or e["g"] < 0 for e in events):
        quality = "invalid_start"
    else:
        quality = "complete"
    valid_time = all(re.fullmatch(r"(?:09|1\d|2[0-3]):[0-5]\d", e["time"]) for e in events)
    ties = defaultdict(list)
    for e in events:
        ties[e["time"]].append(e["no"])
    ambiguous = any(len(ns) > 1 and (None in ns or len(set(ns)) != len(ns)
                                   or any(n is not None and n <= 0 for n in ns)) for ns in ties.values())
    order = quality if quality != "complete" else (
        "invalid_time" if not valid_time else "ambiguous_order" if ambiguous else "complete")
    # Never attribute a misfiled machine's hit rows to the displayed machine.
    visible = [] if identity else sorted(events, key=lambda e: (e["time"], e["no"] or 0))
    return {"quality": quality, "order_quality": order,
            "visible_bb": counts["BIG"] if events else None,
            "visible_rb": counts["REG"] if events else None,
            "events": [{k: e[k] for k in ("time", "g", "signal", "no")} for e in visible]}


def curve_details(root, day):
    grouped = defaultdict(list)
    for r in rows(root / f"slotdata/anaslo_kicona_chigasaki/{day}_slot15.csv"):
        unit = number(r.get("台番号"), True)
        if unit is not None and r.get("日付") == day:
            grouped[unit].append([number(r.get("slot"), True), number(r.get("累計差枚"), True)])
    return grouped


def curve_detail(points, unit):
    if not points:
        return {"quality": "no_play" if unit["games"] == 0 else "missing", "points": []}
    valid = (len(points) >= 2 and all(p[0] is not None and p[1] is not None for p in points)
             and len({p[0] for p in points}) == len(points))
    if not valid:
        return {"quality": "invalid", "points": []}
    points = sorted(points)
    delta = points[-1][1] - unit["diff"] if unit["diff"] is not None else None
    return {"quality": "unverified_axis" if delta is not None and abs(delta) <= 250 else "end_mismatch",
            "end_delta": delta, "points": points}


def stats(units):
    played = [r for r in units if r["played"]]
    diffs = [r["diff"] for r in played if r["diff"] is not None]
    return {"units": len(units), "machines": len({r["machine"] for r in units}),
            "played": len(played), "no_play": sum(r["games"] == 0 for r in units),
            "games": sum(r["games"] or 0 for r in units), "total_diff": sum(diffs),
            "median_diff": statistics.median(diffs) if diffs else None,
            "positive_units": sum(v > 0 for v in diffs),
            "hits_complete": sum(r.get("hits", {}).get("quality") == "complete" for r in units)}


def archives(root, daily):
    result = {}
    mail_root = root / "prediction_analysis/daily_mail"
    for path in sorted(mail_root.glob("????-??-??/next_day_candidates_????-??-??.csv")):
        target = path.parent.name
        if not DATE.fullmatch(target):
            continue
        actual = {r["unit"]: r for r in daily.get(target, [])}
        candidates = []
        for r in rows(path):
            if r.get("target_date") != target or "ジャグラー" in r.get("machine", ""):
                continue
            unit = number(r.get("unit"), True)
            if unit is None:
                continue
            observed = actual.get(unit)
            matched = observed and observed["machine"] == r.get("machine")
            observed_diff = observed["diff"] if matched and observed["played"] else None
            candidates.append({"machine": r.get("machine"), "unit": unit,
                               "rank": number(r.get("rank_burst"), True),
                               "p_surge": number(r.get("p_surge")),
                               "binary_p_surge": number(r.get("binary_p_surge")),
                               "actual_diff": observed_diff,
                               "hit": None if observed_diff is None else observed_diff >= 3000})
        auc = []
        for r in rows(path.parent / f"machine_auc_{target}.csv"):
            if "ジャグラー" in r.get("machine", ""):
                continue
            positives, negatives = number(r.get("positives"), True), number(r.get("negatives"), True)
            eligible = positives is not None and negatives is not None and min(positives, negatives) > 0
            auc.append({"machine": r.get("machine"), "positives": positives, "negatives": negatives,
                        "auc": number(r.get("auc_displayed_surge_pooled")) if eligible else None,
                        "start": r.get("first_test_date"), "end": r.get("last_test_date"),
                        "status": r.get("sample_status")})
        weights = []
        for r in rows(path.parent / f"weight_watch_{target}.csv"):
            if r.get("target_date") != target or "ジャグラー" in r.get("machine", ""):
                continue
            asof = r.get("asof_date", "")
            if not DATE.fullmatch(asof) or asof >= target:
                continue
            weights.append({"machine": r.get("machine"), "unit": number(r.get("unit"), True),
                            "score": number(r.get("weight_score")), "status": r.get("score_status"),
                            "scope": r.get("watch_scope"), "asof": asof})
        result[target] = {"target_date": target, "source_cutoff": (date.fromisoformat(target) - timedelta(days=1)).isoformat(),
                          "candidates": candidates, "auc": auc, "weights": weights}
    return result


def js_data(key, value):
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    body = body.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f"window.KiconaData.deliver({json.dumps(key)}, {body});\n"


def write_if_changed(path, data):
    raw = data.encode("utf-8") if isinstance(data, str) else data
    if path.exists() and path.read_bytes() == raw:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(tmp, path)


def build(root=ROOT, output=HERE / "dist"):
    daily = read_daily(root)
    hits, bad, latest_hits = read_hits(root)
    days = sorted(daily)
    history = defaultdict(list)
    summaries = []
    generated = datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(timespec="seconds")
    status = {}
    for source in ("anaslo", "papimo"):
        path = root / f"data_col_claude/logs/status/{source}_last.json"
        if path.exists():
            info = json.loads(path.read_text())
            status[source] = {k: info.get(k) for k in ("status", "finished_at")}
    # Stage all reads/validation first: a failed export leaves the previous site intact.
    with tempfile.TemporaryDirectory(prefix="kicona-dashboard-") as tmp:
        stage = Path(tmp)
        for day in days:
            curves = curve_details(root, day)
            for unit in daily[day]:
                unit["hits"] = hit_detail(day, unit, hits.get((day, unit["unit"]), []), bad)
                unit["curve"] = curve_detail(curves.get(unit["unit"], []), unit)
                history[unit["unit"]].append({"date": day, **{k: unit[k] for k in ("machine", "games", "diff")}})
            summary = {"date": day, **stats(daily[day])}
            summaries.append(summary)
            write_if_changed(stage / f"data/days/{day}.js", js_data(f"day:{day}", {"date": day, "units": daily[day]}))
        for unit, observed in history.items():
            write_if_changed(stage / f"data/units/{unit}.js", js_data(f"unit:{unit}", observed))
        saved = archives(root, daily)
        for target, archive in saved.items():
            write_if_changed(stage / f"data/archives/{target}.js", js_data(f"archive:{target}", archive))
        rules = json.loads((root / "prediction_analysis/machine_signal_rules.json").read_text())
        dictionary = {r["machine"]: {k: r.get(k) for k in ("meaning", "evidence", "source_url")}
                      for r in rules["machines"] if "ジャグラー" not in r["machine"]}
        manifest = {"schema_version": 1, "generated_at": generated, "hall": "キコーナ茅ヶ崎店",
                    "scope": "1000円/46枚 · 非ジャグラー", "latest_date": days[-1], "first_date": days[0],
                    "days": list(reversed(summaries)), "latest_hits": latest_hits,
                    "archives": sorted(saved, reverse=True), "collection": status, "dictionary": dictionary,
                    "source_unit_days": sum(len(u) for u in daily.values())}
        write_if_changed(stage / "data/index.js", js_data("index", manifest))
        for asset in (HERE / "assets").iterdir():
            if asset.is_file() and asset.name in {"index.html", "app.js", "styles.css"}:
                shutil.copyfile(asset, stage / asset.name)
        write_if_changed(stage / ".nojekyll", "")
        files = sorted(p for p in stage.rglob("*") if p.is_file())
        # Manifest last. Each individual file is atomically replaced.
        files.sort(key=lambda p: p.relative_to(stage).as_posix() == "data/index.js")
        for path in files:
            write_if_changed(output / path.relative_to(stage), path.read_bytes())
    return {"latest_date": days[-1], "days": len(days), "unit_days": manifest["source_unit_days"],
            "latest_units": len(daily[days[-1]]), "latest_machines": summaries[-1]["machines"],
            "output_files": len(files), "generated_at": generated}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=HERE / "dist")
    args = parser.parse_args()
    print(json.dumps(build(args.root, args.output), ensure_ascii=False))
