"""Validate the neutral static package without requiring its private lookup."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


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
