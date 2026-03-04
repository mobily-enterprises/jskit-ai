#!/usr/bin/env python3
"""Generate a commit-by-commit CHANGELOG.md from git metadata.

This intentionally ignores commit diffs and uses only:
- commit hash/date/subject
- numstat totals (files, insertions, deletions)
- touched top-level areas
"""

from __future__ import annotations

import argparse
import re
import subprocess
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Commit:
    hash: str
    date: str
    subject: str
    files: list[str] = field(default_factory=list)
    insertions: int = 0
    deletions: int = 0


def run_git_log(repo: Path) -> str:
    cmd = [
        "git",
        "log",
        "--reverse",
        "--numstat",
        "--date=short",
        "--pretty=format:@@@%H|%ad|%s",
    ]
    return subprocess.check_output(cmd, cwd=repo, text=True, errors="replace")


def parse_log(raw: str) -> list[Commit]:
    commits: list[Commit] = []
    current: Commit | None = None

    for raw_line in raw.splitlines():
        line = raw_line.rstrip("\n")
        if line.startswith("@@@"):
            if current is not None:
                commits.append(current)
            pieces = line[3:].split("|", 2)
            if len(pieces) != 3:
                current = None
                continue
            current = Commit(hash=pieces[0], date=pieces[1], subject=pieces[2].strip())
            continue

        if current is None or not line.strip():
            continue

        match = re.match(r"^(-|\d+)\t(-|\d+)\t(.+)$", line)
        if not match:
            continue

        added, removed, path = match.groups()
        current.files.append(path)
        if added.isdigit():
            current.insertions += int(added)
        if removed.isdigit():
            current.deletions += int(removed)

    if current is not None:
        commits.append(current)

    return commits


def short_subject(subject: str, max_len: int = 120) -> str:
    clean = " ".join(subject.split()).replace("`", "'")
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 3] + "..."


def top_level_area(path: str) -> str:
    if "/" in path:
        return path.split("/", 1)[0]
    return "repo-root"


def summarize_areas(files: list[str], limit: int = 4) -> str:
    if not files:
        return "none"
    counts = Counter(top_level_area(path) for path in files)
    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:limit]
    return ", ".join(f"{name}({count})" for name, count in ranked)


def shock_stage(index: int, total: int) -> int:
    if total <= 1:
        return 0
    ratio = (index - 1) / (total - 1)
    if ratio < 0.15:
        return 0
    if ratio < 0.30:
        return 1
    if ratio < 0.45:
        return 2
    if ratio < 0.60:
        return 3
    if ratio < 0.75:
        return 4
    if ratio < 0.90:
        return 5
    return 6


SHOCK_LINES = {
    0: [
        "Calm status: the annuity calculator story still sounds believable.",
        "Calm status: manageable scope, nothing visibly cursed yet.",
        "Calm status: still feels like focused calculator engineering.",
    ],
    1: [
        "Eyebrow raised: architecture vocabulary is appearing in a calculator repo.",
        "Eyebrow raised: this is beginning to look like a tiny platform.",
        "Eyebrow raised: the calculator is collecting side quests.",
    ],
    2: [
        "Concern level: we are now designing systems, not just formulas.",
        "Concern level: the blast radius suggests framework ambitions.",
        "Concern level: scope is drifting beyond simple finance math.",
    ],
    3: [
        "Alarm level: this behaves like backend infrastructure work.",
        "Alarm level: calculator energy is fading behind service orchestration.",
        "Alarm level: many moving parts, very little pocket-calculator vibe.",
    ],
    4: [
        "Panic level: this repository now speaks fluent framework.",
        "Panic level: modules and seams are multiplying faster than formulas.",
        "Panic level: we are maintaining a platform with a calculator memory.",
    ],
    5: [
        "Existential level: this is a full application ecosystem now.",
        "Existential level: annuity math appears to be legacy lore.",
        "Existential level: framework gravity has completely won.",
    ],
    6: [
        "Total disbelief: calculator origin story has become mythology.",
        "Total disbelief: we have entered complete framework territory.",
        "Total disbelief: this is industrial-scale repo evolution.",
    ],
}

SMALL_LINES = [
    "Tiny change set.",
    "Small, surgical edit.",
    "Short commit, long-term consequences pending.",
]
MEDIUM_LINES = [
    "Moderate scope adjustment.",
    "Mid-sized sweep across the codebase.",
    "A healthy chunk of refactor energy.",
]
LARGE_LINES = [
    "Large sweep across many files.",
    "Broad blast radius, many components touched.",
    "Heavy movement: this is not a minor tweak.",
]
MASSIVE_LINES = [
    "Massive wave of change.",
    "Huge repo-wide surge.",
    "Monolithic shift across the project.",
]

