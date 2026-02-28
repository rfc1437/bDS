# Semantic Similarity in bDS: A Zettelkasten-inspired Feature

## Concept

The goal is to surface **thematically related posts** when writing or viewing a post in bDS — not as an authoritative classification, but as an *impulse*: "Have I written something similar before? Where could I explore further?"

This is inspired by Niklas Luhmann's Zettelkasten method, where the system would surprise its author with unexpected connections. The key difference from Luhmann's academic use case: bDS serves a **personal epistemic network** across diverse topics (programming, board games, social topics, professional interests), not a focused research domain. Cross-domain connections are a feature, not a flaw.

The algorithm finds the surface. The human finds the depth.

---

## Technical Approach

### Why not full-text search?

Text search (BM25, LIKE queries) only finds shared words. Semantic similarity finds shared *meaning* — a post about emergent structures in game design can surface next to one about software architecture, even with zero word overlap.

### Embeddings

Text is converted into high-dimensional vectors. Similarity becomes geometric proximity. Small, distilled models can do this efficiently without requiring a GPU or external API.

**Recommended model:** `Xenova/all-MiniLM-L6-v2`
- ~90 MB on disk (ONNX format)
- ~150–200 MB RAM at runtime
- 50–150ms inference time per post on CPU
- 384-dimensional vectors
- Works well for mixed German/English content
- No API key, fully local

**Lighter alternative:** `all-MiniLM-L4-v2` (~50 MB, minimal quality difference for this use case)

**Node.js library:** [`@huggingface/transformers`](https://github.com/xenova/transformers.js)
- Runs ONNX models natively in Node.js
- Downloads and caches model to `~/.cache/huggingface/` on first run
- Subsequent runs load from local cache

---

## Architecture

### Storage: sqlite-vec

Since bDS already uses SQLite (via Drizzle ORM) as a caching layer, the natural fit is [`sqlite-vec`](https://github.com/asg017/sqlite-vec) — a SQLite extension for vector search by Alex Garcia (the actively maintained successor to `sqlite-vss`).

**Node.js integration:**
```js
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const sqlite = new Database('bds.sqlite')
sqliteVec.load(sqlite)  // must happen before Drizzle init
const db = drizzle(sqlite)
```

**Schema** (raw SQL migration, outside Drizzle schema — virtual tables are not supported by Drizzle):
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS post_embeddings
USING vec0(
  post_id TEXT PRIMARY KEY,
  embedding FLOAT[384]
);
```

**Similarity query:**
```sql
SELECT p.id, p.title, e.distance
FROM post_embeddings e
JOIN posts p ON e.post_id = p.id
WHERE e.embedding MATCH ?
  AND k = 5
ORDER BY distance;
```

---

## Integration with bDS Hooks

bDS already has file system hooks that fire when posts change (triggered by external edits, e.g. via git sync across machines). The embedding step fits naturally into the existing cache-update hook:

```js
async function onPostChanged(filePath) {
  const post = parseMarkdownFile(filePath)
  const embedding = await embedText(post.content)  // ~100ms

  db.transaction(() => {
    updatePostCache(post)           // existing cache logic
    db.run(sql`
      INSERT OR REPLACE INTO post_embeddings(post_id, embedding)
      VALUES (${post.id}, ${serializeVector(embedding)})
    `)
  })()
}
```

**Git sync bonus:** On first `git pull` to a new machine, hooks fire for all posts, automatically building the full vector index — no separate setup step needed.

---

## UX Recommendation

- Show **3–5 related posts** maximum — enough for an impulse, not so many it becomes a management task
- Label them clearly as *"thematically related"*, not *"you should read"*
- A low similarity threshold is fine — unexpected connections are often the most valuable
- No need for user-facing controls over the algorithm; simplicity serves the use case

---

## Key Libraries

| Purpose | Library | npm |
|---|---|---|
| Embedding model (local) | Hugging Face Transformers.js | `@huggingface/transformers` |
| Vector search in SQLite | sqlite-vec | `sqlite-vec` |
| SQLite driver | better-sqlite3 | `better-sqlite3` |
| ORM (already in bDS) | Drizzle ORM | `drizzle-orm` |

---

## Philosophical Note

Luhmann's Zettelkasten was monothematic by design — everything fed into a single sociological theory. A personal blog spanning programming, board games, MTG, and everyday life is structurally different. The vector space will reflect that diversity and occasionally bridge domains in ways no intentional tagging system would — which is precisely the point.

The system is not meant to organize knowledge. It is meant to make existing connections *visible*.
