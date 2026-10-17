#!/usr/bin/env python3
"""Export the versioned plugin handbooks. Requires Python 3 and Markdown."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

try:
    import markdown
except ImportError as exc:
    raise SystemExit("Install the documentation dependency: python3 -m pip install Markdown") from exc


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing"
CSS = """
:root{color-scheme:light dark;--bg:#fafafa;--paper:#fff;--text:#222;--muted:#595959;
--line:#ddd;--code:#f1f1f1;--link:#215a82;--mark:#e7eef4}
*{box-sizing:border-box}html{scroll-padding-top:1.5rem}body{margin:0;background:var(--bg);
color:var(--text);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
a{color:var(--link);text-underline-offset:.2em}a:hover{text-decoration-thickness:2px}
a:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:2px}
.skip{position:absolute;left:1rem;top:-5rem;padding:.6rem;background:var(--paper)}.skip:focus{top:1rem}
.masthead{padding:2.5rem max(1.5rem,calc((100vw - 1400px)/2));border-bottom:1px solid var(--line)}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.75rem;font-weight:750;color:var(--muted)}
.masthead h1{font-size:clamp(2rem,4vw,3rem);line-height:1.15;letter-spacing:-.035em;max-width:22ch;margin:.5rem 0 1rem}
.masthead p{max-width:70ch;color:var(--muted)}.editions{display:flex;flex-wrap:wrap;gap:.5rem 1.3rem;font-size:.9rem}
.layout{max-width:1400px;margin:auto;display:grid;grid-template-columns:17rem minmax(0,1fr);gap:3rem;padding:2rem 1.5rem 5rem}
aside{font-size:.83rem;align-self:start;position:sticky;top:1rem;max-height:calc(100vh - 2rem);overflow:auto;padding-right:1rem}
aside h2{font-size:1rem;margin:.4rem 0}aside ul{padding-left:1.15rem}aside li{margin:.35rem 0}
aside .toc>ul{padding-left:0;list-style:none}aside .toc>ul>li>ul{border-left:1px solid var(--line);padding-left:.9rem}
main{min-width:0}article{min-width:0;max-width:84ch;background:var(--paper);padding:1.5rem 2rem 3rem;border:1px solid var(--line);border-radius:.6rem}
article h1{font-size:2rem;line-height:1.2;letter-spacing:-.025em}article h2{margin-top:2.8rem;padding-top:1rem;border-top:1px solid var(--line);font-size:1.5rem;line-height:1.3}
article h3{margin-top:2rem;font-size:1.14rem;line-height:1.35}article p,article li{overflow-wrap:anywhere}
article li{margin:.35rem 0}article section+section{margin-top:5rem;border-top:4px double var(--line);padding-top:2rem}
pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85em}
code{background:var(--code);padding:.12em .3em;border-radius:.2rem}pre{padding:1rem;overflow:auto;border:1px solid var(--line);border-radius:.35rem;background:var(--code);line-height:1.6}
pre code{padding:0;background:none;font-size:1em}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;font-size:.89rem;margin:1.4rem 0}
th,td{padding:.65rem .8rem;text-align:left;vertical-align:top;border:1px solid var(--line);min-width:8rem}th{background:var(--code);font-weight:650}
blockquote{margin-left:0;padding-left:1rem;border-left:3px solid var(--line);color:var(--muted)}footer{max-width:1400px;margin:auto;padding:1rem 1.5rem 2rem;color:var(--muted);font-size:.82rem}
@media(prefers-color-scheme:dark){:root{--bg:#181818;--paper:#202020;--text:#ededed;--muted:#b9b9b9;--line:#444;--code:#292929;--link:#a5cdea;--mark:#333}}
@media(max-width:900px){.layout{grid-template-columns:1fr;gap:1.5rem;padding:1.5rem 1rem}aside{position:static;max-height:none;padding:0}aside details{border:1px solid var(--line);border-radius:.4rem;padding:.75rem}aside .toc{max-height:18rem;overflow:auto}aside details:not([open]) .toc{display:none}article{padding:1rem 1.1rem}article h1{font-size:1.7rem}.masthead{padding:2rem 1.25rem}}
@media print{:root{color-scheme:light;--bg:#fff;--paper:#fff;--text:#000;--muted:#444;--line:#bbb;--code:#f5f5f5;--link:#000}body{font-size:10pt}.masthead{padding:0}.layout{display:block;padding:0}aside,.editions,.skip{display:none}article{border:0;max-width:none;padding:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{display:table;font-size:8pt;width:100%}th,td{min-width:0}h1,h2,h3{break-after:avoid}pre,tr{break-inside:avoid}a{text-decoration:none}footer{padding:1rem 0}}
"""


def render_part(source: Path, prefix: str, included: dict[Path, str]) -> tuple[str, str]:
    renderer = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"])
    body = renderer.convert(source.read_text(encoding="utf-8"))

    def rewrite_link(match: re.Match[str]) -> str:
        target = html.unescape(match.group(1))
        parsed = urlsplit(target)
        if parsed.scheme or target.startswith("//"):
            return match.group(0)
        if target.startswith("#"):
            destination = "#" + prefix + target[1:]
        else:
            path = (source.parent / unquote(parsed.path)).resolve()
            if path in included:
                destination = "#" + included[path] + (parsed.fragment or "document")
            else:
                relative = path.relative_to(ROOT).as_posix()
                ref = "v1.4.7" if relative.startswith("lib/") else "main"
                destination = f"{REPOSITORY}/blob/{ref}/{quote(relative, safe='/')}"
                if parsed.fragment:
                    destination += "#" + parsed.fragment
        return f'href="{html.escape(destination, quote=True)}"'

    body = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', body)
    body = re.sub(r'href="([^"]+)"', rewrite_link, body)
    toc = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{prefix}{m.group(1)}"', renderer.toc)
    return f'<section id="{prefix}document">{body}</section>', toc


def main() -> None:
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if version != "1.4.7":
        raise SystemExit("Review source version labels and release links before exporting another release.")
    output = ROOT / "docs" / "handbooks"
    output.mkdir(parents=True, exist_ok=True)
    editions = [
        ("core-plugins", "The core plugin guide", "Practical setup and advice for all 27 bundled bots.",
         [(ROOT / "docs/CORE_PLUGINS.md", "guide-")]),
        ("plugin-developer", "Plugin developer handbook", "API contracts, complete modules and recipes from all 27 core plugins.",
         [(ROOT / "core/plugins/PLUGIN_API.md", "api-"),
          (ROOT / "core/plugins/PLUGIN_COOKBOOK.md", "cookbook-")]),
    ]
    for slug, title, description, parts in editions:
        included = {path.resolve(): prefix for path, prefix in parts}
        rendered = [render_part(path, prefix, included) for path, prefix in parts]
        links = "".join(
            f'<a href="dicefiles-{item[0]}-{version}.html">{html.escape(item[1])}</a>'
            for item in editions
        )
        toc = "".join(part[1] for part in rendered)
        body = "".join(part[0] for part in rendered)
        document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{html.escape(description)}"><title>{html.escape(title)} | Dicefiles {version}</title>
<style>{CSS}</style></head><body><a class="skip" href="#content">Skip to content</a>
<header class="masthead"><div class="eyebrow">Dicefiles {version} / Handbooks</div><h1>{html.escape(title)}</h1>
<p>{html.escape(description)} Save this file for offline reading. Use your browser's Find or Print to PDF.</p>
<nav class="editions" aria-label="Handbook editions">{links}<a href="{REPOSITORY}/releases/tag/v{version}">Release downloads</a></nav></header>
<div class="layout"><aside aria-label="Table of contents"><details open><summary>Contents</summary>{toc}</details></aside>
<main id="content"><article>{body}</article></main></div>
<footer>Dicefiles {version}. Generated from the public Markdown documentation. No scripts, external fonts or network assets.</footer>
</body></html>'''
        destination = output / f"dicefiles-{slug}-{version}.html"
        destination.write_text(document, encoding="utf-8", newline="\n")
        print(destination.relative_to(ROOT))


if __name__ == "__main__":
    main()
