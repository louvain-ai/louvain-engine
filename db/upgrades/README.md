# Schema upgrades

A release that changes the schema adds its upgrades here, each an idempotent SQL file, and `./engine reindex`
applies them in name order in one transaction (see Reindex in the operations guide). Each takes a database the
release before made to this release's schema:

- `001-passage-instruction-marker.sql`: `passage.instruction_marker`, added empty.
