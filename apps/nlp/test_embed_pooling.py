"""A model's pooling and width are configuration, and they pool the same whatever the batch looks like.

Run: python apps/nlp/test_embed_pooling.py (the embedding sidecar's requirements; the default model in the HF cache,
which `embed` loads at import).

  - `last` takes each text's last REAL token, whether the tokenizer padded on the right or the left: the same hidden
    states give the same vector either way, and padding never reaches it.
  - `mean` is the masked mean it always was.
  - A Matryoshka model is cut to `DIM` and re-normalised; its leading dimensions keep their direction.
"""

import os
import sys

os.environ["LOUVAIN_EMBEDDING_MATRYOSHKA"] = "true"
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402

import embed  # noqa: E402

FAILED = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global FAILED
    print(("ok: " if cond else "FAIL: ") + label + ("" if cond else f" — {detail}"))
    if not cond:
        FAILED += 1


rng = np.random.default_rng(7)
WIDE = embed.DIM + 256
# Two texts: 3 real tokens and 5 real tokens, in a batch padded to 5.
real = [rng.normal(size=(3, WIDE)).astype(np.float32), rng.normal(size=(5, WIDE)).astype(np.float32)]
pad = rng.normal(size=(2, WIDE)).astype(np.float32) * 100  # loud padding: any leak is visible

right_hidden = np.stack([np.vstack([real[0], pad]), real[1]])
right_mask = np.array([[1, 1, 1, 0, 0], [1, 1, 1, 1, 1]])
left_hidden = np.stack([np.vstack([pad, real[0]]), real[1]])
left_mask = np.array([[0, 0, 1, 1, 1], [1, 1, 1, 1, 1]])


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


embed.POOLING = "last"
right = embed._pool(right_hidden, right_mask)
left = embed._pool(left_hidden, left_mask)
expected = np.stack([unit(real[0][-1][: embed.DIM]), unit(real[1][-1][: embed.DIM])])
check("last: right padding takes each text's last real token", np.allclose(right, expected, atol=1e-6))
check("last: left padding gives the same vectors", np.allclose(left, expected, atol=1e-6))
check("last: the width is cut to DIM", right.shape == (2, embed.DIM), str(right.shape))

embed.POOLING = "mean"
mean = embed._pool(right_hidden, right_mask)
expected_mean = np.stack([unit(real[0].mean(0)[: embed.DIM]), unit(real[1].mean(0)[: embed.DIM])])
check("mean: masked mean over real tokens only", np.allclose(mean, expected_mean, atol=1e-5))

check("every vector is unit length", np.allclose(np.linalg.norm(right, axis=1), 1.0, atol=1e-6))

embed.MATRYOSHKA = False
narrow = embed._pool(right_hidden[..., : embed.DIM], right_mask)
check("a model already at DIM is not cut", narrow.shape == (2, embed.DIM))
uncut = embed._pool(right_hidden, right_mask)
check("without MATRYOSHKA a wider model is not cut (boot refuses it)", uncut.shape == (2, WIDE))

if FAILED:
    print(f"{FAILED} embed pooling check(s) failed")
    sys.exit(1)
print("all embed pooling checks passed")
