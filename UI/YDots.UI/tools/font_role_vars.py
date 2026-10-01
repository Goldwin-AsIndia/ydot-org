"""
App-wide per-role text size and weight, driven by the Theme settings panel.

The panel writes, on <html>, one size multiplier and one weight step per type role (title, heading, body,
number, menu): `--ts-<role>` and `--fwb-<role>`. styles/ydot-typography.css turns those into `--rs-<role>`
(the final text scale) and exposes them. This tool wires every stylesheet to them, in two passes:

1. ROLE: a rule that sets `font-family: var(--font-display | --font-heading | --font-body | --font-number |
   --font-menu ...)` also gets `--ui-text-scale: var(--rs-<role>)` and `--fw-bias: var(--fwb-<role>)`. Custom
   properties inherit, so everything inside that element follows its role too. Every font-size in the app is
   already `calc(V * var(--ui-text-scale, 1))` (font_text_scale.py), so the size follows the role with no
   other change.
2. WEIGHT: every `font-weight: N` becomes `clamp(100, calc(N + var(--fw-bias, 0)), 900)`. With the default
   bias of 0 that is exactly N, so nothing moves until the user picks a step in the panel.

Idempotent (rules that already carry --fw-bias and weights that already mention it are skipped).

    python tools/font_role_vars.py             # rewrite every .css under src/ (vendor assets/ excluded)
    from font_role_vars import apply_font_roles   # used by generate-dialog-styles.py
"""
import re
import sys
from pathlib import Path

_WEIGHT = re.compile(r"(?<![-\w])(font-weight\s*:\s*)([^;}!]+?)(\s*!\s*important)?(\s*(?:;|}|$))", re.M)
_FAMILY = re.compile(r"(?<![-\w])font-family\s*:\s*([^;}]+)")
_VAR = re.compile(r"var\(\s*(--[\w-]+)")
_NUMBER = re.compile(r"^\d{3}$")
_KEYWORD_WEIGHT = {"bold": "700", "normal": "400"}
_SKIP = {"inherit", "initial", "unset", "revert", "revert-layer", "bolder", "lighter"}
_SKIP_PRELUDE = re.compile(r"@(font-face|keyframes|-webkit-keyframes|property|page|counter-style)", re.I)


def _role(var_name: str) -> str | None:
    n = var_name.lower()
    if "menu" in n:
        return "menu"
    if "display" in n or "title" in n or "serif" in n and "sans" not in n:
        return "title"
    if "head" in n:
        return "heading"
    if "num" in n or "mono" in n or "digit" in n:
        return "number"
    if "body" in n or "other" in n or n.endswith("-ui") or "sans" in n or "text" in n:
        return "body"
    return None


def _weight_repl(match: re.Match) -> str:
    prop, value, important, tail = match.group(1), match.group(2).strip(), match.group(3) or "", match.group(4)
    low = value.lower()
    if "fw-bias" in value or low in _SKIP:
        return match.group(0)
    if low in _KEYWORD_WEIGHT:
        value = _KEYWORD_WEIGHT[low]
    elif not (_NUMBER.match(value) or (value.startswith("var(") and value.endswith(")"))):
        return match.group(0)  # a range (@font-face), a calc already, or something unrecognised
    return f"{prop}clamp(100, calc({value} + var(--fw-bias, 0)), 900){important}{tail}"


def wrap_weights(css: str) -> str:
    return _WEIGHT.sub(_weight_repl, css)


def _blocks(css: str):
    """Yield (open_index, close_index, innermost) for every {...} block, skipping comments, strings and url()."""
    stack: list[list] = []
    out = []
    i, n = 0, len(css)
    while i < n:
        c = css[i]
        if c == "/" and css.startswith("/*", i):
            end = css.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        if c in "\"'":
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == "\\" else 1
            i = j + 1
            continue
        if c == "u" and css.startswith("url(", i):
            end = css.find(")", i)
            i = n if end < 0 else end + 1
            continue
        if c == "{":
            if stack:
                stack[-1][2] = False
            stack.append([i, None, True])
        elif c == "}" and stack:
            top = stack.pop()
            top[1] = i
            out.append(tuple(top))
        i += 1
    return out


def _prelude_start(css: str, open_idx: int) -> int:
    k = open_idx
    while k > 0 and css[k - 1] not in "{};":
        k -= 1
    return k


def inject_roles(css: str) -> str:
    inserts: list[tuple[int, str]] = []
    for open_idx, close_idx, innermost in _blocks(css):
        if not innermost:
            continue
        body = css[open_idx + 1:close_idx]
        if "--fw-bias" in body:
            continue
        family = _FAMILY.search(body)
        if not family:
            continue
        names = _VAR.findall(family.group(1))
        role = _role(names[0]) if names else None
        if role is None:
            continue
        prelude = css[_prelude_start(css, open_idx):open_idx]
        if _SKIP_PRELUDE.search(prelude):
            continue
        decl = f"--ui-text-scale: var(--rs-{role}); --fw-bias: var(--fwb-{role});"
        lead = re.match(r"(\r?\n)([ \t]*)", body)
        text = f"{lead.group(1)}{lead.group(2)}{decl}" if lead else f" {decl}"
        inserts.append((open_idx + 1, text))
    for idx, text in sorted(inserts, reverse=True):
        css = css[:idx] + text + css[idx:]
    return css


def apply_font_roles(css: str) -> str:
    return wrap_weights(inject_roles(css))


def main(root: Path) -> None:
    changed = 0
    for path in root.rglob("*.css"):
        if "assets" in path.relative_to(root).parts:  # vendor theme files stay as shipped
            continue
        if path.name == "ydot-dialogs.css":  # generated: tools/generate-dialog-styles.py applies this itself
            continue
        with open(path, encoding="utf-8", newline="") as fh:  # keep each file's line endings
            text = fh.read()
        new = apply_font_roles(text)
        if new != text:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            changed += 1
    print(f"font roles wired in {changed} files")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "src")
