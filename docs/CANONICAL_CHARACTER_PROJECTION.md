# Reviewed character projection

`GET /api/v1/game-data/canonical-characters` computes a read-only projection from the latest approved Genshin-DB, Enka avatar/localization, and KQM TCL snapshots plus current accepted identity-link decisions.

Only identity links explicitly marked **accepted** are included. Rejected, deferred, ambiguous, unmatched, and unreviewed links are excluded. Each included row preserves source keys, URLs, revisions, versions, the review fingerprint, and matching method.

Field states:

- **corroborated:** both Genshin-DB and Enka provide a recognized value and their normalized values agree.
- **single-source:** only one approved source provides a recognized value. The value remains a candidate.
- **conflict:** sources provide different recognized values. The projected value is `null` until separately adjudicated.
- **adjudicated:** a reviewer selected one of the current source values for this exact conflict fingerprint. The decision records the selected source and retains both sides of the original evidence; it does not make that source globally authoritative.
- **unknown:** no supported value is present.

No source wins a conflict automatically, and this projection is marked `candidate` and `calculationEligible: false`. A selected field value must be one of the values currently present in source evidence. Field decisions are bound to the identity-link fingerprint, field name, source references, and compared values; stale evidence cannot be selected. Decisions may be deferred and later updated, with a complete review history. Its SHA-256 version is deterministic for the same source versions, accepted identity links, and field decisions. `POST /api/v1/game-data/canonical-characters/snapshots` with an empty JSON object stores the current projection as an immutable historical review artifact. The unique content hash makes repeated saves idempotent; a later projection with changed approved sources or review decisions receives a separate snapshot. Use the history list and snapshot-by-ID endpoints to inspect saved versions. These snapshots are not approved canonical game-data datasets and cannot feed authoritative calculations.

Compare saved versions with `GET /api/v1/game-data/canonical-characters/snapshots/compare?from={id}&to={id}`. The comparison follows stable source record keys across dataset versions and reports added/removed accepted characters, changes to source dataset versions, and field value/state/evidence changes. It is a comparison of saved accepted-link projections; it does not yet provide a complete historical report of unmatched records or source-only candidates.
