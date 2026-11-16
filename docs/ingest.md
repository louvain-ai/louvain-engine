# Ingest

**In short:** `./engine ingest folder --folder <path>` loads a folder, `./engine ingest records --records <file>` loads
JSON records, and `POST /ingest` takes records over HTTP. Run it again and only what changed is loaded.

Every source runs the same way: `./engine ingest <source>`, with the fields of the source's request as flags.
`./engine ingest <source> --help` lists them, and a wrong one is refused in the words of the source's own schema:

```text
$ ./engine ingest folder --help
usage: ./engine ingest folder [flags]
  --folder <value>      the folder to keep the collection in step with; required
  --collection <value>  the collection's name; the folder's own name by default
  --keep                remove nothing the source no longer lists
  --yes                 remove even when most of the collection would go
  --take-over           take over a collection another source feeds
  --files <value>       the folder files the items name may be read under
  --help                these lines
$ ./engine ingest folder --folder nowhere
engine: folder: nowhere is not a folder that exists
```

Each source fills a **collection**: the folder's or file's name unless you pass `--collection`. A name is letters,
digits, dashes and underscores, up to 100 characters. A collection belongs to the source that fills it.

## Load a folder

1. Run **`./engine ingest folder --folder <path>`**.
2. Run it again whenever the folder changes. New files are added, changed ones updated, moved ones moved and deleted
   ones removed.

```text
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
  backups.md: added (text)
  ops/on-call.md: added (text)
"notes": 2 added, 0 updated, 0 removed, 0 unchanged; 2 new passages
keyword index: 2 indexed
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
"notes": 0 added, 0 updated, 0 removed, 2 unchanged; 0 new passages
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
  backups.md: updated (text)
"notes": 0 added, 1 updated, 0 removed, 1 unchanged; 1 new passage
keyword index: 1 indexed
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
  ops/on-call.md: removed
"notes": 0 added, 0 updated, 1 removed, 1 unchanged; 0 new passages
```

```text
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
  archive/backups.md: moved (was backups.md)
"notes": 0 added, 0 updated, 1 moved, 0 removed, 0 unchanged; 1 new passage
keyword index: 1 indexed
```

Each file's key is its path inside the folder, its title the file name, its folder the directory, and its date the
file's modification time. Symbolic links are skipped and reported.

### What protects a collection

- A different folder is refused before anything is read. Pass **`--take-over`** to load it into this collection anyway,
  or **`--collection <name>`** to load it into another.

  ```text
  $ ./engine ingest folder --folder other/notes
  ingesting other/notes into "notes"
  engine: "notes" was loaded from …/notes, not …/other/notes. Nothing was read.
  Name another collection with --collection, or take this one over with --take-over.
  ```

- A folder that lists nothing, or could not be read whole, removes nothing:

  ```text
  $ ./engine ingest folder --folder empty/notes --take-over
  ingesting empty/notes into "notes"
  "notes": 0 added, 0 updated, 0 removed, 0 unchanged; 0 new passages
  nothing removed: the source listed nothing.
  ```

- A run that would remove more than ten items and more than half the collection needs **`--yes`**.
- **`--keep`** removes nothing.

## Load records

1. Write one JSON object a line, each with a `key` and either `text` or `file`.
2. Run **`./engine ingest records --records <file.jsonl>`** (`-` reads standard input). Add **`--files <folder>`** to let
   items name files in that folder.

```text
$ ./engine ingest records --records tickets.jsonl
ingesting tickets.jsonl into "tickets"
  T-1: added
  T-2: added
"tickets": 2 added, 0 updated, 0 removed, 0 unchanged; 2 new passages
keyword index: 2 indexed
```

| Field | What it is |
| --- | --- |
| `key` | The item's identity in its collection, taken exactly as written (at most 1,000 characters). The same key is the same document across edits |
| `text` | Its text (at most 2,000,000 characters) |
| `file` | A file to read through the file readers, by a path inside the folder `--files` names |
| `title` | Its title |
| `kind` | `document`, `message` or `record` |
| `container` | A folder inside the collection: a directory, a channel, a project |
| `date`, `precision` | When it was written or happened, and how precisely (`instant`, `day`, `month`, `year`, `unknown`) |
| `updated` | When the source last changed it |
| `author` | Who wrote it |
| `url` | Its address (http or https) |
| `app` | The app it shows as: lowercase letters, digits and dashes, not one of the engine's own names (`ingest`, `http`, `records`, …) |
| `revision` | The source's own fingerprint of this version; without one, the engine hashes the item |
| `removed` | `true` removes the key |

An unknown field is refused by name:

