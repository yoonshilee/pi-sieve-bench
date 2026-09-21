"""Render saved benchmark measurements without making model requests."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main():
    """Create a static latency, quality, and token figure from saved JSONL.

    Reads a report directory from the first command-line argument and writes
    benchmark.png and benchmark.svg into that same directory.
    """
    directory = Path(sys.argv[1])
    rows = [json.loads(line) for line in (directory / "runs.jsonl").read_text().splitlines() if line]
    groups = json.loads((directory / "summary.json").read_text())["groups"]
    arms = ["native", "full", "sieve", "luna-native", "luna-sieve"]
    colors = {"native": "#526987", "full": "#c08b3c", "sieve": "#147d77", "luna-native": "#986aa0", "luna-sieve": "#c56b65"}
    labels = [f"{g['workflow']}\n{g['arm']}" for g in groups]
    fig, axes = plt.subplots(3, 1, figsize=(max(10, len(groups) * 1.1), 12), layout="constrained")
    fig.suptitle("Pi Sieve | " + ("Pilot observations (n=1 per arm)" if rows[0]["kind"] == "pilot" else "Long-workflow benchmark"), fontsize=18, weight="bold")
    for i, group in enumerate(groups):
        matching = [r for r in rows if r["workflow"] == group["workflow"] and r["arm"] == group["arm"]]
        for j, row in enumerate(matching):
            offset = (j - (len(matching) - 1) / 2) * 0.07
            axes[0].scatter(i + offset, row["elapsedMs"] / 1000, color=colors[group["arm"]], marker="o" if row["success"] else "x", s=65, zorder=3)
        axes[0].hlines(group["medianSeconds"], i - 0.2, i + 0.2, color=colors[group["arm"]], linewidth=3)
    axes[0].set(ylabel="Workflow seconds", title="Latency: points are runs; lines are medians; crosses mark failure", xticks=range(len(labels)), xticklabels=labels)
    axes[0].set_ylim(bottom=0)
    axes[0].grid(axis="y", alpha=0.2)
    matrix = []
    for group in groups:
        matching = [r for r in rows if r["workflow"] == group["workflow"] and r["arm"] == group["arm"]]
        matrix.append([np.mean([sum(c["passed"] for c in r["stages"][s]["checks"]) / len(r["stages"][s]["checks"]) if len(r["stages"]) > s and r["stages"][s]["checks"] else 0 for r in matching]) * 100 for s in range(5)])
    axes[1].imshow(matrix, aspect="auto", vmin=0, vmax=100, cmap="YlGnBu")
    axes[1].set(title="Independent stage checks passed (%)", xticks=range(5), xticklabels=[f"Stage {i}" for i in range(1, 6)], yticks=range(len(labels)), yticklabels=[label.replace("\n", " / ") for label in labels])
    for y, row in enumerate(matrix):
        for x, value in enumerate(row):
            axes[1].text(x, y, f"{value:.0f}%", ha="center", va="center", color="white" if value >= 65 else "#172536")
    bottom = np.zeros(len(groups))
    for field, label, color in [("medianInput", "Uncached input", "#526987"), ("medianCached", "Cached input", "#9db9cf"), ("medianOutput", "Output (includes reasoning)", "#147d77")]:
        values = [g[field] if g[field] is not None else 0 for g in groups]
        axes[2].bar(range(len(groups)), values, bottom=bottom, label=label, color=color)
        bottom += values
    axes[2].set(title="Median reported main-model tokens by component (missing components are omitted)", ylabel="Tokens", xticks=range(len(labels)), xticklabels=labels)
    axes[2].legend(frameon=False)
    axes[2].grid(axis="y", alpha=0.2)
    fig.text(0.01, 0, "gpt-6-astra + gpt-5.6-luna / medium · Pi 0.86.1 · Jev 1.13.0 · Synthetic projects; no general performance claim", fontsize=9, color="#526987")
    for suffix in ["png", "svg"]:
        fig.savefig(directory / f"benchmark.{suffix}", dpi=160, facecolor="white", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    main()
