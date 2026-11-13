# Imports

# Imports

## Implemented source-data imports

- **Genshin-DB:** stage allowlisted English gzip categories in `storage/imports/genshin-db/`, then run `npm run game-data:preview`. The character file is required; supported categories are optional. Data is validated, content-versioned, shown as a draft with per-category change counts, and approved explicitly. Omitted records carry forward.
- **Enka localizations:** stage `store/gi/locs.json` as `storage/imports/enka/locs.json`, then run `npm run enka-l10n:preview`. Supported language/hash mappings are validated, content-versioned, and approved explicitly. Omitted labels carry forward. Character names resolve only when an approved localization hash exactly matches an approved Enka avatar definition.

## General import rules

Each import parses and validates into a preview, shows additions, changes, missing fields, and provenance, then requires approval and applies transactionally. Missing data never deletes existing records. Imported, confirmed, and manually corrected values remain distinguishable. Account imports such as GOOD and Enka UID showcase data are still pending; source-data catalog imports do not change account inventories.
