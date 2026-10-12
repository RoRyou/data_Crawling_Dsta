import csv
import json
import tempfile
import unittest
from pathlib import Path

from export_data import archives, build, curve_detail, hit_detail, js_data, number, read_daily, read_hits


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.unit = {"unit": 633, "machine": "東京喰種", "games": 800, "diff": -100,
                     "bb": 1, "rb": 1, "played": True}
        self.events = [{"machine": "東京喰種", "time": "10:00", "g": 200, "signal": "REG", "no": None},
                       {"machine": "東京喰種", "time": "10:03", "g": 2, "signal": "BIG", "no": 1}]

    def tearDown(self):
        self.tmp.cleanup()

    def csv(self, relative, records):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=records[0].keys())
            writer.writeheader()
            writer.writerows(records)
        return path

    def daily(self, **changes):
        r = {"日付": "2026-10-11", "機種名": "東京喰種", "台番号": "633", "G数": "800",
             "差枚": "-100", "BB": "1", "RB": "1"}
        r.update(changes)
        return r

    def detail(self, **changes):
        return hit_detail("2026-10-11", {**self.unit, **changes}, self.events, set())

    def test_complete_with_optional_reg_number(self):
        self.assertEqual(self.detail()["order_quality"], "complete")

    def test_count_mismatch_is_not_complete(self):
        self.assertEqual(self.detail(bb=2)["quality"], "counter_mismatch")

    def test_zero_play_not_negative_evidence(self):
        self.assertEqual(self.detail(games=0, played=False)["quality"], "no_play")

    def test_missing_table_not_observed_zero(self):
        q = hit_detail("2026-10-11", {**self.unit,"bb":0,"rb":0}, [], set())
        self.assertEqual(q["quality"], "missing")
        self.assertIsNone(q["visible_bb"])

    def test_wrong_machine_rows_not_displayed(self):
        q = self.detail(machine="別機種")
        self.assertEqual(q["quality"], "identity_mismatch")
        self.assertEqual(q["events"], [])

    def test_order_not_invented(self):
        self.events[1]["time"]="10:00"
        self.assertEqual(self.detail()["order_quality"], "ambiguous_order")

    def test_duplicates_rejected(self):
        self.events.append(self.events[0].copy())
        self.assertEqual(self.detail()["quality"], "invalid_events")

    def test_bad_start_not_zero(self):
        self.events[0]["g"]=None
        self.assertEqual(self.detail()["quality"], "invalid_start")

    def test_curve_axis_unverified(self):
        q=curve_detail([[0,0],[1,-120]],self.unit)
        self.assertEqual(q["quality"],"unverified_axis")
        self.assertEqual(q["end_delta"],-20)

    def test_curve_gap_not_filled(self):
        self.assertEqual(curve_detail([], self.unit)["points"], [])
        self.assertEqual(curve_detail([[0,0],[1,-2000]], self.unit)["quality"], "end_mismatch")

    def test_read_daily_duplicate_fails(self):
        self.csv("slotdata/anaslo_kicona_46_no_juggler/2026-10-11_daily.csv", [self.daily(),self.daily()])
        with self.assertRaises(ValueError): read_daily(self.root)

    def test_juggler_excluded_invalid_numeric_not_filled(self):
        self.csv("slotdata/anaslo_kicona_46_no_juggler/2026-10-11_daily.csv", [self.daily(G数=""),self.daily(台番号="500",機種名="ジャグラー")])
        data=read_daily(self.root)["2026-10-11"]
        self.assertEqual(len(data),1)
        self.assertIsNone(data[0]["games"])

    def test_archive_unchanged_probability_and_zero_unknown(self):
        prefix="prediction_analysis/daily_mail/2026-10-11/"
        self.csv(prefix+"next_day_candidates_2026-10-11.csv", [{"target_date":"2026-10-11","machine":"東京喰種","unit":"633","rank_burst":"1","p_surge":"0.123"}])
        self.csv(prefix+"machine_auc_2026-10-11.csv", [{"machine":"東京喰種","positives":"0","negatives":"20","auc_displayed_surge_pooled":"0.9"}])
        a=archives(self.root, {"2026-10-11":[{**self.unit,"diff":5000,"played":False}]})["2026-10-11"]
        self.assertEqual(a["candidates"][0]["p_surge"],0.123)
        self.assertIsNone(a["candidates"][0]["hit"])
        self.assertIsNone(a["auc"][0]["auc"])

    def test_export_whitelist_and_date_freshness(self):
        self.csv("slotdata/anaslo_kicona_46_no_juggler/2026-10-11_daily.csv", [self.daily()])
        p=self.root/"prediction_analysis/machine_signal_rules.json"
        p.parent.mkdir(parents=True);p.write_text(json.dumps({"machines":[]}))
        (self.root/"secret.env").write_text("PASSWORD=DO_NOT_EXPORT")
        output=self.root/"out"
        summary=build(self.root,output)
        self.assertEqual(summary["latest_date"],"2026-10-11")
        self.assertEqual(summary["latest_units"],1)
        combined="".join(p.read_text() for p in output.rglob("*") if p.is_file())
        self.assertNotIn("DO_NOT_EXPORT",combined)
        self.assertNotIn(str(self.root),combined)

    def test_script_safe(self):
        self.assertNotIn("</script>",js_data("test",{"name":"</script>"}))
        self.assertIsNone(number("NaN"))
        self.assertIsNone(number("1.5",True))


if __name__ == "__main__":
    unittest.main()
