"""Validate the neutral static package without requiring its private lookup."""
import json
import re
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
        if len(records) != summary["entities"]:
            raise ValueError("Summary count mismatch")
        count += len(records)
    if count != index["source_entity_days"]:
        raise ValueError("Total count mismatch")
    return {"latest_date": index["latest_date"], "days": len(index["days"]), "entity_days": count}


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False))
