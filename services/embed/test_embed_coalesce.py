"""The embed sidecar's coalescing gives each request its own vectors, unchanged.

Run: python services/embed/test_embed_coalesce.py (the embedding sidecar's requirements, the model in the HF cache).

  - A text's vector does not depend on what shares its forward pass: embedded in a coalesced batch of mixed
    lengths, every text matches itself embedded alone to 1e-6 (masked mean pooling; the same bound
    `scripts/embedding-parity.ts` holds the TypeScript path to).
  - Requests queued together are answered with their OWN slices, in order, whatever the batch they joined.
  - A failure inside a batch reaches every request in it, and the worker keeps serving.
  - A batch larger than `MICRO_BATCH` runs shortest-first in groups and still answers every text with its own
    vector, in the order it was given.
"""

import os
import sys
import threading

os.environ.setdefault("LOUVAIN_EMBEDDINGS_COALESCE_TEXTS", "64")
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402

import embed  # noqa: E402

FAILED = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global FAILED
    print(("ok: " if cond else "FAIL: ") + label + ("" if cond else f" — {detail}"))
    if not cond:
        FAILED += 1


texts = [
    "Short.",
    "The renewal was signed on Tuesday after the pricing review with the customer's finance team.",
    " ".join(["A much longer passage about the quarterly roadmap, the migration and the incident review."] * 12),
    "Hiring plan: two engineers and a designer in the second half.",
]

alone = [np.array(embed.embed([t])[0]) for t in texts]
together = np.array(embed.embed(texts))
worst = max(float(np.max(np.abs(together[i] - alone[i]))) for i in range(len(texts)))
check("a text's vector is the same alone or in a mixed-length batch", worst < 1e-6, f"max abs diff {worst}")

# Past one micro-batch, texts run grouped by length and come back in request order, each its own vector.
many = [texts[i % len(texts)] + (" extra" * (i % 7)) for i in range(embed.MICRO_BATCH * 2 + 5)]
many.reverse()  # longest-ish first, so grouping has to reorder
grouped = np.array(embed.embed(many))
own = [np.array(embed._forward([t])[0]) for t in many]
worst = max(float(np.max(np.abs(grouped[i] - own[i]))) for i in range(len(many)))
check(
    f"{len(many)} texts past MICRO_BATCH={embed.MICRO_BATCH}: each gets its own vector, in order",
    worst < 1e-6,
    f"max abs diff {worst}",
)

# Requests queued while the worker is busy are coalesced and answered with their own slices.
worker = threading.Thread(target=embed._coalescer, daemon=True)
results: dict[int, list[list[float]]] = {}


def ask(i: int, batch: list[str]) -> None:
    results[i] = embed._coalesced(batch)


requests = [[texts[0], texts[1]], [texts[2]], [texts[3], texts[0], texts[1]]]
threads = [threading.Thread(target=ask, args=(i, r)) for i, r in enumerate(requests)]
for t in threads:
    t.start()
worker.start()
for t in threads:
    t.join(timeout=60)
ok = all(i in results and len(results[i]) == len(r) for i, r in enumerate(requests))
check("every queued request is answered with its own number of vectors", ok, str({i: len(v) for i, v in results.items()}))
if ok:
    same = all(
        float(np.max(np.abs(np.array(results[i][j]) - alone[texts.index(t)]))) < 1e-6
        for i, r in enumerate(requests)
        for j, t in enumerate(r)
    )
    check("and each slice is its own texts' vectors, in order", same)

# A failure reaches the requests in its batch, and the worker serves the next one.
real = embed.embed
embed.embed = lambda _texts: (_ for _ in ()).throw(RuntimeError("model down"))
try:
    embed._coalesced(["x"])
    check("a failed batch fails its requests", False, "no error raised")
except RuntimeError:
    check("a failed batch fails its requests", True)
embed.embed = real
check("the worker keeps serving after a failure", len(embed._coalesced([texts[1]])) == 1)

if FAILED:
    print(f"{FAILED} embed coalescing check(s) failed")
    sys.exit(1)
print("all embed coalescing checks passed")