WIP_LINES = [
    "Commit label is 'WIP', which does not narrow things down.",
    "Another 'WIP' marker, now functioning as a genre.",
    "'WIP' appears again, confidently unspecific.",
]
NAMED_LINES = [
    "At least this commit has a descriptive title.",
    "Named commit: a rare moment of narrative clarity.",
    "Descriptive title detected, appreciated during the chaos.",
]
MERGE_LINES = [
    "Parallel timelines merged, complexity compounds.",
    "Branch merge event: multiple story arcs collide.",
    "Merge commit: two evolving universes now share one history.",
]

CALC_TERMS = (
    "annuity",
    "calculator",
    "interest",
    "loan",
    "apr",
    "rate",
    "payment",
    "principal",
)


def classify_size(files: int, churn: int, index: int) -> str:
    if files == 0:
        return "No file stats recorded (likely metadata-only commit)."
    if files <= 3 and churn <= 80:
        return SMALL_LINES[(index - 1) % len(SMALL_LINES)]
    if files <= 20 and churn <= 2000:
        return MEDIUM_LINES[(index - 1) % len(MEDIUM_LINES)]
    if files <= 90 and churn <= 9000:
        return LARGE_LINES[(index - 1) % len(LARGE_LINES)]
    return MASSIVE_LINES[(index - 1) % len(MASSIVE_LINES)]


def classify_subject(subject: str, index: int) -> str:
    lower = subject.lower()
    if "merge" in lower:
        return MERGE_LINES[(index - 1) % len(MERGE_LINES)]
    if lower.startswith("wip"):
        return WIP_LINES[(index - 1) % len(WIP_LINES)]
    return NAMED_LINES[(index - 1) % len(NAMED_LINES)]


def classify_drift(subject: str, files: list[str], stage: int) -> str:
    searchable = f"{subject} {' '.join(files)}".lower()
    calc_related = any(term in searchable for term in CALC_TERMS)
    if calc_related and stage <= 2:
        return "Calculator DNA still clearly visible."
    if calc_related:
        return "Calculator DNA still present, mostly as legacy heritage."
    if stage <= 1:
        return "Framework instincts are beginning to emerge."
    if stage <= 3:
        return "Framework instincts are now dominant."
    return "Any resemblance to a simple annuity tool is now ceremonial."


def render_changelog(commits: list[Commit]) -> str:
    lines: list[str] = []
    lines.append("# CHANGELOG")
    lines.append("")
    lines.append(
        "A complete, commit-by-commit, tongue-in-cheek history generated from `git log --reverse --numstat`."
    )
    lines.append(
        "No diff hunks were used: only commit metadata, file counts, and insertion/deletion totals."
    )
    lines.append("")
    lines.append(f"Total commits covered: **{len(commits)}**")
    lines.append("")

    for index, commit in enumerate(commits, start=1):
        files_changed = len(commit.files)
        churn = commit.insertions + commit.deletions
        stage = shock_stage(index, len(commits))
        shock = SHOCK_LINES[stage][(index - 1) % len(SHOCK_LINES[stage])]
        size = classify_size(files_changed, churn, index)
        subject_blurb = classify_subject(commit.subject, index)
        drift = classify_drift(commit.subject, commit.files, stage)
        summary = f"{shock} {size} {subject_blurb} {drift}"

        file_word = "file" if files_changed == 1 else "files"
        lines.append(f"## Commit {index:04d}: {short_subject(commit.subject)}")
        lines.append("")
        lines.append(f"- Date: `{commit.date}`")
        lines.append(f"- Hash: `{commit.hash[:8]}`")
        lines.append(
            f"- Change size: `{files_changed} {file_word}, +{commit.insertions}/-{commit.deletions}`"
        )
        lines.append(f"- Areas touched: `{summarize_areas(commit.files)}`")
        lines.append("")
        lines.append(summary)
        lines.append("")

    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate CHANGELOG.md from full git history."
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path.cwd(),
        help="Path to git repository (default: current working directory).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("CHANGELOG.md"),
        help="Output markdown path (default: CHANGELOG.md in --repo).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    output = args.output
    if not output.is_absolute():
        output = (repo / output).resolve()

    raw = run_git_log(repo)
    commits = parse_log(raw)
    if not commits:
        raise RuntimeError("No commits found in git history.")

    markdown = render_changelog(commits)
    output.write_text(markdown + "\n", encoding="utf-8")
    print(f"Wrote {output} with {len(commits)} commits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
