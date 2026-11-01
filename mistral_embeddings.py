"""Mistral batch embeddings, called from embeddings.ipynb (no CLI).

API format: https://docs.mistral.ai/studio/batch-processing
"""
import json
import os
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent
BASE_URL = "https://api.mistral.ai/v1"
MODEL = "mistral-embed"
GOSPELS = {"Matthieu", "Marc", "Luc", "Jean"}


def prepare_jsonl(test_size=10, bible_path=None, batch_dir=None):
    """Write test + full JSONL and matching metadata; return their paths.

    The test uses evenly spaced verses across the corpus (deterministic).
    Original text is preserved; only paragraph marks and whitespace are cleaned
    in embedding_text, which is the exact text sent to Mistral.
    Existing preparation files are replaced when this function is called.
    """
    bible_path = Path(bible_path) if bible_path else ROOT / "data/segond_1910.json"
    batch_dir = Path(batch_dir) if batch_dir else ROOT / "data/batch"
    bible = json.loads(bible_path.read_text(encoding="utf-8"))
    verses = []
    for v in bible["verses"]:
        if v["book_name"] not in GOSPELS:
            continue
        text = " ".join(v["text"].replace("¶", " ").split())
        if not text:
            raise ValueError(f"Empty verse: {v}")
        verses.append({
            "custom_id": f"{v['book']}:{v['chapter']}:{v['verse']}",
            "book_name": v["book_name"], "book": v["book"],
            "chapter": v["chapter"], "verse": v["verse"],
            "text": v["text"], "embedding_text": text,
            "translation": bible["metadata"]["name"],
        })
    if not verses or len({v["custom_id"] for v in verses}) != len(verses):
        raise ValueError("Gospel verses are missing or their identifiers are duplicated.")
    if type(test_size) is not int or not 1 <= test_size <= len(verses):
        raise ValueError(f"test_size must be an integer between 1 and {len(verses)}.")
    indices = np.linspace(0, len(verses) - 1, test_size, dtype=int)
    batch_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, selected in (("test", [verses[i] for i in indices]), ("gospels", verses)):
        jsonl_path = batch_dir / f"{name}.jsonl"
        metadata_path = batch_dir / f"{name}.metadata.json"
        with jsonl_path.open("w", encoding="utf-8") as f:
            for v in selected:
                request = {"custom_id": v["custom_id"], "body": {
                    "input": v["embedding_text"], "encoding_format": "float",
                }}
                f.write(json.dumps(request, ensure_ascii=False) + "\n")
        metadata_path.write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")
        paths[name] = {"jsonl": jsonl_path, "metadata": metadata_path, "count": len(selected)}
    return paths


def _headers():
    key = os.environ.get("MISTRAL_API_KEY")
    if not key:
        raise RuntimeError("Set MISTRAL_API_KEY before calling the API.")
    return {"Authorization": f"Bearer {key}"}


def submit_batch(jsonl_path):
    """Upload a prepared JSONL and create a mistral-embed batch. Returns the job.

    Each call creates a new paid job; keep its id to retrieve it later.
    """
    path = Path(jsonl_path)
    with path.open("rb") as f:
        response = requests.post(
            f"{BASE_URL}/files", headers=_headers(),
            files={"file": (path.name, f, "application/jsonl")},
            data={"purpose": "batch"}, timeout=120,
        )
    response.raise_for_status()
    file_id = response.json()["id"]
    response = requests.post(
        f"{BASE_URL}/batch/jobs", headers=_headers(),
        json={"input_files": [file_id], "endpoint": "/v1/embeddings",
              "model": MODEL, "timeout_hours": 24}, timeout=120,
    )
    response.raise_for_status()
    return response.json()


def get_batch_job(job_id):
    """Check once, without polling or blocking until completion."""
    response = requests.get(f"{BASE_URL}/batch/jobs/{job_id}", headers=_headers(), timeout=120)
    response.raise_for_status()
    return response.json()


def save_embeddings(job_id, metadata_path, output_dir=None):
    """Download a successful batch and save float32 NPY + aligned metadata.

    Pass the metadata file generated alongside the submitted JSONL.
    Missing, duplicate, unknown or failed results raise instead of silently
    producing an incomplete matrix. No output is saved until validation passes.
    """
    metadata_path = Path(metadata_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    ids = [v["custom_id"] for v in metadata]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("Metadata must contain unique verse identifiers.")
    job = get_batch_job(job_id)
    if job["status"] != "SUCCESS" or job.get("failed_requests", 0):
        raise RuntimeError(
            f"Batch not fully successful: status={job['status']}, "
            f"failed_requests={job.get('failed_requests')}, error_file={job.get('error_file')}"
        )
    if job.get("model") != MODEL or job.get("endpoint") != "/v1/embeddings":
        raise ValueError("Expected a mistral-embed embeddings batch.")
    if not job.get("output_file"):
        raise RuntimeError("Batch has no output_file.")
    response = requests.get(
        f"{BASE_URL}/files/{job['output_file']}/content", headers=_headers(), timeout=120,
    )
    response.raise_for_status()
    vectors = {}
    for line in response.content.decode("utf-8").splitlines():
        if not line.strip():
            continue
        result = json.loads(line)
        custom_id = result["custom_id"]
        reply = result.get("response") or {}
        if result.get("error") or reply.get("status_code") != 200:
            raise ValueError(f"Failed result for {custom_id}: {result}")
        if custom_id in vectors:
            raise ValueError(f"Duplicate result: {custom_id}")
        data = reply["body"]["data"]
        if len(data) != 1 or data[0]["index"] != 0:
            raise ValueError(f"Expected one embedding for {custom_id}.")
        vector = np.asarray(data[0]["embedding"], dtype=np.float32)
        if vector.shape != (1024,) or not np.isfinite(vector).all():
            raise ValueError(f"Invalid embedding for {custom_id}: shape={vector.shape}")
        vectors[custom_id] = vector
    missing, extra = set(ids) - vectors.keys(), vectors.keys() - set(ids)
    if missing or extra:
        raise ValueError(f"Results/metadata mismatch: {len(missing)} missing, {len(extra)} unknown.")
    embeddings = np.stack([vectors[custom_id] for custom_id in ids])
    aligned = [dict(v, row=i, model=MODEL, job_id=job_id) for i, v in enumerate(metadata)]
    name = metadata_path.name.removesuffix(".metadata.json")
    output_dir = Path(output_dir) if output_dir else ROOT / "data/embeddings" / name
    output_dir.mkdir(parents=True, exist_ok=True)
    np.save(output_dir / "embeddings.npy", embeddings, allow_pickle=False)
    (output_dir / "metadata.json").write_text(
        json.dumps(aligned, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    return output_dir


def load_embeddings(output_dir):
    """Return (matrix, metadata); metadata[i] describes matrix[i]."""
    output_dir = Path(output_dir)
    matrix = np.load(output_dir / "embeddings.npy", allow_pickle=False)
    metadata = json.loads((output_dir / "metadata.json").read_text(encoding="utf-8"))
    if matrix.ndim != 2 or matrix.shape[0] != len(metadata):
        raise ValueError("Matrix and metadata have inconsistent sizes.")
    return matrix, metadata
