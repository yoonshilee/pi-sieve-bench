"""Render saved benchmark measurements without making model requests."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["svg.hashsalt"] = "pi-sieve-bench"
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import StrMethodFormatter
import numpy as np


def main():
    """Render saved measurements with readable handwritten labels and pale cells.

    Reads a report directory from the first command-line argument and writes
    benchmark.png and benchmark.svg into that same directory.
    """
    font_dir = Path(__file__).resolve().parents[1] / "assets/fonts"
    for filename in ["Caveat.ttf", "ComicNeue-Regular.ttf", "ComicNeue-Bold.ttf"]:
        font_manager.fontManager.addfont(font_dir / filename)
    paper, ink = "#fffdf7", "#283743"
    plt.rcParams.update({
        "font.family": "Comic Neue", "font.size": 12,
        "path.sketch": (0.7, 100, 2),
        "figure.facecolor": paper, "axes.facecolor": paper,
        "text.color": ink, "axes.labelcolor": ink, "axes.edgecolor": ink,
        "xtick.color": ink, "ytick.color": ink,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.linewidth": 1.3, "grid.color": ink, "grid.linewidth": 0.7,
        "axes.axisbelow": True,
        "svg.fonttype": "path",
    })
    directory = Path(sys.argv[1])
    rows = [json.loads(line) for line in (directory / "runs.jsonl").read_text().splitlines() if line]
    summary = json.loads((directory / "summary.json").read_text())
    groups = summary["groups"]
    colors = {"retrieval-local": "#526987", "retrieval-jev": "#147d77", "native": "#526987", "full": "#c08b3c", "sieve": "#147d77", "luna-native": "#986aa0", "luna-sieve": "#c56b65"}
    arm_names = {"retrieval-local": "Astra / Local retrieval", "retrieval-jev": "Astra / Jev retrieval", "native": "Astra / Native Pi", "full": "Astra / Full Context", "sieve": "Astra / Sieve", "luna-native": "Luna / Native Pi", "luna-sieve": "Luna / Sieve"}
    workflows = list(dict.fromkeys(g["workflow"] for g in groups))
    labels = [arm_names[g["arm"]].replace(" / ", "\n") + (f"\n{g['workflow']}" if len(workflows) > 1 else "") for g in groups]
    row_labels = [arm_names[g["arm"]] + (f" / {g['workflow']}" if len(workflows) > 1 else "") for g in groups]
    fig, axes = plt.subplots(3, 1, figsize=(max(12, len(groups) * 1.1), 13))
    fig.suptitle("Pi Sieve | " + ("Pilot observations (n=1 per arm)" if rows[0]["kind"] == "pilot" else "Long-workflow benchmark"), fontsize=28, fontfamily="Caveat")
    legacy = all(row["versions"]["sieve"].startswith("7d54c8f") for row in rows)
    subtitle = "Historical v0.1 context filtering | " if legacy else ""
    fig.text(0.5, 0.935, subtitle + "Workflows: " + ", ".join(workflows), ha="center", fontsize=12)
    for i, group in enumerate(groups):
        matching = [r for r in rows if r["workflow"] == group["workflow"] and r["arm"] == group["arm"]]
        for j, row in enumerate(matching):
            offset = (j - (len(matching) - 1) / 2) * 0.07
            reviewed_success = row.get("reviewedSuccess", row["success"])
            axes[0].scatter(i + offset, row["elapsedMs"] / 1000, color=colors[group["arm"]], marker="o" if reviewed_success else "x", s=65, zorder=3)
        axes[0].hlines(group["medianSeconds"], i - 0.2, i + 0.2, color=colors[group["arm"]], linewidth=3)
        axes[0].annotate(f"{group['medianSeconds']:.1f} s", (i, group["medianSeconds"]), xytext=(0, 12), textcoords="offset points", ha="center", fontsize=11, weight="bold")
    axes[0].set(ylabel="Seconds", xticks=range(len(labels)), xticklabels=labels)
    axes[0].set_title("Workflow time (lower is faster)", fontfamily="Caveat", fontsize=22, pad=46)
    axes[0].legend(handles=[
        Line2D([], [], color=ink, marker="o", linestyle="none", label="Successful run"),
        Line2D([], [], color=ink, marker="x", linestyle="none", label="Failed / incomplete run"),
        Line2D([], [], color=ink, linewidth=3, label="Median"),
    ], loc="lower left", bbox_to_anchor=(0, 1.01), ncol=3, frameon=False, fontsize=11)
    axes[0].set_ylim(0, max(max(r["elapsedMs"] / 1000 for r in rows) * 1.25, 1))
    axes[0].grid(axis="y", alpha=0.2)
    matrix = []
    for group in groups:
        matrix.append([value * 100 for value in group["stageScores"]])
    check_colors = ["#f7d8d3", "#ffedc9", "#ddeedb"]
    scores = np.asarray(matrix)
    check_states = np.where(scores == 100, 2, np.where(scores == 0, 0, 1))
    axes[1].imshow(check_states, aspect="auto", vmin=0, vmax=2, cmap=ListedColormap(check_colors))
    axes[1].set(xticks=range(5), xticklabels=[f"Stage {i}" for i in range(1, 6)], yticks=range(len(labels)), yticklabels=row_labels)
    axes[1].set_title("Independent checks passed (higher is better)", fontfamily="Caveat", fontsize=22, pad=46)
    axes[1].legend(handles=[Patch(facecolor=color, edgecolor=ink, label=label) for color, label in zip(check_colors[::-1], ["All checks passed", "Partial pass", "Zero / not run"])],
                   loc="lower left", bbox_to_anchor=(0, 1.01), ncol=3, frameon=False, fontsize=11)
    axes[1].set_xticks(np.arange(5) - 0.5, minor=True)
    axes[1].set_yticks(np.arange(len(labels)) - 0.5, minor=True)
    axes[1].grid(which="minor", color=paper, linewidth=3)
    axes[1].tick_params(which="minor", length=0)
    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            axes[1].text(x, y, f"{value:.0f}%", ha="center", va="center", color=ink, fontsize=13, weight="bold")
    bottom = np.zeros(len(groups))
    for field, label, color in [("medianInput", "Input (uncached)", "#6f879a"), ("medianCached", "Input (cached)", "#e7cf9d"), ("medianOutput", "Output (incl. reasoning)", "#6b9d86")]:
        values = [g[field] if g[field] is not None else 0 for g in groups]
        axes[2].bar(range(len(groups)), values, bottom=bottom, label=label, color=color, edgecolor=ink, linewidth=0.8)
        bottom += values
    axes[2].set(ylabel="Tokens", xticks=range(len(labels)), xticklabels=labels)
    axes[2].set_title("Main-model token usage (component medians)", fontfamily="Caveat", fontsize=22, pad=46)
    axes[2].yaxis.set_major_formatter(StrMethodFormatter("{x:,.0f}"))
    axes[2].legend(loc="lower left", bbox_to_anchor=(0, 1.01), frameon=False, ncol=3, fontsize=11)
    axes[2].set_ylim(0, max(float(max(bottom)) * 1.1, 1))
    axes[2].grid(axis="y", alpha=0.2)
    fig.tight_layout(rect=(0, 0.085, 1, 0.91), h_pad=3)
    fallbacks = sum(group["fallbacks"] for group in groups)
    calls = sum(group["jevRequests"] for group in groups)
    models = " + ".join(dict.fromkeys(row["versions"]["model"] for row in rows))
    fig.text(0.02, 0.01, models + " / medium · Pi 0.86.1 · Jev 1.13.0\n"
             "Synthetic projects; no general performance claim. Missing stages score zero; missing token usage is omitted.\n"
             f"Jev fallbacks: {fallbacks}/{calls} calls · Corrected grading verdicts: {summary['reviewedChecks']} · Tokens are not monetary costs.", fontsize=9, color=ink)
    for suffix in ["png", "svg"]:
        fig.savefig(directory / f"benchmark.{suffix}", dpi=160, facecolor=paper, bbox_inches="tight", metadata={"Date": None} if suffix == "svg" else None)
    svg = directory / "benchmark.svg"
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
    plt.close(fig)


if __name__ == "__main__":
    main()
