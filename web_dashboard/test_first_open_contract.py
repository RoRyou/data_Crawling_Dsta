import copy
import unittest

from verify_data import verify_first_open


class FirstOpenContractTests(unittest.TestCase):
    def record(self):
        return {"observations": 400, "event_detail": {
            "quality": "complete", "order_quality": "complete",
            "events": [{"time": "10:00", "step": 200, "signal": "E2"}]},
            "first_open_detail": {"quality": "complete", "step": 200,
                "step_quality": "observed", "amount": 1500,
                "amount_quality": "estimated", "depth_base": 600,
                "depth_ratio": 200 / 600, "entry_time": "10:00", "reason": "identified"}}

    def test_valid_independent_metrics(self):
        record = self.record()
        self.assertEqual(verify_first_open(record)["amount"], 1500)
        record["first_open_detail"].update(amount=None, amount_quality="unavailable")
        self.assertEqual(verify_first_open(record)["step"], 200)

    def test_lower_bound_is_preserved_not_promoted(self):
        record = self.record()
        record["first_open_detail"]["amount_quality"] = "lower_bound"
        self.assertEqual(verify_first_open(record)["amount_quality"], "lower_bound")

    def test_unknown_never_contains_zero_metrics(self):
        record = self.record()
        record["first_open_detail"] = {"quality": "missing", "step": None,
            "step_quality": "unavailable", "amount": None, "amount_quality": "unavailable",
            "depth_base": None, "depth_ratio": None, "entry_time": None, "reason": "missing"}
        verify_first_open(record)
        record["first_open_detail"]["amount"] = 0
        with self.assertRaises(ValueError):
            verify_first_open(record)

    def test_order_and_counter_evidence_required(self):
        for field in ("quality", "order_quality"):
            record = self.record()
            record["event_detail"][field] = "ambiguous_order"
            with self.assertRaises(ValueError):
                verify_first_open(record)

    def test_step_and_entry_must_match_daily(self):
        for change in ({"step": 201, "depth_ratio": 201 / 600}, {"entry_time": "10:01"}):
            record = self.record()
            record["first_open_detail"].update(change)
            with self.assertRaises(ValueError):
                verify_first_open(record)

    def test_ratio_and_reference_must_be_consistent(self):
        for change in ({"depth_base": None}, {"depth_base": 0}, {"depth_ratio": 0.5},
                       {"depth_ratio": float("nan")}):
            record = self.record()
            record["first_open_detail"].update(change)
            with self.assertRaises(ValueError):
                verify_first_open(record)

    def test_invalid_numeric_values_and_extra_fields_fail(self):
        original = self.record()
        for field, value in (("step", True), ("step", -1), ("amount", float("inf")),
                             ("amount", -1), ("amount", True), ("private_note", "not allowed")):
            record = copy.deepcopy(original)
            record["first_open_detail"][field] = value
            with self.assertRaises(ValueError):
                verify_first_open(record)


if __name__ == "__main__":
    unittest.main()
