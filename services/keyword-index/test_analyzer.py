"""The keyword sidecar's word-delimiter step gives exactly the parity table's forms, as the database's does."""

import json
import pathlib
import unittest

from analyzer import delimited

TABLE = pathlib.Path(__file__).resolve().parents[2] / "packages" / "engine" / "test" / "analyzer-cases.json"


class ParityTable(unittest.TestCase):
    def test_every_case(self) -> None:
        for text, forms in json.loads(TABLE.read_text())["cases"]:
            with self.subTest(text=text):
                self.assertEqual(sorted(set(delimited(text))), sorted(set(forms)))


if __name__ == "__main__":
    unittest.main()
