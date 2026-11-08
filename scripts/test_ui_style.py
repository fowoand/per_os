import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("check_ui_style", Path(__file__).with_name("check-ui-style.py"))
sys.dont_write_bytecode = True
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class StyleCheckTest(unittest.TestCase):
    def test_new_visual_values_and_component_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "screen.css"
            path.write_text(".new-card { color: red; padding: 13px; border-radius: 12px; }\n")
            errors = checker.check(path)
            self.assertTrue(any("component" in error for error in errors))
            self.assertTrue(any("padding" in error for error in errors))

    def test_tokenized_layout_passes_and_old_visual_style_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "screen.css"
            path.write_text(".layout { display: grid; gap: var(--po-space-4); }\n.old { color: red; }\n")
            self.assertTrue(any(".old" in error for error in checker.check(path)))
            path.write_text(".layout { display: grid; gap: var(--po-space-4); }\n")
            self.assertEqual(checker.check(path), [])

    def test_visual_style_must_live_in_base_even_with_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "screen.css"
            path.write_text(".new-card { color: var(--po-text); }\n")
            self.assertTrue(any("component" in error for error in checker.check(path)))


if __name__ == "__main__":
    unittest.main()
