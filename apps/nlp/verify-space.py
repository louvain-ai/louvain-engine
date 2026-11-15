"""The sidecar's vectors are the model's: one running embedding sidecar checked against a torch reference of the same
checkpoint, on texts that exercise what a space depends on (the query instruction, a document, a text cut at the token
limit, Unicode). It is the parity check for a model the in-process embedder cannot run.

    python apps/nlp/verify-space.py --url http://127.0.0.1:8091 --model <checkpoint dir or hub id> \\
      [--pooling last] [--dim 768] [--instruction "Instruct: …\\nQuery: "] [--token <sidecar bearer>]

Needs torch and transformers (not in the sidecar image) — the transformers major version that SAVED the checkpoint,
or newer (`older_reference`). Exits 0 only when every cosine is within 1e-4 of 1 and the sidecar states the space it
was asked for.
"""

import argparse
import json
import sys
import urllib.request

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

QWEN_QUERY = "Instruct: Given a question about a company's work, retrieve the passages that answer it\nQuery: "


def sidecar(url: str, texts: list[str], token: str) -> tuple[np.ndarray, dict]:
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{url.rstrip('/')}/embed", json.dumps({"texts": texts}).encode(), headers)
    body = json.loads(urllib.request.urlopen(req, timeout=120).read())
    return np.array(body.get("vectors") or body.get("embeddings"), dtype=np.float32), body.get("space") or {}


def older_reference(model: str) -> str | None:
    """Why this transformers cannot be the reference for `model`, or None.

    A checkpoint is read by the transformers that saved it: 5.x writes Qwen3's RoPE base inside `rope_parameters`, and
    4.x — what optimum exports with — reads only a top-level `rope_theta` and silently runs at 10,000. A 4.x reference
    makes that same mistake, so it agrees with a wrong 4.x export (such an export lands at a cosine well below 1 from
    the checkpoint's own 5.x). A reference older than the checkpoint's saving version is refused."""
    import os
    import transformers

    cfg = os.path.join(model, "config.json")
    if not os.path.isfile(cfg):
        return None  # a hub id: its config is the hub's, read by whatever reads it
    saved = str(json.load(open(cfg)).get("transformers_version") or "")
    major = lambda v: int(v.split(".")[0]) if v.split(".")[0].isdigit() else 0
    if saved and major(transformers.__version__) < major(saved):
        return f"the checkpoint was saved by transformers {saved}; this reference is {transformers.__version__}"
    return None


def reference(model: str, texts: list[str], pooling: str, dim: int) -> np.ndarray:
    tok = AutoTokenizer.from_pretrained(model, padding_side="left" if pooling == "last" else "right")
    m = AutoModel.from_pretrained(model, torch_dtype=torch.float32).eval()
    out = []
    for text in texts:
        b = tok([text], return_tensors="pt", truncation=True, max_length=512)
        with torch.inference_mode():
            h = m(**b).last_hidden_state
        v = h[:, -1] if pooling == "last" else (h * b["attention_mask"][..., None]).sum(1) / b["attention_mask"].sum()
        v = v[0, :dim].numpy()
        out.append(v / np.linalg.norm(v))
    return np.array(out, dtype=np.float32)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--pooling", default="last", choices=["last", "mean"])
    p.add_argument("--dim", type=int, default=768)
    p.add_argument("--instruction", default=QWEN_QUERY)
    p.add_argument("--token", default="")
    a = p.parse_args()
    texts = [
        # Invented sample text: no account, person or figure here is real.
        a.instruction + "Who owns the renewal for the Halcyon account?",
        "The Halcyon renewal is owned by Priya Okafor; it closes in March at 120,000 EUR.",
        "Café déjà vu — naïve Zoë's résumé (日本語のテキスト) ✓",
        "renewal " * 2000,
    ]
    refused = older_reference(a.model)
    if refused:
        print(f"FAIL {refused}: run the reference on the checkpoint's own major version")
        return 1
    got, space = sidecar(a.url, texts, a.token)
    want = reference(a.model, texts, a.pooling, a.dim)
    ok = True
    if space.get("pooling") != a.pooling or int(space.get("dimensions", 0)) != a.dim:
        print(f"FAIL the sidecar states {space}, not pooling={a.pooling} dimensions={a.dim}")
        ok = False
    for text, g, w in zip(texts, got, want):
        cos = float(g @ w)
        good = abs(1 - cos) <= 1e-4
        ok = ok and good
        print(f"{'ok  ' if good else 'FAIL'} cosine {cos:.6f}  {text[:48]!r}")
    print("the sidecar's vectors are the model's" if ok else "the sidecar's vectors are NOT the model's")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
