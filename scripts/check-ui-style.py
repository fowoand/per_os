#!/usr/bin/env python3
"""Keep new UI styling on Radiant tokens and shared component treatments."""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "doc/design/radiant.css"
VISUAL = {"color", "box-shadow", "text-shadow", "opacity", "backdrop-filter", "line-height", "letter-spacing"}
SPACING = {"gap", "row-gap", "column-gap", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"}
LITERAL = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|linear-gradient|radial-gradient)\(|(?<![\w-])\d*\.?\d+(?:px|rem|em|vw|vh|svw|svh)\b")
VARIABLE = re.compile(r"var\(\s*(--[\w-]+)")
CLASS = re.compile(r"\.([a-zA-Z][\w-]*)")
USED_CLASS = re.compile(r"\bpo-[a-z][\w-]*\b")
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)


def rules(path):
    source = path.read_text()
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    for match in RULE.finditer(source):
        selector = match.group(1).split("}")[-1].strip()
        if selector.startswith("@"):
            continue
        for declaration in match.group(2).split(";"):
            if ":" not in declaration:
                continue
            prop, value = declaration.split(":", 1)
            prop, value = prop.strip().lower(), value.strip()
            if prop:
                line = source.count("\n", 0, match.start() + match.group(0).find(declaration)) + 1
                yield selector, prop, value, line


def is_visual(prop):
    return prop in VISUAL or prop.startswith(("background", "border", "font"))


def check(path):
    errors = []
    for selector, prop, value, line in rules(path):
        if prop.startswith("--"):
            errors.append(f"{path}:{line}: token mới chỉ được khai báo trong {BASE}")
        if (is_visual(prop) or prop in SPACING) and LITERAL.search(value):
            errors.append(f"{path}:{line}: {prop}: {value} dùng giá trị ngoài token Radiant")
        if is_visual(prop) and not VARIABLE.search(value) and value.lower() not in {"transparent", "currentcolor", "inherit", "initial", "unset", "none"} and not LITERAL.search(value):
            errors.append(f"{path}:{line}: {prop}: {value} cần dùng token Radiant")
        if is_visual(prop) or prop in SPACING:
            for variable in VARIABLE.findall(value):
                if not variable.startswith("--po-"):
                    errors.append(f"{path}:{line}: {variable} không thuộc token Radiant")
        if is_visual(prop):
            errors.append(f"{path}:{line}: kiểu component mới `{selector}`; đặt xử lý visual trong {BASE}")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--hook", action="store_true")
    args = parser.parse_args()
    files = args.files or [*ROOT.glob("apps/web/src/**/*.css"), ROOT / "doc/design/prototype.css"]
    errors = []
    for path in files:
        path = path.resolve()
        if path == BASE or not path.exists():
            continue
        errors.extend(check(path))
    approved = set(CLASS.findall(BASE.read_text()))
    for path in [ROOT / "doc/design/prototype.html", *ROOT.glob("apps/web/src/**/*.tsx")]:
        if not path.exists():
            continue
        for name in USED_CLASS.findall(path.read_text()):
            if name not in approved:
                errors.append(f"{path}: class `{name}` chưa có trong {BASE}")
    if args.hook:
        if errors:
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Radiant UI checker failed. Fix before continuing:\n" + "\n".join(errors[:12])}}, ensure_ascii=False))
        return 0
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Radiant UI style: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
