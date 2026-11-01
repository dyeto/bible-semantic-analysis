"""Export local embeddings to static website data. No API calls."""
import gzip
import json
from itertools import combinations_with_replacement
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'dist/data'
BOOKS = ['Matthieu', 'Marc', 'Luc', 'Jean']
MIN_SCORE = 0.80


def prepare():
    source = ROOT / 'data/embeddings/gospels'
    metadata = json.loads((source / 'metadata.json').read_text(encoding='utf-8'))
    vectors = np.load(source / 'embeddings.npy', allow_pickle=False).astype(np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if vectors.shape != (len(metadata), 1024) or not np.isfinite(vectors).all() or np.any(norms == 0):
        raise ValueError('Invalid embeddings or metadata alignment.')
    vectors /= norms
    indices = [[i for i, v in enumerate(metadata) if v['book_name'] == book] for book in BOOKS]
    if any(not rows for rows in indices):
        raise ValueError('Missing gospel.')
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {'model': 'mistral-embed', 'translation': 'Louis Segond 1910', 'minScore': MIN_SCORE,
                'books': [], 'pairs': {}}
    for name, rows in zip(BOOKS, indices):
        manifest['books'].append({'name': name, 'verses': [
            {'ref': f"{metadata[i]['chapter']}:{metadata[i]['verse']}",
             'text': metadata[i]['text'].replace('¶', '').strip()} for i in rows]})
    for a, b in combinations_with_replacement(range(4), 2):
        scores = np.clip(vectors[indices[a]] @ vectors[indices[b]].T, -1, 1)
        if a == b:
            np.fill_diagonal(scores, 1.0)
        scores = scores.ravel()
        selected = np.flatnonzero(scores >= MIN_SCORE)
        selected = selected[np.argsort(-scores[selected], kind='stable')]
        key = f'{a}-{b}'
        payload = (np.array([len(selected)], dtype='<u4').tobytes()
                   + scores[selected].astype('<f4').tobytes()
                   + selected.astype('<u4').tobytes())
        target = OUT / f'{key}.bin.gz'
        target.write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
        manifest['pairs'][key] = {'file': target.name, 'count': len(selected), 'cols': len(indices[b])}
        print(f'{BOOKS[a]} / {BOOKS[b]}: {len(selected):,} pairs, {target.stat().st_size / 1e6:.1f} MB')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    prepare()
