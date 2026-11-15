# source-folder

A folder as a collection: every file under it, keyed by its path relative to the folder. It lists the folder whole,
so a file gone from it is removed from the collection; a directory it cannot read makes the listing incomplete, and
then nothing is removed. Links are never followed and hidden names are left out. It reads no file itself: the engine
reads each one through the file readers, inside this folder.

    ./engine ingest folder --folder ./handbook --collection handbook

It is one of the two sources the engine runs when engine.config.ts names none. Its tests are the engine's ingest
tests.
