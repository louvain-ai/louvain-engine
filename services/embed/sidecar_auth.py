"""Bearer authentication for the sidecars, one module so there is one check.

A private network is not an authentication: whatever shares it can reach a sidecar, so each accepts one shared bearer,
`LOUVAIN_SIDECAR_TOKEN` (the engine's `up` makes one per install). Unset, a sidecar answers anybody, for a local run.
Each sidecar reads the token through its own `setting()` and hands it in, so `verify-nlp.mjs` can check every name a
compose file passes. `/healthz` stays open, since a health probe carries no secret. The comparison hashes both sides
first, so a refusal's timing shows neither the value's length nor where it differs.
"""

import hashlib
import hmac
from email.message import Message


def authorized(headers: Message, token: str) -> bool:
    """True when no token is configured, or the request carries exactly it."""
    if not token:
        return True
    presented = headers.get("authorization") or ""
    expected = f"Bearer {token}"
    return hmac.compare_digest(
        hashlib.sha256(presented.encode()).digest(),
        hashlib.sha256(expected.encode()).digest(),
    )


def describe(token: str) -> str:
    """For the boot line: whether auth is on, never the token."""
    return "auth: bearer" if token else "auth: open"
