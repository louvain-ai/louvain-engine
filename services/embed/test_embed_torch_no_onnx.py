"""The torch backend serves a model that has no ONNX export.

Run: python services/embed/test_embed_torch_no_onnx.py (the sidecar's requirements plus torch and transformers; bge-base in
the HF cache).

A model kept only as a checkpoint (a custom embedding checkpoint) has no `model.onnx`. `embed.py` used to open an ONNX
session at import whatever the backend, so `LOUVAIN_EMBEDDING_BACKEND=torch` refused to start on it. Here a model
directory holds only a tokenizer, the torch backend loads bge-base, and the sidecar must import, open no ONNX session
and embed with torch. The vector is checked against the same weights run directly, so the backend is the one that
answered.
"""

import os
import shutil
import sys
import tempfile

from huggingface_hub import hf_hub_download

model_dir = tempfile.mkdtemp()
shutil.copy(hf_hub_download("Xenova/bge-base-en-v1.5", "tokenizer.json"), os.path.join(model_dir, "tokenizer.json"))
os.environ["LOUVAIN_EMBEDDING_BACKEND"] = "torch"
os.environ["LOUVAIN_EMBEDDING_MODEL_DIR"] = model_dir
os.environ["LOUVAIN_EMBEDDING_TORCH_MODEL"] = "BAAI/bge-base-en-v1.5"
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import AutoModel, AutoTokenizer  # noqa: E402

import embed  # noqa: E402

FAILED = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global FAILED
    print(("ok: " if cond else "FAIL: ") + label + ("" if cond else f" — {detail}"))
    if not cond:
        FAILED += 1


check("no ONNX file in the model directory", not os.path.exists(os.path.join(model_dir, "model.onnx")))
check("no ONNX session opened", embed._sess is None)
text = "The rollback plan for the indexer is in the runbook."
[vector] = embed.embed([text])
tok = AutoTokenizer.from_pretrained("BAAI/bge-base-en-v1.5")
ref = AutoModel.from_pretrained("BAAI/bge-base-en-v1.5", torch_dtype=torch.float32).eval()
with torch.no_grad():
    batch = tok([text], return_tensors="pt")
    hidden = ref(**batch).last_hidden_state.numpy()
expected = embed._pool(hidden, batch["attention_mask"].numpy())[0]
cosine = float(np.dot(vector, expected) / (np.linalg.norm(vector) * np.linalg.norm(expected)))
check("embeds with torch, the same vector as the weights run directly", cosine > 0.999999, f"cosine {cosine}")
shutil.rmtree(model_dir)
sys.exit(1 if FAILED else 0)
