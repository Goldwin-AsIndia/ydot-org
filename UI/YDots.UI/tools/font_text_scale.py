"""
App-wide text size: routes every CSS `font-size` through the `--ui-text-scale` token.

--ui-text-scale (styles/ydot-responsive.css) shrinks or grows TYPE ONLY, independently of --ui-scale,
which also drives spacing. Each absolute font-size value V becomes `calc(V * var(--ui-text-scale, 1))`.
Relative values (em, %, ex, ch), keywords (inherit, smaller...) and 0 are left alone - they already
follow their parent. Idempotent: values that already mention the token are skipped.

    python tools/font_text_scale.py            # rewrite every .css under src/
    from font_text_scale import scale_font_sizes   # used by generate-dialog-styles.py
"""
import re
import sys
from pathlib import Path

TOKEN = "var(--ui-text-scale, 1)"

_DECL = re.compile(r"(?<![-\w])(font-size\s*:\s*)([^;}!]+?)(\s*!\s*important)?(\s*(?:;|}|$))", re.M)
_RELATIVE = re.compile(r"(?<![a-zA-Z])\d*\.?\d+\s*(em|ex|ch|%)(?![a-zA-Z])")
_KEYWORDS = {
    "inherit", "initial", "unset", "revert", "revert-layer", "smaller", "larger",
    "xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "0",
}


def _replace(match: re.Match) -> str:
    prop, value, important, tail = match.group(1), match.group(2).strip(), match.group(3) or "", match.group(4)
    if (
        "ui-text-scale" in value
        or value.lower() in _KEYWORDS
        or _RELATIVE.search(value)
    ):
        return match.group(0)
    return f"{prop}calc({value} * {TOKEN}){important}{tail}"


def scale_font_sizes(css: str) -> str:
    return _DECL.sub(_replace, css)


def main(root: Path) -> None:
    changed = 0
    for path in root.rglob("*.css"):
        if "assets" in path.relative_to(root).parts:  # vendor theme files stay as shipped
            continue
        with open(path, encoding="utf-8", newline="") as fh:  # keep each file's line endings
            text = fh.read()
        new = scale_font_sizes(text)
        if new != text:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            changed += 1
    print(f"font-size scaled in {changed} files")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "src")
