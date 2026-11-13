# Backups and recovery

Backups and restore are not implemented yet. The database is stored under `storage/database/`. A future backup uses SQLite's online backup mechanism or a coordinated checkpoint, includes schema and dataset versions, and is integrity-checked before restore. Selective account restore must preserve other accounts.
