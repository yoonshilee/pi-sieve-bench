"""Render saved benchmark measurements without making model requests."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["svg.hashsalt"] = "pi-sieve-bench"
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np


def main():
    """Create a hand-drawn latency, quality, and token figure from saved JSONL.

    Reads a report directory from the first command-line argument and writes
    benchmark.png and benchmark.svg into that same directory.
    """
    font_manager.fontManager.addfont(Path(__file__).resolve().parents[1] / "assets/fonts/Caveat.ttf")
    paper, ink = "#fffdf7", "#283743"
    plt.rcParams.update({
        "font.family": "Caveat", "font.size": 14,
        "path.sketch": (0.7, 100, 2),
        "figure.facecolor": paper, "axes.facecolor": paper,
        "text.color": ink, "axes.labelcolor": ink, "axes.edgecolor": ink,
        "xtick.color": ink, "ytick.color": ink,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.linewidth": 1.3, "grid.color": ink, "grid.linewidth": 0.7,
        "svg.fonttype": "path",
    })
    directory = Path(sys.argv[1])
    rows = [json.loads(line) for line in (directory / "runs.jsonl").read_text().splitlines() if line]
    summary = json.loads((directory / "summary.json").read_text())
    groups = summary["groups"]
    colors = {"native": "#526987", "full": "#c08b3c", "sieve": "#147d77", "luna-native": "#986aa0", "luna-sieve": "#c56b65"}
    labels = [f"{g['workflow']}\n{g['arm']}" for g in groups]
    fig, axes = plt.subplots(3, 1, figsize=(max(10, len(groups) * 1.1), 12))
    fig.suptitle("Pi Sieve | " + ("Pilot observations (n=1 per arm)" if rows[0]["kind"] == "pilot" else "Long-workflow benchmark"), fontsize=24)
    for i, group in enumerate(groups):
        matching = [r for r in rows if r["workflow"] == group["workflow"] and r["arm"] == group["arm"]]
        for j, row in enumerate(matching):
            offset = (j - (len(matching) - 1) / 2) * 0.07
            reviewed_success = row.get("reviewedSuccess", row["success"])
            axes[0].scatter(i + offset, row["elapsedMs"] / 1000, color=colors[group["arm"]], marker="o" if reviewed_success else "x", s=65, zorder=3)
        axes[0].hlines(group["medianSeconds"], i - 0.2, i + 0.2, color=colors[group["arm"]], linewidth=3)
    axes[0].set(ylabel="Workflow seconds", title="Latency: points are runs; lines are medians; crosses mark failure", xticks=range(len(labels)), xticklabels=labels)
    axes[0].set_ylim(bottom=0)
    axes[0].grid(axis="y", alpha=0.2)
    matrix = []
    for group in groups:
        matrix.append([value * 100 for value in group["stageScores"]])
    axes[1].imshow(matrix, aspect="auto", vmin=0, vmax=100, cmap="YlGnBu")
    axes[1].set(title="Independent stage checks passed (%)", xticks=range(5), xticklabels=[f"Stage {i}" for i in range(1, 6)], yticks=range(len(labels)), yticklabels=[label.replace("\n", " / ") for label in labels])
    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            axes[1].text(x, y, f"{value:.0f}%", ha="center", va="center", color="white" if value >= 65 else "#172536")
    bottom = np.zeros(len(groups))
    for field, label, color in [("medianInput", "Uncached input", "#526987"), ("medianCached", "Cached input", "#9db9cf"), ("medianOutput", "Output (includes reasoning)", "#147d77")]:
        values = [g[field] if g[field] is not None else 0 for g in groups]
        axes[2].bar(range(len(groups)), values, bottom=bottom, label=label, color=color, edgecolor=ink, linewidth=0.8)
        bottom += values
    axes[2].set(title="Reported main-model tokens by component (medians; missing values omitted)", ylabel="Tokens", xticks=range(len(labels)), xticklabels=labels)
    axes[2].legend(loc="upper left", frameon=False, ncol=3, fontsize=12)
    axes[2].set_ylim(0, max(float(max(bottom)) * 1.45, 1))
    axes[2].grid(axis="y", alpha=0.2)
    fig.tight_layout(rect=(0, 0.055, 1, 0.95), h_pad=2)
    fallbacks = sum(group["fallbacks"] for group in groups)
    calls = sum(group["jevRequests"] for group in groups)
    fig.text(0.01, 0.005, "gpt-6-astra + gpt-5.6-luna / medium · Pi 0.86.1 · Jev 1.13.0 · Synthetic projects; no general performance claim\n"
             f"Jev fallbacks: {fallbacks}/{calls} calls · Corrected grading verdicts: {summary['reviewedChecks']} · Missing stages score zero", fontsize=11, color="#526987")
    for suffix in ["png", "svg"]:
        fig.savefig(directory / f"benchmark.{suffix}", dpi=160, facecolor=paper, bbox_inches="tight", metadata={"Date": None} if suffix == "svg" else None)
    svg = directory / "benchmark.svg"
    svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
    plt.close(fig)


if __name__ == "__main__":
    main()
