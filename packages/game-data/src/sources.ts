export type SourceStatus = 'active-reference' | 'adapter-planned' | 'manual-review' | 'candidate-only';
export type SourceDomain = 'official-announcements' | 'characters' | 'weapons' | 'artifacts' | 'materials' | 'enemies' | 'combat-mechanics' | 'account-showcase' | 'account-inventory' | 'endgame-rules' | 'exploration-map' | 'wish-history';

export type GameDataSource = {
  id: string;
  name: string;
  publisher: string;
  url: string;
  status: SourceStatus;
  domains: SourceDomain[];
  scope: string;
  authority: 'official' | 'community-reference' | 'community-format' | 'player-provided';
  coverage: string;
  updatePolicy: string;
  guardrails: string[];
};

export const GAME_DATA_SOURCES: GameDataSource[] = [
  {
    id: 'hoyoverse-official', name: 'Genshin Impact Official Site', publisher: 'HoYoverse',
    url: 'https://genshin.hoyoverse.com/en-us/', status: 'active-reference',
    domains: ['official-announcements', 'characters', 'weapons', 'endgame-rules'],
    scope: 'Officially published descriptions, releases, announcements, and event details.', authority: 'official',
    coverage: 'Official announcements and showcased content; not a complete machine-readable database.',
    updatePolicy: 'Use versioned official notices as primary evidence; retain publication date and game version.',
    guardrails: ['Official copy does not establish hidden combat behavior.', 'Do not mirror artwork or site content without rights review.'],
  },
  {
    id: 'enka-uid-showcase', name: 'Enka.Network UID API', publisher: 'Enka.Network',
    url: 'https://enka.network/api/uid/{UID}/', status: 'adapter-planned',
    domains: ['account-showcase'], scope: 'Public player info and the characters currently shown in a UID showcase.',
    authority: 'player-provided', coverage: 'Showcase only; a missing avatar list does not mean an empty owned roster.',
    updatePolicy: 'User-initiated UID request; cache by returned TTL; send a descriptive User-Agent and respect 429s.',
    guardrails: ['Never enumerate UIDs or issue bulk discovery requests.', 'Never claim this endpoint contains a full account inventory or unlocked viewpoints.'],
  },
  {
    id: 'enka-game-store', name: 'Enka.Network Game Data Store and API Docs', publisher: 'Enka.Network',
    url: 'https://github.com/EnkaNetwork/API-docs', status: 'active-reference',
    domains: ['characters', 'weapons', 'artifacts', 'materials', 'account-showcase'],
    scope: 'ID, icon, localization, and structure mappings; includes a fixed-source static avatar-definition catalog adapter.',
    authority: 'community-reference', coverage: 'Static avatar definitions are previewable and versioned; names can be resolved from a separately staged and reviewed localization snapshot. Confirmed playable coverage remains incomplete.',
    updatePolicy: 'Fetch only on user request; pin the response hash and source revision, validate mappings, and require explicit approval.',
    guardrails: ['Mapping data is not player inventory.', 'Retain upstream attribution and review repository data-use terms before bundling.'],
  },
  {
    id: 'good-format', name: 'GOOD JSON Format', publisher: 'Genshin Optimizer community',
    url: 'https://www.genshinoptimizer.com/guides/good-file-explained', status: 'adapter-planned',
    domains: ['account-inventory'], scope: 'User-provided character, weapon, and artifact inventory interchange.',
    authority: 'player-provided', coverage: 'Inventory records present in the file; not a global game encyclopedia.',
    updatePolicy: 'Validate supported GOOD versions, preview additions/changes/conflicts, and apply only after approval.',
    guardrails: ['Omitted records never delete account records.', 'An import does not imply categories absent from the file are empty.'],
  },
  {
    id: 'genshin-optimizer', name: 'Genshin Optimizer', publisher: 'Genshin Optimizer community',
    url: 'https://github.com/frzyc/genshin-optimizer', status: 'active-reference',
    domains: ['account-inventory', 'characters', 'weapons', 'artifacts', 'combat-mechanics'],
    scope: 'GOOD compatibility and optimizer data/model references.', authority: 'community-format',
    coverage: 'Its game data and calculations are versioned project outputs, not official ground truth.',
    updatePolicy: 'Reference pinned releases and reviewed GOOD specifications; compare rather than silently copy derived formulas.',
    guardrails: ['Do not assume compatibility equals mechanic verification.', 'Review code/data licenses before redistribution.'],
  },
  {
    id: 'kqm-character-guides', name: 'KeqingMains Character Guides', publisher: 'KeqingMains',
    url: 'https://keqingmains.com/', status: 'active-reference',
    domains: ['characters', 'weapons', 'artifacts', 'combat-mechanics'],
    scope: 'Build, weapon, artifact, team, rotation, and investment recommendations across the playable roster.',
    authority: 'community-reference', coverage: 'Roster-wide guide library; each character and guide has its own coverage and revision date.',
    updatePolicy: 'Store per-guide URLs, author/revision date when available, game-version assumptions, and review status.',
    guardrails: ['Recommendations are community theorycrafting, not official facts.', 'Never infer missing character guides or values from another character.'],
  },
  {
    id: 'kqm-theorycrafting-library', name: 'KeqingMains Theorycrafting Library', publisher: 'KeqingMains',
    url: 'https://library.keqingmains.com/', status: 'active-reference',
    domains: ['characters', 'weapons', 'artifacts', 'combat-mechanics', 'endgame-rules'],
    scope: 'Roster-wide character-reference index, mechanics, evidence, and theorycrafting records; the index adapter tracks page existence only.',
    authority: 'community-reference', coverage: 'Indexed page coverage is versioned separately from the playable roster and does not assert that each page is a full build guide; evidence and freshness vary by page.',
    updatePolicy: 'Import the character index as a reviewed coverage catalog; capture page-level evidence, testing date, game version, confidence, and known disagreements before using technical claims.',
    guardrails: ['Page presence does not establish playable status, recommendation completeness, or mechanic verification.', 'Community-confirmed entries stay distinct from verified official descriptions; experimental or stale pages cannot silently enter calculations.'],
  },
  {
    id: 'hoyolab-interactive-map', name: 'HoYoLAB Official Interactive Map', publisher: 'HoYoverse / HoYoLAB',
    url: 'https://act.hoyolab.com/ys/app/interactive-map/index.html', status: 'manual-review',
    domains: ['exploration-map'], scope: 'Official map experience and user-visible exploration reference.',
    authority: 'official', coverage: 'Map content shown in the official experience; no supported public bulk data adapter established.',
    updatePolicy: 'Use as a reference until a documented, permitted data interface is established.',
    guardrails: ['Do not scrape or bulk-download map tiles/markers without permission and license review.', 'Never infer account-unlocked viewpoints from UID imports.'],
  },
  {
    id: 'project-amber', name: 'Project Amber', publisher: 'Project Amber community',
    url: 'https://gi.yatta.moe/', status: 'candidate-only',
    domains: ['characters', 'weapons', 'artifacts', 'materials', 'enemies'],
    scope: 'Candidate structured catalog for cross-checking game-data updates.', authority: 'community-reference',
    coverage: 'Candidate only; freshness, provenance, and reuse terms must be verified per dataset.',
    updatePolicy: 'Compare by game version with official notices and another data source before approval.',
    guardrails: ['Never treat a third-party catalog as verified solely because it is structured.', 'Keep the source marked candidate until freshness and licensing checks pass.'],
  },
  {
    id: 'genshin-db', name: 'Genshin-DB', publisher: 'Community maintainers',
    url: 'https://github.com/theBowja/genshin-db', status: 'candidate-only',
    domains: ['characters', 'weapons', 'artifacts', 'materials', 'enemies'],
    scope: 'Candidate broad catalog for coverage checks and cross-source comparison.', authority: 'community-reference',
    coverage: 'Broad entity categories; verify patch freshness and field provenance before use.',
    updatePolicy: 'Pin exact release/version; compare against current official and other structured sources.',
    guardrails: ['No unversioned imports.', 'Do not promote fields to verified without provenance and regression review.'],
  },
  {
    id: 'community-mechanics-research', name: 'Community-maintained Mechanics Research', publisher: 'Per-source community maintainers',
    url: 'https://library.keqingmains.com/evidence/combat-mechanics', status: 'manual-review',
    domains: ['combat-mechanics'], scope: 'Evidence-backed but non-official observations and tests.', authority: 'community-reference',
    coverage: 'Mechanic- and page-specific; not a universal set of confirmed formulas.',
    updatePolicy: 'Record the individual test, source, tested game version/date, evidence, and unresolved cases.',
    guardrails: ['An old test date is visible.', 'No inferred value may be labelled verified without independent validation.'],
  },
];

export function validateSourceRegistry(sources: readonly GameDataSource[] = GAME_DATA_SOURCES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const source of sources) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) errors.push(`Invalid source id: ${source.id}`);
    if (ids.has(source.id)) errors.push(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
    try {
      if (new URL(source.url.replace('{UID}', '123456789')).protocol !== 'https:') errors.push(`Source must use HTTPS: ${source.id}`);
    } catch { errors.push(`Invalid source URL: ${source.id}`); }
    if (!source.domains.length || !source.scope || !source.coverage || !source.updatePolicy || !source.guardrails.length) errors.push(`Incomplete source policy: ${source.id}`);
  }
  return errors;
}

const registryErrors = validateSourceRegistry();
if (registryErrors.length) throw new Error(`Invalid source registry: ${registryErrors.join('; ')}`);
