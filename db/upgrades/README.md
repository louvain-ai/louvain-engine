# Schema upgrades

A release that changes the schema adds its upgrades here, each an idempotent SQL file, and `./engine reindex`
applies them in name order in one transaction (see Reindex in the operations guide). This release, the first, ships
none.
