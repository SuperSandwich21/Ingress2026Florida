from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import quote


ROOT = Path(r"D:\Outer System\Ingress\IngressWeekly")
PREVIOUS_DIR = ROOT / "Previous Reports"

FILENAME_RE = re.compile(
    r"^(?:battle_report|news_report|monthly_news_report)_(\d{8})(?:_\d{4})?_to_(\d{8})(?:_\d{4})?\.html$",
    re.IGNORECASE,
)
META_RE = re.compile(
    r"<script[^>]*id=['\"]battle-report-meta['\"][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
OLD_TIME_PERIOD_RE = re.compile(
    r"<strong>\s*Time period:\s*</strong>\s*(\d{4}):\s*(\d{2})-(\d{2})\s+to\s+(\d{2})-(\d{2})",
    re.IGNORECASE,
)


@dataclass
class ReportEntry:
    path: Path
    href: str
    start_dt: datetime
    end_dt: datetime


def _parse_range_from_filename(file_name: str) -> tuple[datetime, datetime] | None:
    match = FILENAME_RE.match(file_name)
    if not match:
        return None
    try:
        return (
            datetime.strptime(match.group(1), "%Y%m%d"),
            datetime.strptime(match.group(2), "%Y%m%d"),
        )
    except ValueError:
        return None


def _parse_range_from_html(path: Path) -> tuple[datetime, datetime] | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    meta_match = META_RE.search(text)
    if meta_match:
        try:
            payload = json.loads(meta_match.group(1).strip())
            time_period = payload.get("time_period") if isinstance(payload, dict) else {}
            start_raw = str((time_period or {}).get("start") or "").strip()
            end_raw = str((time_period or {}).get("end") or "").strip()
            if start_raw and end_raw:
                return (
                    datetime.strptime(start_raw[:10], "%Y-%m-%d"),
                    datetime.strptime(end_raw[:10], "%Y-%m-%d"),
                )
        except Exception:
            pass
    old_match = OLD_TIME_PERIOD_RE.search(text)
    if old_match:
        year = int(old_match.group(1))
        start_month = int(old_match.group(2))
        start_day = int(old_match.group(3))
        end_month = int(old_match.group(4))
        end_day = int(old_match.group(5))
        try:
            return (
                datetime(year, start_month, start_day),
                datetime(year, end_month, end_day),
            )
        except ValueError:
            return None
    return None


def _href_for(path: Path) -> str:
    rel = path.relative_to(ROOT)
    return "/" + "/".join(quote(part) for part in rel.parts)


def _discover_reports() -> list[ReportEntry]:
    entries: list[ReportEntry] = []
    seen: set[Path] = set()
    candidates = [ROOT / "WeeklyReport.html"]
    candidates.extend(sorted(ROOT.glob("news_report_*.html")))
    candidates.extend(sorted(ROOT.glob("monthly_news_report_*.html")))
    candidates.extend(sorted(PREVIOUS_DIR.glob("*.html")))
    for path in candidates:
        if not path.exists() or not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        range_info = _parse_range_from_filename(path.name) or _parse_range_from_html(path)
        if not range_info:
            continue
        start_dt, end_dt = range_info
        entries.append(
            ReportEntry(
                path=path,
                href=_href_for(path),
                start_dt=start_dt,
                end_dt=end_dt,
            )
        )
    entries.sort(key=lambda row: (row.start_dt, row.end_dt, row.path.name.lower()))
    return entries


def _prev_arrow(href: str | None) -> str:
    if href:
        return (
            f"<a href='{href}' title='Previous report' "
            "style='display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;"
            "border:1px solid #8b5a2b;border-radius:999px;background:#efe4cf;color:#3d2817;"
            "text-decoration:none;font-size:20px;font-weight:700;'>&larr;</a>"
        )
    return (
        "<span style='display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;"
        "border:1px solid #cbb79a;border-radius:999px;background:#f3ebde;color:#b39a79;font-size:20px;'>&larr;</span>"
    )


def _next_arrow(href: str | None) -> str:
    if href:
        return (
            f"<a href='{href}' title='Next report' "
            "style='display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;"
            "border:1px solid #8b5a2b;border-radius:999px;background:#efe4cf;color:#3d2817;"
            "text-decoration:none;font-size:20px;font-weight:700;'>&rarr;</a>"
        )
    return (
        "<span style='display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;"
        "border:1px solid #cbb79a;border-radius:999px;background:#f3ebde;color:#b39a79;font-size:20px;'>&rarr;</span>"
    )


def _nav_block(prev_href: str | None, next_href: str | None) -> str:
    return (
        "<div style=\"display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;\">"
        "<div style=\"flex:0 0 auto;display:flex;align-items:center;gap:8px;\">"
        f"{_prev_arrow(prev_href)}"
        "<span style=\"font-size:12px;font-weight:700;color:#6b4423;text-transform:uppercase;letter-spacing:0.08em;\">Previous Issue</span>"
        "</div>"
        "<div style=\"flex:1 1 auto;\"></div>"
        "<div style=\"flex:0 0 auto;display:flex;align-items:center;gap:8px;\">"
        "<span style=\"font-size:12px;font-weight:700;color:#6b4423;text-transform:uppercase;letter-spacing:0.08em;\">Next Issue</span>"
        f"{_next_arrow(next_href)}"
        "</div>"
        "</div>"
    )


def _replace_arrow(text: str, href: str | None, which: str) -> tuple[str, bool]:
    arrow = "&larr;" if which == "previous" else "&rarr;"
    title = "Previous report" if which == "previous" else "Next report"
    replacement = _prev_arrow(href) if which == "previous" else _next_arrow(href)
    patterns = [
        rf"<a[^>]*title=['\"]{title}['\"][^>]*>{arrow}</a>",
        rf"<span[^>]*>{arrow}</span>",
    ]
    for pattern in patterns:
        new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.IGNORECASE)
        if count:
            return new_text, True
    return text, False


def _rewrite_file(entry: ReportEntry, prev_href: str | None, next_href: str | None) -> bool:
    text = entry.path.read_text(encoding="utf-8", errors="ignore")
    original = text

    text, prev_done = _replace_arrow(text, prev_href, "previous")
    text, next_done = _replace_arrow(text, next_href, "next")

    if not (prev_done or next_done):
        nav = _nav_block(prev_href, next_href)
        injected = False
        for marker in (
            '<div class="issue-report-line">',
            "<h1 class=\"report-heading\">",
            "<h1>Weekly Report</h1>",
            "<h1>",
        ):
            idx = text.find(marker)
            if idx >= 0:
                text = text[:idx] + nav + "\n    " + text[idx:]
                injected = True
                break
        if not injected:
            page_marker = '<div class="page">'
            idx = text.find(page_marker)
            if idx >= 0:
                insert_at = idx + len(page_marker)
                text = text[:insert_at] + "\n    " + nav + text[insert_at:]

    if text != original:
        entry.path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    reports = _discover_reports()
    changed = 0
    for index, entry in enumerate(reports):
        prev_href = reports[index - 1].href if index > 0 else None
        next_href = reports[index + 1].href if index + 1 < len(reports) else None
        if _rewrite_file(entry, prev_href, next_href):
            changed += 1
            print(f"updated: {entry.path.name}")
    print(f"reports discovered: {len(reports)}")
    print(f"reports updated: {changed}")


if __name__ == "__main__":
    main()