```text
$ ./engine ingest records --records bad.jsonl --collection tickets
ingesting bad.jsonl into "tickets"
  line 1 (T-3): skipped, unknown field "tilte"
"tickets": 0 added, 0 updated, 0 removed, 0 unchanged; 0 new passages
skipped 1: 1 unknown field "tilte"
```

### Remove a record

1. Send its key with **`"removed": true`**. A records file lists only what it sends, so nothing else is removed.

```text
$ ./engine ingest records --records rm.jsonl --collection tickets
ingesting rm.jsonl into "tickets"
  T-1: removed
"tickets": 0 added, 0 updated, 1 removed, 0 unchanged; 0 new passages
```

### Late and replayed changes

- An item whose `updated` (or `date`) is older than the revision held is refused:

  ```text
  $ ./engine ingest records --records old.jsonl --collection tickets
  ingesting old.jsonl into "tickets"
    T-2: skipped, stale: older than the revision held
  "tickets": 0 added, 0 updated, 0 removed, 0 unchanged; 0 new passages
  skipped 1: 1 stale: older than the revision held
  ```

- A revision replaced or removed is kept as a tombstone for 90 days; sending it again is refused unless it states a
  later `updated`. To add back exactly what you removed, send it with a later `updated`.

## Send records over HTTP

1. Set **`LOUVAIN_ENGINE_INGEST_TOKEN`** in `.env`: at least 32 characters, and not the read token.
2. In **`engine.config.ts`**, uncomment the three source imports and the `sources` line. It names the folder and
   records sources too, since a configuration's list replaces the defaults: `sources: [folder(), records(),
   http({ token: process.env.LOUVAIN_ENGINE_INGEST_TOKEN })]`. Without that line the door stays shut, whatever `.env`
   holds.
3. Run **`./engine down`**, then **`./engine up`**.
4. POST a collection and its items to **`/ingest`** with that token. Passing the header on standard input keeps the
   token out of the process list.

```text
$ printf 'Authorization: Bearer %s\n' "$LOUVAIN_ENGINE_INGEST_TOKEN" | curl -s -H @- -H 'content-type: application/json' \
    -d '{"collection":"desk","items":[{"key":"D-1","title":"Desk booking","text":"Desks on floor 3 are booked through the facilities desk."}]}' \
    http://127.0.0.1:8080/ingest
{"collection":"desk","changed":{"added":1,"updated":0,"moved":0,"removed":0,"unchanged":0},"items":[{"key":"D-1","change":"added"}]}
```

Each item is answered on its own. The read token, a collection another source fills, and a body that is not a
collection and its items are refused:

```text
{"error":"unauthorized"}
{"error":"invalid_request","message":"\"notes\" is fed by the folder source, not this one. Nothing was read."}
```

```text
{"collection":"desk","items":[{"key":"D-1"}]}
→ 200 {"collection":"desk","changed":{"added":0,"updated":0,"moved":0,"removed":0,"unchanged":0},"items":[{"key":"item 1 (D-1)","skipped":"text: an item needs exactly one of text or file"}]}
{"collection":"desk","items":[{"key":"D-3","text":"x","kind":"grant"}]}
→ 200 {…,"items":[{"key":"item 1 (D-3)","skipped":"kind: Invalid option: expected one of \"document\"|\"message\"|\"record\""}]}
{"collection":"desk","facts":[{"a":1}]}
→ 400 {"error":"invalid_request","message":"items: Invalid input: expected array, received undefined"}
```

A request is at most 8 MB and 500 items, and one is taken at a time (another is answered 429). The door never reads a
file an item names. Items carry only content: no caller can send a permission, a membership or facts.

## Write a source of your own

1. Implement **`IngestSource`** from `packages/engine-core/src/ingest/source.ts`: a collection, an origin,
   whether it lists everything (`"all"`) or only what it sends (`"some"`), and an async iterable of items.
2. Run it as a script that prints JSON Lines, and pipe it into **`./engine ingest records --records -`**.

`examples/an-ingest-source` is a whole one in a dozen lines. A source written as a plugin and named in
`engine.config.ts` runs by its name instead, its request's fields as its flags (a field's `.describe()` is its line in
`--help`): [Plugins](plugins.md), "Add a source".

## What a run does

| The item | What happens |
| --- | --- |
| A new key | Added |
| The same key, same revision | Unchanged: nothing written or embedded |
| The same key, new revision | Updated; the document keeps its id |
| A key gone from a folder | Removed, with its passages, vectors and keyword entry |
| A removed key's text under a new key | Reported as moved |

The revision is the item's `revision`, or else a hash of the item. One run at a time writes to a collection; a run that
dies frees it after five minutes. Each document is cut into passages, embedded and indexed. No language model reads
it, and the engine does not screen text: a document holding instructions to a model is loaded like any other.
