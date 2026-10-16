"""Validate the neutral static package without requiring its private lookup."""
import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def verify_first_open(record):
    """Fail closed on the new read-only daily first-event evidence contract."""
    detail = record.get("first_open_detail")
    keys = {"quality", "step", "step_quality", "amount", "amount_quality",
            "depth_base", "depth_ratio", "entry_time", "reason"}
    if not isinstance(detail, dict) or set(detail) != keys:
        raise ValueError("Invalid first-event detail fields")
    if any(not isinstance(detail[k], str) or not re.fullmatch(r"[a-z][a-z0-9_]*", detail[k])
           for k in ("quality", "reason")):
        raise ValueError("Invalid first-event quality code")
    if detail["step_quality"] not in {"observed", "unavailable"} or detail["amount_quality"] not in {
            "estimated", "lower_bound", "unavailable"}:
        raise ValueError("Invalid first-event metric quality")

    def numeric(value, integer=False):
        return (type(value) in (int, float) and math.isfinite(value) and value >= 0
                and (not integer or type(value) is int))

    known = detail["quality"] == "complete"
    if known:
        evidence = record["event_detail"]
        if (not numeric(record.get("observations"), integer=True) or record["observations"] <= 0
                or evidence["quality"] != "complete"
                or evidence["order_quality"] != "complete"):
            raise ValueError("First-event identity lacks complete ordered daily evidence")
        if (not isinstance(detail["entry_time"], str)
                or not re.fullmatch(r"(?:09|1\d|2[0-3]):[0-5]\d", detail["entry_time"])
                or not any(e["time"] == detail["entry_time"] for e in evidence["events"])):
            raise ValueError("First-event entry absent from daily evidence")
    elif any(detail[k] is not None for k in ("step", "amount", "depth_base", "depth_ratio", "entry_time")):
        raise ValueError("Unidentified first-event metrics must remain unknown")
    if detail["step_quality"] == "observed":
        if not known or not numeric(detail["step"], integer=True):
            raise ValueError("Invalid observed first-event interval")
        if not any(e["time"] == detail["entry_time"] and e["step"] == detail["step"]
                   for e in record["event_detail"]["events"]):
            raise ValueError("First-event interval differs from daily evidence")
    elif detail["step"] is not None:
        raise ValueError("Unavailable first-event interval must remain unknown")
    if detail["amount_quality"] != "unavailable":
        if not known or not numeric(detail["amount"]):
            raise ValueError("Invalid first-event increment estimate")
    elif detail["amount"] is not None:
        raise ValueError("Unavailable first-event increment must remain unknown")
    base, ratio = detail["depth_base"], detail["depth_ratio"]
    if base is None or ratio is None:
        if base is not None or ratio is not None:
            raise ValueError("Partial first-event reference ratio")
    elif (detail["step_quality"] != "observed" or not numeric(base) or base <= 0
          or not numeric(ratio) or not math.isclose(ratio, detail["step"] / base, rel_tol=1e-9, abs_tol=1e-9)):
        raise ValueError("Invalid first-event reference ratio")
    return detail


def read_payload(path):
    text = path.read_text(encoding="utf-8")
    match = re.fullmatch(r'window\.JournalData\.deliver\(("[^"]+"), (.*)\);\n?', text, re.S)
    if not match:
        raise ValueError(f"Invalid data envelope: {path.name}")
    return json.loads(match[1]), json.loads(match[2])


def verify(directory=ROOT / "dist"):
    directory = Path(directory)
    count = 0
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise ValueError("Unexpected symbolic link")
        if path.is_file():
            if ".private" in path.parts or ".local" in path.parts:
                raise ValueError("Local-only file in distribution")
            if re.search(r"https?://", path.read_text(encoding="utf-8")):
                raise ValueError("External reference in distribution")
    _, index = read_payload(directory / "data/index.js")
    if index.get("dictionary") != {} or index.get("dataset") != "D001":
        raise ValueError("Unexpected dataset metadata")
    labels = index.get("category_labels", {})
    if not isinstance(labels, dict) or any(not re.fullmatch(r"C\d{4,}", alias)
        or not isinstance(label, str) or not label.strip() or len(label) > 100
        or re.search(r"https?://|[\r\n]", label) for alias, label in labels.items()):
        raise ValueError("Invalid category display labels")
    if len(set(labels.values())) != len(labels):
        raise ValueError("Category display labels collide")
    for target in index["archives"]:
        key, archive = read_payload(directory / f"data/archives/{target}.js")
        if key != f"archive:{target}" or archive.get("target_date") != target:
            raise ValueError("Archive reference mismatch")
    interval_history = {}
    for summary in index["days"]:
        _, daily = read_payload(directory / f"data/days/{summary['date']}.js")
        if daily["date"] != summary["date"]:
            raise ValueError("Date mismatch")
        records = daily["entities"]
        if len({r["entity"] for r in records}) != len(records):
            raise ValueError("Duplicate entity-day")
        for r in records:
            if not re.fullmatch(r"C\d{4,}", r["category"]):
                raise ValueError("Invalid category alias")
            if index.get("schema_version", 0) >= 4 and r["category"] not in labels:
                raise ValueError("Category display name missing")
            if r["observations"] == 0 and r["observed"] is not False:
                raise ValueError("Zero-observation semantics changed")
            if any(e["signal"] not in ("E1", "E2") for e in r["event_detail"]["events"]):
                raise ValueError("Unknown event signal")
            if index.get("schema_version", 0) >= 3:
                detail = r["event_detail"]
                groups = []
                if detail["quality"] == "complete":
                    for signal, counter in (("E1", "counter_a"), ("E2", "counter_b")):
                        values = [e["step"] for e in detail["events"] if e["signal"] == signal]
                        if any(type(v) is not int or v < 0 for v in values) or len(values) != r[counter]:
                            raise ValueError("Complete event intervals disagree with daily counters")
                        groups.append({"signal": signal, "values": sorted(map(list, Counter(values).items()))})
                interval_history[(r["entity"], daily["date"])] = {
                    "date": daily["date"], **{k:r[k] for k in ("category", "observations", "delta", "counter_a", "counter_b")},
                    "interval_detail": {"quality": detail["quality"], "order_quality": detail["order_quality"], "groups": groups}}
                if index.get("schema_version", 0) >= 5:
                    interval_history[(r["entity"], daily["date"])]["first_open_detail"] = verify_first_open(r)
        if len(records) != summary["entities"]:
            raise ValueError("Summary count mismatch")
        count += len(records)
    if count != index["source_entity_days"]:
        raise ValueError("Total count mismatch")
    if index.get("schema_version", 0) >= 3:
        for path in (directory / "data/units").glob("*.js"):
            if not re.fullmatch(r"\d+", path.stem):
                raise ValueError("Invalid entity history path")
            entity = int(path.stem)
            key, history = read_payload(path)
            if key != f"entity:{entity}":
                raise ValueError("Entity history envelope mismatch")
            for row in history:
                expected = interval_history.pop((entity, row["date"]), None)
                if expected is None or row != expected:
                    raise ValueError("Entity interval history differs from daily evidence")
        if interval_history:
            raise ValueError("Entity interval history is incomplete")
    return {"latest_date": index["latest_date"], "days": len(index["days"]), "entity_days": count}


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False))
