import re, os, sys
S = os.path.dirname(os.path.abspath(__file__))
D = r"C:/Pradeesh/Ydot prad/UI/YDots.UI/src/app/Features/YDot/Donors and Leads/communication-timeline/"
def read(n):
    with open(os.path.join(S, n), encoding="utf-8") as f: return f.read()
def conv(t):
    t = re.sub(r"\bic\(([\d.]+)\)", lambda m: f"width: calc({m.group(1)}px * var(--u)) !important; height: calc({m.group(1)}px * var(--u)) !important", t)
    t = re.sub(r"\bfs\(([\d.]+)\)", lambda m: f"calc(calc({m.group(1)}px * var(--u)) * var(--ui-text-scale, 1))", t)
    t = re.sub(r"\bfw\((\d+)\)", lambda m: f"clamp(100, calc({m.group(1)} + var(--fw-bias, 0)), 900)", t)
    t = re.sub(r"\bu\((-?[\d.]+)\)", lambda m: f"calc({m.group(1)}px * var(--u))", t)
    t = re.sub(r"((?<![-\w])(?:font-size|font-weight|line-height)\s*:\s*[^;!}]+?)\s*;", lambda m: m.group(1) + " !important;", t)
    return t
page = conv(read("page.src.css"))
dlg = read("dialogs.css")
log = conv(read("log.src.css"))
css = page.rstrip() + "\n\n" + dlg.rstrip() + "\n\n" + log
assert not re.search(r"\b(u|fs|fw|ic)\(", css.replace("calc(", "").replace("clamp(", "")), "unexpanded macro"
open(D + "communication-timeline.css", "w", encoding="utf-8", newline="\n").write(css)
html = read("top.html").rstrip() + "\n\n" + read("tail.html")
open(D + "communication-timeline.html", "w", encoding="utf-8", newline="\n").write(html)
print(len(css.splitlines()), len(html.splitlines()))
