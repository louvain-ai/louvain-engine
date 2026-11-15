# reader-documents

The general file reader: PDF, the office and OpenDocument formats, EPUB, RTF, HTML, CSV, mail, calendars, subtitles
and plain text, through `@louvain/doctext`. It is one of the two readers the engine runs when engine.config.ts names
none.

It claims each extension as a `fallback`, so a reader of your own that claims the same extension takes it over:

```ts
readers: [myPdf(), documents(), text()],
```

Its one setting, `extensions`, narrows what it claims to some of the formats it reads; an extension it does not read
stops the start. `documents({ extensions: ["pdf", "docx"] })` reads only PDF and Word files.

The engine holds it to the same bounds as every reader: size, characters and time.
