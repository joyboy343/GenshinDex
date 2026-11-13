import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { normalizeAvatarCatalog } from '../apps/server/src/gameCatalog.ts';
import { approveGameCatalog, listCharacterCatalog, previewEnkaAvatarCatalog } from '../apps/server/src/gameCatalog.ts';
import { approveKqmGuides, createKqmCharacterGuidesDraft, listKqmCharacterGuides, listKqmGuideDrafts, parseKqmCharacterIndex, previewKqmCharacterGuides } from '../apps/server/src/guideCatalog.ts';
import { approveGenshinDbDraft, createGenshinDbDraft, listGenshinDbCategory, listGenshinDbCharacters, listGenshinDbDrafts, normalizeGenshinDbSnapshot } from '../apps/server/src/genshinDbSnapshot.ts';
import { approveEnkaLocalizationDraft, createEnkaLocalizationDraft, getEnkaLocalizations, normalizeEnkaLocalizations } from '../apps/server/src/enkaLocalization.ts';
import { approveKqmEvidenceDraft, createKqmEvidenceDraft, listKqmEvidence, parseKqmCharacterPageEvidence } from '../apps/server/src/kqmEvidence.ts';
import { buildCharacterReconciliation, listCharacterFieldReviewHistory, listCharacterLinkReviewHistory, saveCharacterFieldReview, saveCharacterLinkReview } from '../apps/server/src/characterReconciliation.ts';
import { buildCanonicalCharacterProjection, compareCanonicalCharacterSnapshots } from '../apps/server/src/canonicalCharacters.ts';
import { getLatestSuccessfulSourceCheck } from '../apps/server/src/sourceChecks.ts';

const directory = await mkdtemp(join(tmpdir(), 'genshindex-test-'));
const port = 31991;
const child = spawn(process.execPath, ['apps/server/src/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), GENSHINDEX_DB_PATH: join(directory, 'test.sqlite') },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;
const headers = { 'content-type': 'application/json', 'x-genshindex-request': '1' };

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready');
}

after(async () => {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
});

test('health, validated account persistence, and uniqueness', async () => {
  await waitForServer();
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.data.database, 'ok');

  const created = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ nickname: 'Primary', uid: '123456789', server: 'os_europe' }) });
  assert.equal(created.status, 201);
  const account = (await created.json()).data;
  assert.equal(account.nickname, 'Primary');

  const duplicate = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ nickname: 'Second label', uid: '123456789', server: 'os_europe' }) });
  assert.equal(duplicate.status, 409);

  const invalid = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ nickname: 'Invalid UID', uid: 123456789, server: 'os_europe' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');

  const second = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ nickname: 'Alt account', uid: '987654321', server: 'os_asia' }) });
  assert.equal(second.status, 201);
  const secondAccount = (await second.json()).data;
  assert.notEqual(secondAccount.id, account.id);

  const listed = await (await fetch(`${base}/api/v1/accounts`)).json();
  assert.equal(listed.data.length, 2);
  assert.deepEqual(listed.data.map((entry) => entry.id).sort(), [account.id, secondAccount.id].sort());
});

test('sample background job persists progress and completes', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/jobs/sample`, { method: 'POST', headers, body: JSON.stringify({ steps: 2, delayMs: 10 }) });
  assert.equal(response.status, 202);
  const id = (await response.json()).data.id;
  let job;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    job = (await (await fetch(`${base}/api/v1/jobs/${id}`)).json()).data;
    if (job.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.progress, 1);
  assert.match(job.result.note, /no game calculation/i);
});

test('mutations reject missing request guard', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'Blocked' }) });
  assert.equal(response.status, 403);
});

test('serves the local foundation screen without external assets', async () => {
  await waitForServer();
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  const html = await response.text();
  assert.match(html, /GenshinDex/);
  assert.match(html, /no game login required/i);
  const script = await (await fetch(`${base}/app.js`)).text();
  assert.match(script, /api\/v1\/accounts/);
  assert.match(script, /api\/v1\/knowledge/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.match(html, /Knowledge Library/);
  assert.match(html, /Browse registered game-data sources and coverage/);
  assert.match(html, /preview-kqm-guides/);
  assert.match(html, /Offline Genshin-DB snapshot import/);
  assert.match(html, /refresh-local-imports/);
  assert.match(html, /Cross-source character reconciliation/);
  assert.match(script, /api\/v1\/game-data\/reconciliation\/characters/);
  assert.match(script, /api\/v1\/sources/);
  assert.match(script, /api\/v1\/game-data\/imports/);
  const weaponCatalog = await (await fetch(`${base}/api/v1/game-data/genshin-db/weapons`)).json();
  assert.equal(weaponCatalog.data.total, 0);
});

test('rejects foreign hosts and origins', async () => {
  await waitForServer();
  const foreignHost = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/health', headers: { host: 'example.com' } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHost, 400);
  const foreignOrigin = await fetch(`${base}/health`, { headers: { origin: 'https://example.com' } });
  assert.equal(foreignOrigin.status, 403);
});

test('knowledge search returns sourced entries with verification and limits', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/knowledge?q=ICD`);
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.total, 1);
  assert.equal(result.items[0].slug, 'elemental-application-and-icd-basics');
  assert.equal(result.items[0].verificationState, 'community-confirmed');
  assert.match(result.items[0].limitations.join(' '), /not independently tested/i);
  assert.match(result.items[0].sources[0].url, /^https:\/\//);
});

test('source registry covers official, inventory, roster guides, and research sources', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/sources`);
  assert.equal(response.status, 200);
  const sources = (await response.json()).data;
  const ids = new Set(sources.map((source) => source.id));
  for (const required of ['hoyoverse-official', 'enka-uid-showcase', 'enka-game-store', 'good-format', 'genshin-optimizer', 'kqm-character-guides', 'kqm-theorycrafting-library', 'hoyolab-interactive-map', 'project-amber', 'genshin-db']) assert.ok(ids.has(required), `missing source ${required}`);
  const rosterGuides = sources.find((source) => source.id === 'kqm-character-guides');
  assert.match(`${rosterGuides.scope} ${rosterGuides.coverage}`, /playable roster/i);
  assert.match(rosterGuides.guardrails.join(' '), /another character/i);
  const enka = sources.find((source) => source.id === 'enka-uid-showcase');
  assert.match(enka.guardrails.join(' '), /enumerate UIDs/i);
  const good = sources.find((source) => source.id === 'good-format');
  assert.match(good.coverage, /not a global game encyclopedia/i);
});

test('source coverage distinguishes implemented adapters from registry-only sources', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/game-data/coverage`);
  assert.equal(response.status, 200);
  const coverage = (await response.json()).data;
  const enka = coverage.find((item) => item.sourceId === 'enka-game-store');
  const kqmTcl = coverage.find((item) => item.sourceId === 'kqm-theorycrafting-library');
  const good = coverage.find((item) => item.sourceId === 'good-format');
  const amber = coverage.find((item) => item.sourceId === 'project-amber');
  assert.equal(enka.adapterStatus, 'implemented');
  assert.equal(enka.datasetState, 'not-imported');
  assert.equal(enka.freshness.status, 'check-unknown');
  assert.equal(enka.freshness.sourceCheckedAt, null);
  assert.equal(enka.relatedDatasets[0].label, 'localizations');
  assert.equal(enka.relatedDatasets[0].datasetState, 'not-imported');
  assert.equal(kqmTcl.adapterStatus, 'implemented');
  assert.equal(kqmTcl.approvedRecords, 0);
  const genshinDb = coverage.find((item) => item.sourceId === 'genshin-db');
  assert.equal(genshinDb.adapterStatus, 'implemented');
  assert.equal(genshinDb.datasetState, 'not-imported');
  assert.equal(good.adapterStatus, 'not-implemented');
  assert.equal(amber.adapterStatus, 'candidate-only');
  const reconciliation = await fetch(`${base}/api/v1/game-data/reconciliation/characters`);
  assert.equal(reconciliation.status, 200);
  assert.equal((await reconciliation.json()).data.summary.genshinDbCharacters, 0);
  const badFilter = await fetch(`${base}/api/v1/game-data/reconciliation/characters?status=unverified`);
  assert.equal(badFilter.status, 400);
  const canonical = await fetch(`${base}/api/v1/game-data/canonical-characters`);
  assert.equal((await canonical.json()).data.total, 0);
  const staleReview = await fetch(`${base}/api/v1/game-data/reconciliation/reviews`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: '0'.repeat(64), decision: 'accepted' }) });
  assert.equal(staleReview.status, 409);
});

test('character catalog normalizer preserves source fields and maps elements without inventing names', async () => {
  const records = normalizeAvatarCatalog({
    10000002: { NameTextMapHash: 123456, Element: 'Ice', WeaponType: 'WEAPON_SWORD_ONE_HAND', QualityType: 'QUALITY_ORANGE', SideIconName: 'UI_AvatarIcon_Ayaka', SkillOrder: [100, 101, 102] },
    10000003: { Element: 'Electric', WeaponType: 'WEAPON_CLAYMORE', SkillOrder: [] },
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].id, '10000002');
  assert.equal(records[0].element, 'Cryo');
  assert.equal(records[0].nameTextMapHash, '123456');
  assert.equal(records[0].rarity, 5);
  assert.deepEqual(records[0].skillIds, ['100', '101', '102']);
  assert.equal(records[1].element, 'Electro');
  assert.equal(records[1].nameTextMapHash, null);
  assert.throws(() => normalizeAvatarCatalog([]), /JSON object/);
  assert.throws(() => normalizeAvatarCatalog({ nope: {} }), /recognizable avatar/);
});

test('character catalog API does not infer ownership or completeness before a catalog is approved', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/v1/game-data/characters`);
  assert.equal(response.status, 200);
  const characters = (await response.json()).data;
  assert.deepEqual(characters, { dataset: null, total: 0, items: [], localization: { dataset: null, language: 'en' } });
  const invalidLanguage = await fetch(`${base}/api/v1/game-data/localizations?lang=not-a-language`);
  assert.equal(invalidLanguage.status, 400);
  const localizationDrafts = await fetch(`${base}/api/v1/game-data/imports/enka-localizations`);
  assert.deepEqual((await localizationDrafts.json()).data, []);
  const localizationStatus = await fetch(`${base}/api/v1/game-data/localizations/status?lang=en`);
  assert.deepEqual((await localizationStatus.json()).data, { dataset: null, language: 'en', total: 0 });
  const guides = await fetch(`${base}/api/v1/game-data/character-guides`);
  assert.equal(guides.status, 200);
  assert.deepEqual((await guides.json()).data, { dataset: null, total: 0, items: [] });
});

test('character catalog remains a draft until approval and identical source data is idempotent', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE game_datasets(id TEXT PRIMARY KEY,dataset_key TEXT,version TEXT,state TEXT,provenance_json TEXT,created_at TEXT,approved_at TEXT,UNIQUE(dataset_key,version));
    CREATE TABLE game_entities(id TEXT PRIMARY KEY,dataset_id TEXT,entity_type TEXT,entity_key TEXT,canonical_json TEXT,source_url TEXT,source_revision TEXT,completeness TEXT,UNIQUE(dataset_id,entity_type,entity_key));
    CREATE TABLE knowledge_revisions(id TEXT PRIMARY KEY,dataset_id TEXT,revision_type TEXT,occurred_at TEXT,details_json TEXT);
    CREATE TABLE source_check_events(id TEXT PRIMARY KEY,source_id TEXT,dataset_key TEXT,dataset_version TEXT,checked_at TEXT,source_revision TEXT,content_hash TEXT,result TEXT,error_code TEXT);`);
  try {
    const payload = JSON.stringify({ 10000002: { NameTextMapHash: 123, Element: 'Ice', WeaponType: 'SWORD', SkillOrder: [1, 2, 3] } });
    const fakeFetch = async () => new Response(payload, { status: 200, headers: { etag: 'fixture-rev-1', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } });
    const preview = await previewEnkaAvatarCatalog(db, fakeFetch);
    assert.equal(preview.datasetState, 'draft');
    assert.deepEqual(preview.counts, { added: 1, modified: 0, unchanged: 0 });
    assert.equal(listCharacterCatalog(db).total, 0);
    assert.equal(approveGameCatalog(db, preview.datasetId).status, 200);
    const active = listCharacterCatalog(db);
    assert.equal(active.total, 1);
    assert.equal(active.items[0].element, 'Cryo');
    assert.equal(active.items[0].displayName, null);
    const localizations = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [String(123 + index), { en: index === 0 ? 'Localized character name' : `Label ${index}` }]));
    const localizationDraft = createEnkaLocalizationDraft(db, normalizeEnkaLocalizations(Buffer.from(JSON.stringify(localizations))));
    assert.equal(approveEnkaLocalizationDraft(db, localizationDraft.datasetId).status, 200);
    assert.equal(listCharacterCatalog(db).items[0].displayName, 'Localized character name');
    const repeat = await previewEnkaAvatarCatalog(db, fakeFetch);
    assert.equal(repeat.datasetId, preview.datasetId);
    assert.equal(getLatestSuccessfulSourceCheck(db, 'enka-game-store', 'enka-avatar-catalog')?.datasetVersion, preview.version);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM source_check_events WHERE source_id='enka-game-store'").get().count, 2, 'repeat live checks are recorded even for an already-known dataset version');
    assert.equal(repeat.datasetState, 'approved');
    assert.deepEqual(repeat.counts, { added: 0, modified: 0, unchanged: 1 });
  } finally { db.close(); }
});

test('KQM index parser extracts only named character-reference pages and preserves URLs', () => {
  const html = `<a class="card" href="/characters/anemo/aino"><article><h2>📄 Aino</h2><p>Example summary.</p></article></a>
    <a href="/characters/anemo"><article><h2>Anemo</h2></article></a>
    <a href="https://example.com/characters/other/unsafe"><article><h2>Unsafe</h2></article></a>
    <a href="/characters/cryo/aloy"><article><p>No title; do not guess.</p></article></a>`;
  const pages = parseKqmCharacterIndex(html);
  assert.deepEqual(pages.map((page) => [page.slug, page.displayName]), [['aino', 'Aino']]);
  assert.equal(pages[0].pageUrl, 'https://library.keqingmains.com/characters/anemo/aino');
  assert.equal(pages[0].classification, 'character-reference-page');
  assert.throws(() => parseKqmCharacterIndex('<html>changed source layout</html>'), /format was not recognized/);
});

test('KQM staged character pages extract attributed experimental evidence and carry omitted pages forward', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE game_datasets(id TEXT PRIMARY KEY,dataset_key TEXT,version TEXT,state TEXT,provenance_json TEXT,created_at TEXT,approved_at TEXT,UNIQUE(dataset_key,version));
    CREATE TABLE game_entities(id TEXT PRIMARY KEY,dataset_id TEXT,entity_type TEXT,entity_key TEXT,canonical_json TEXT,source_url TEXT,source_revision TEXT,completeness TEXT,UNIQUE(dataset_id,entity_type,entity_key));
    CREATE TABLE knowledge_revisions(id TEXT PRIMARY KEY,dataset_id TEXT,revision_type TEXT,occurred_at TEXT,details_json TEXT);`);
  const pageUrl = (slug) => `https://library.keqingmains.com/characters/geo/${slug}`;
  const pageHtml = (name, stat) => `<html><main><h1>${name}</h1><h2>Base Stats</h2><table><tr><th>Level</th><th>Base DEF</th></tr><tr><td>A6 90</td><td>${stat}</td></tr></table><h2>Attacks</h2><h3>Elemental Skill</h3><p>Transient Blossom damage scales with DEF.</p><ul><li>Displayed duration is 30s.</li></ul><h2>Evidence Vault</h2><p><a href="https://example.test/evidence">Evidence reference</a></p><script>never store script content</script></main></html>`;
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at,approved_at) VALUES ('kqm-index','kqm-character-reference-index','index-v1','approved','{}',?,?)").run(now, now);
    const addIndex = db.prepare("INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?, 'kqm-index','kqm-character-reference',?,?,?,'fixture','partial')");
    addIndex.run('index-albedo', 'albedo', JSON.stringify({ slug: 'albedo', displayName: 'Albedo' }), pageUrl('albedo'));
    addIndex.run('index-zibai', 'zibai', JSON.stringify({ slug: 'zibai', displayName: 'Zibai' }), pageUrl('zibai'));

    const parsed = parseKqmCharacterPageEvidence(pageHtml('Albedo', '876'), { slug: 'albedo', displayName: 'Albedo', pageUrl: pageUrl('albedo') });
    assert.ok(parsed.evidence.some((entry) => entry.kind === 'table' && entry.headers.includes('Base DEF')));
    assert.ok(parsed.evidence.some((entry) => entry.kind === 'statement' && entry.text.includes('Transient Blossom')));
    assert.ok(parsed.evidence.every((entry) => entry.verificationState === 'experimental' && entry.calculationEligible === false));
    assert.ok(parsed.evidence.every((entry) => entry.sourceUrl === pageUrl('albedo') && entry.sourceRevision.startsWith('sha256-')));
    assert.ok(!JSON.stringify(parsed.evidence).includes('never store script content'));

    const first = createKqmEvidenceDraft(db, [{ slug: 'albedo', html: pageHtml('Albedo', '876') }, { slug: 'zibai', html: pageHtml('Zibai', '940') }]);
    assert.equal(first.datasetState, 'draft');
    assert.equal(first.pageCount, 2);
    assert.equal(approveKqmEvidenceDraft(db, first.datasetId).data.state, 'approved');
    const second = createKqmEvidenceDraft(db, [{ slug: 'albedo', html: pageHtml('Albedo', '900') }]);
    assert.equal(second.datasetState, 'draft');
    assert.equal(approveKqmEvidenceDraft(db, second.datasetId).data.state, 'approved');
    const albedo = listKqmEvidence(db, { slug: 'albedo', q: 'Base DEF', limit: 100 });
    assert.equal(albedo.total, 1);
    assert.ok(JSON.stringify(albedo.items).includes('900'));
    const carried = listKqmEvidence(db, { slug: 'zibai', limit: 100 });
    assert.ok(carried.total > 0, 'pages omitted from a later import are retained');
    assert.ok(carried.items.every((entry) => entry.sourceRevision.includes('sha256-')));
    assert.throws(() => createKqmEvidenceDraft(db, [{ slug: 'unknown', html: pageHtml('Unknown', '1') }]), /not present in the latest approved page index/);
  } finally { db.close(); }
});

test('KQM coverage stays separate, versioned, and awaiting explicit approval', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE game_datasets(id TEXT PRIMARY KEY,dataset_key TEXT,version TEXT,state TEXT,provenance_json TEXT,created_at TEXT,approved_at TEXT,UNIQUE(dataset_key,version));
    CREATE TABLE game_entities(id TEXT PRIMARY KEY,dataset_id TEXT,entity_type TEXT,entity_key TEXT,canonical_json TEXT,source_url TEXT,source_revision TEXT,completeness TEXT,UNIQUE(dataset_id,entity_type,entity_key));
    CREATE TABLE knowledge_revisions(id TEXT PRIMARY KEY,dataset_id TEXT,revision_type TEXT,occurred_at TEXT,details_json TEXT);
    CREATE TABLE source_check_events(id TEXT PRIMARY KEY,source_id TEXT,dataset_key TEXT,dataset_version TEXT,checked_at TEXT,source_revision TEXT,content_hash TEXT,result TEXT,error_code TEXT);`);
  try {
    const html = '<a href="/characters/cryo/aloy"><article><h2>Aloy</h2><p>Reference summary.</p></article></a>';
    const fakeFetch = async () => new Response(html, { status: 200, headers: { etag: 'fixture-kqm-r1', 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(html)) } });
    const preview = await previewKqmCharacterGuides(db, fakeFetch);
    const check = getLatestSuccessfulSourceCheck(db, 'kqm-theorycrafting-library', 'kqm-character-reference-index');
    assert.equal(check?.datasetVersion, preview.version);
    assert.equal(check?.sourceRevision, 'fixture-kqm-r1');
    assert.equal(check?.contentHash, preview.version.slice('sha256-'.length));
    assert.ok(check?.checkedAt);
    const offline = createKqmCharacterGuidesDraft(db, new Uint8Array(Buffer.from(html)), 'user-staged-offline-html');
    assert.equal(offline.datasetId, preview.datasetId, 'offline HTML and live preview share content-addressed index processing');
    assert.equal(preview.datasetState, 'draft');
    assert.equal(preview.pageCount, 1);
    assert.equal(listKqmGuideDrafts(db)[0].pageCount, 1);
    assert.equal(listKqmCharacterGuides(db).total, 0);
    assert.equal(approveKqmGuides(db, preview.datasetId).status, 200);
    assert.equal(listKqmGuideDrafts(db).length, 0);
    const catalog = listKqmCharacterGuides(db);
    assert.equal(catalog.total, 1);
    assert.equal(catalog.items[0].displayName, 'Aloy');
    assert.equal(catalog.items[0].classification, 'character-reference-page');
  } finally { db.close(); }
});

test('offline Genshin-DB snapshot importer decompresses, validates, versions, and stages reviewable records', () => {
  const characters = {};
  for (let index = 0; index < 20; index += 1) {
    const name = `Test Character ${index}`;
    characters[name] = { id: 10000000 + index, name, rarity: 5, elementType: 'ELEMENT_ANEMO', weaponType: 'WEAPON_SWORD_ONE_HAND', qualityType: 'QUALITY_ORANGE', substatType: 'FIGHT_PROP_ATTACK_PERCENT', costs: { ascend1: [] }, images: { filename_icon: `UI_${index}` } };
  }
  const gzipJson = (value) => gzipSync(Buffer.from(JSON.stringify(value)));
  const talentData = { English: { talents: { 'Test Character 0': { name: 'Test Character 0', normal: ['Normal attack'] } } } };
  const constellationData = { English: { constellations: { 'Test Character 0': { name: 'Test Character 0', c1: 'C1' } } } };
  const weaponData = { English: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`weapon-${index}`, { id: index + 1, name: `Weapon ${index + 1}`, rarity: 4 }])) };
  const files = {
    'english-characters.min.json.gzip': gzipJson({ English: { characters } }),
    'english-talents.min.json.gzip': gzipJson(talentData),
    'english-constellations.min.json.gzip': gzipJson(constellationData),
    'english-weapons.min.json.gzip': gzipJson(weaponData),
  };
  const snapshot = normalizeGenshinDbSnapshot(files, 'fixture-v7.2');
  assert.equal(snapshot.records.length, 20);
  assert.equal(snapshot.categories.weapons?.length, 5);
  assert.equal(snapshot.records.find((record) => record.name === 'Test Character 0').talents.name, 'Test Character 0');
  assert.equal(snapshot.records.find((record) => record.name === 'Test Character 0').constellations.name, 'Test Character 0');
  assert.equal(snapshot.sourceRevision, 'fixture-v7.2');

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE game_datasets(id TEXT PRIMARY KEY,dataset_key TEXT,version TEXT,state TEXT,provenance_json TEXT,created_at TEXT,approved_at TEXT,UNIQUE(dataset_key,version));
    CREATE TABLE game_entities(id TEXT PRIMARY KEY,dataset_id TEXT,entity_type TEXT,entity_key TEXT,canonical_json TEXT,source_url TEXT,source_revision TEXT,completeness TEXT,UNIQUE(dataset_id,entity_type,entity_key));
    CREATE TABLE knowledge_revisions(id TEXT PRIMARY KEY,dataset_id TEXT,revision_type TEXT,occurred_at TEXT,details_json TEXT);`);
  try {
    const draft = createGenshinDbDraft(db, snapshot);
    assert.equal(draft.datasetState, 'draft');
    assert.equal(draft.recordCount, 20);
    assert.equal(draft.categoryCounts.weapons, 5);
    assert.equal(listGenshinDbCharacters(db).total, 0);
    assert.equal(listGenshinDbDrafts(db)[0].preview.counts.added, 20);
    assert.equal(approveGenshinDbDraft(db, draft.datasetId).status, 200);
    const approved = listGenshinDbCharacters(db);
    assert.equal(approved.total, 20);
    assert.equal(listGenshinDbCategory(db, 'weapons').total, 5);
    assert.equal(listGenshinDbCategory(db, 'weapons', { limit: 2, offset: 2 }).items.length, 2);
    assert.equal(listGenshinDbCategory(db, 'weapons', { q: 'Weapon 3' }).total, 1);
    assert.match(approved.items[0].raw.name, /^Test Character/);
    const nextSnapshot = normalizeGenshinDbSnapshot({ 'english-characters.min.json.gzip': gzipJson({ English: { characters } }) }, 'fixture-v7.3');
    const nextDraft = createGenshinDbDraft(db, nextSnapshot);
    assert.equal(nextDraft.counts.unchanged, 20, 'missing optional talent data carries forward instead of clearing existing data');
    assert.equal(nextDraft.carryForwardCounts.weapons, 5);
    assert.equal(approveGenshinDbDraft(db, nextDraft.datasetId).status, 200);
    assert.equal(listGenshinDbCategory(db, 'weapons').total, 5, 'categories omitted from a later source file carry forward');
    assert.equal(listGenshinDbCharacters(db).items.find((record) => record.name === 'Test Character 0').talents.name, 'Test Character 0');
  } finally { db.close(); }
  assert.throws(() => normalizeGenshinDbSnapshot({ 'english-characters.min.json.gzip': gzipSync(Buffer.from('{broken')) }), /valid UTF-8 JSON/);
});

test('offline Enka localization import versions labels and resolves only explicit language/hash matches', () => {
  const locs = {};
  for (let index = 0; index < 20; index += 1) locs[String(100000 + index)] = { en: `Character ${index}`, ja: `キャラクター ${index}` };
  const snapshot = normalizeEnkaLocalizations(Buffer.from(JSON.stringify(locs)));
  assert.equal(snapshot.records.length, 40);
  assert.equal(snapshot.records.find((record) => record.key === '100000' && record.language === 'en').text, 'Character 0');

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE game_datasets(id TEXT PRIMARY KEY,dataset_key TEXT,version TEXT,state TEXT,provenance_json TEXT,created_at TEXT,approved_at TEXT,UNIQUE(dataset_key,version));
    CREATE TABLE game_entities(id TEXT PRIMARY KEY,dataset_id TEXT,entity_type TEXT,entity_key TEXT,canonical_json TEXT,source_url TEXT,source_revision TEXT,completeness TEXT,UNIQUE(dataset_id,entity_type,entity_key));
    CREATE TABLE knowledge_revisions(id TEXT PRIMARY KEY,dataset_id TEXT,revision_type TEXT,occurred_at TEXT,details_json TEXT);`);
  try {
    const draft = createEnkaLocalizationDraft(db, snapshot);
    assert.equal(draft.datasetState, 'draft');
    assert.equal(draft.recordCount, 40);
    assert.equal(approveEnkaLocalizationDraft(db, draft.datasetId).status, 200);
    assert.equal(getEnkaLocalizations(db, 'en').texts['100000'], 'Character 0');
    assert.equal(getEnkaLocalizations(db, 'ja').texts['100000'], 'キャラクター 0');
  } finally { db.close(); }
  assert.throws(() => normalizeEnkaLocalizations(Buffer.from('{broken')), /valid UTF-8 JSON/);
});

test('character reconciliation explains ID/name matches, preserves source differences, and flags comparable conflicts', () => {
  const source = (sourceId, key, name, url, version = 'fixture-v1') => ({ sourceId, key, name, url, revision: 'test-rev', version });
  const result = buildCharacterReconciliation({
    genshinDb: { dataset: { version: 'gdb-v1', sourceRevision: 'gdb-rev', recordCount: 2 }, items: [
      { value: { id: 1001, name: 'Amber', raw: { name: 'Amber', elementType: 'ELEMENT_PYRO', weaponType: 'WEAPON_BOW', rarity: 4 } }, source: source('genshin-db', '1001', 'Amber', 'https://github.com/theBowja/genshin-db-dist') },
      { value: { id: 2002, name: 'Noelle', raw: { name: 'Noelle', elementType: 'ELEMENT_GEO', weaponType: 'WEAPON_CLAYMORE', rarity: 4 } }, source: source('genshin-db', '2002', 'Noelle', 'https://github.com/theBowja/genshin-db-dist') },
    ] },
    enka: { dataset: { version: 'enka-v1', sourceRevision: 'enka-rev', recordCount: 2 }, items: [
      { value: { id: '1001', nameTextMapHash: 'h-amber', element: 'Cryo', weaponType: 'WEAPON_BOW', rarity: 4 }, source: source('enka-game-store', '1001', null, 'https://github.com/EnkaNetwork/API-docs') },
      { value: { id: '9999', nameTextMapHash: 'h-noelle', element: 'Geo', weaponType: 'WEAPON_CLAYMORE', rarity: 4 }, source: source('enka-game-store', '9999', null, 'https://github.com/EnkaNetwork/API-docs') },
    ] },
    guides: { dataset: { version: 'kqm-v1', sourceRevision: null, recordCount: 2 }, items: [
      { value: { slug: 'amber', displayName: 'Amber', pageUrl: 'https://library.keqingmains.com/characters/amber' }, source: source('kqm-theorycrafting-library', 'amber', 'Amber', 'https://library.keqingmains.com/characters/amber') },
      { value: { slug: 'unlinked', displayName: 'An Unmatched Guide', pageUrl: 'https://library.keqingmains.com/characters/unmatched' }, source: source('kqm-theorycrafting-library', 'unmatched', 'An Unmatched Guide', 'https://library.keqingmains.com/characters/unmatched') },
    ] },
    localizations: { 'h-amber': 'Amber', 'h-noelle': 'Noelle' },
  });
  const amber = result.items.find((item) => item.displayName === 'Amber');
  const noelle = result.items.find((item) => item.displayName === 'Noelle' && item.status === 'name-match');
  assert.equal(amber.status, 'id-match');
  assert.deepEqual(amber.conflicts.map((conflict) => conflict.field), ['element']);
  assert.equal(amber.guideReferences.length, 1);
  assert.equal(noelle.status, 'name-match');
  assert.equal(result.summary.matchedById, 1);
  assert.equal(result.summary.matchedByName, 1);
  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.unmatchedGuideReferences.length, 1);
  assert.match(result.policy, /No records are merged/i);
  const accepted = { ...result, items: result.items.map((item) => ['id-match', 'name-match'].includes(item.status) ? { ...item, review: { decision: 'accepted' } } : item) };
  const projection = buildCanonicalCharacterProjection(accepted);
  assert.equal(projection.total, 2);
  const canonicalAmber = projection.items.find((item) => item.displayName === 'Amber');
  assert.equal(canonicalAmber.fields.element.value, null);
  assert.equal(canonicalAmber.fields.element.state, 'conflict');
  assert.equal(canonicalAmber.fields.weaponType.value, 'Bow');
  assert.equal(canonicalAmber.calculationEligible, false);
  assert.equal(buildCanonicalCharacterProjection(accepted).dataset.version, projection.dataset.version, 'projection version is reproducible for the same evidence');
  const selected = { ...accepted, items: accepted.items.map((item) => item.displayName === 'Amber' ? { ...item, conflicts: item.conflicts.map((conflict) => ({ ...conflict, review: { decision: 'selected-source', selectedSourceId: 'enka-game-store', selectedValue: 'Cryo' } })) } : item) };
  const adjudicated = buildCanonicalCharacterProjection(selected);
  const adjudicatedAmber = adjudicated.items.find((item) => item.displayName === 'Amber');
  assert.equal(adjudicatedAmber.fields.element.value, 'Cryo');
  assert.equal(adjudicatedAmber.fields.element.state, 'adjudicated');
  assert.deepEqual(adjudicatedAmber.conflicts, []);
  assert.equal(adjudicated.summary.adjudicatedFields, 1);
  assert.notEqual(adjudicated.dataset.version, projection.dataset.version);
  const invalidSelection = { ...selected, items: selected.items.map((item) => item.displayName === 'Amber' ? { ...item, conflicts: item.conflicts.map((conflict) => ({ ...conflict, review: { decision: 'selected-source', selectedSourceId: 'enka-game-store', selectedValue: 'Hydro' } })) } : item) };
  assert.equal(buildCanonicalCharacterProjection(invalidSelection).items.find((item) => item.displayName === 'Amber').fields.element.state, 'conflict', 'a stored value outside current evidence cannot resolve the conflict');
});

test('identity-link review updates are audited and preserve prior decisions', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE character_link_reviews(fingerprint TEXT PRIMARY KEY,decision TEXT,note TEXT,evidence_json TEXT,reviewed_at TEXT,updated_at TEXT);
    CREATE TABLE character_link_review_history(id TEXT PRIMARY KEY,fingerprint TEXT,previous_decision TEXT,decision TEXT,note TEXT,evidence_json TEXT,changed_at TEXT);
    CREATE TABLE activity_events(id TEXT PRIMARY KEY,event_type TEXT,occurred_at TEXT,details_json TEXT);`);
  try {
    const fingerprint = 'a'.repeat(64);
    const evidence = { status: 'name-match', sourceVersions: ['gdb-v1', 'enka-v1'] };
    assert.equal(saveCharacterLinkReview(db, { fingerprint, decision: 'accepted', note: 'Reviewed names and IDs.', evidence }).decision, 'accepted');
    assert.equal(saveCharacterLinkReview(db, { fingerprint, decision: 'deferred', note: '', evidence }).decision, 'deferred');
    const history = listCharacterLinkReviewHistory(db, fingerprint);
    assert.equal(history.length, 2);
    assert.equal(history[0].decision, 'deferred');
    assert.equal(history[0].previousDecision, 'accepted');
    assert.equal(history[1].decision, 'accepted');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity_events').get().count, 2);
  } finally { db.close(); }
});

test('field-level review decisions are version-bound, audited, and newest-first', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE character_field_reviews(fingerprint TEXT PRIMARY KEY,character_fingerprint TEXT,field_name TEXT,decision TEXT,selected_source_id TEXT,selected_value_json TEXT,note TEXT,evidence_json TEXT,updated_at TEXT);
    CREATE TABLE character_field_review_history(id TEXT PRIMARY KEY,fingerprint TEXT,character_fingerprint TEXT,field_name TEXT,previous_decision TEXT,decision TEXT,selected_source_id TEXT,selected_value_json TEXT,note TEXT,evidence_json TEXT,changed_at TEXT);
    CREATE TABLE activity_events(id TEXT PRIMARY KEY,event_type TEXT,occurred_at TEXT,details_json TEXT);`);
  try {
    const fingerprint = 'b'.repeat(64);
    const characterFingerprint = 'c'.repeat(64);
    const evidence = { field: 'element', values: [{ sourceId: 'genshin-db', normalized: 'Pyro' }, { sourceId: 'enka-game-store', normalized: 'Cryo' }] };
    saveCharacterFieldReview(db, { fingerprint, characterFingerprint, field: 'element', decision: 'selected-source', selectedSourceId: 'enka-game-store', selectedValue: 'Cryo', note: 'Cross-checked source record.', evidence });
    saveCharacterFieldReview(db, { fingerprint, characterFingerprint, field: 'element', decision: 'deferred', selectedSourceId: null, selectedValue: null, note: '', evidence });
    const history = listCharacterFieldReviewHistory(db, fingerprint);
    assert.equal(history.length, 2);
    assert.equal(history[0].decision, 'deferred');
    assert.equal(history[0].previousDecision, 'selected-source');
    assert.equal(history[1].selectedValue, 'Cryo');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity_events').get().count, 2);
  } finally { db.close(); }
});

test('field review API validates current evidence and projects accepted source selections', async () => {
  await waitForServer();
  const db = new DatabaseSync(join(directory, 'test.sqlite'));
  try {
    const now = new Date().toISOString();
    for (const [id, key, version] of [['gdb-fixture', 'genshin-db-character-snapshot', 'gdb-field-test-v1'], ['enka-fixture', 'enka-avatar-catalog', 'enka-field-test-v1']]) {
      db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at,approved_at) VALUES (?,?,?,\'approved\',?,?,?)').run(id, key, version, JSON.stringify({ sourceRevision: 'fixture' }), now, now);
    }
    const records = [
      ['gdb-fixture-character', 'gdb-fixture', 'genshin-db-character', '1001', { id: 1001, name: 'Test Amber', raw: { elementType: 'Pyro', weaponType: 'Bow', rarity: 4 } }, 'https://example.test/gdb'],
      ['enka-fixture-character', 'enka-fixture', 'avatar-definition', '1001', { id: 1001, nameTextMapHash: 'missing-localization', element: 'Cryo', weaponType: 'Bow', rarity: 4 }, 'https://example.test/enka'],
    ];
    const insertEntity = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,\'complete\')');
    for (const [id, datasetId, type, key, value, url] of records) insertEntity.run(id, datasetId, type, key, JSON.stringify(value), url, 'fixture');
  } finally { db.close(); }

  const getReport = async () => (await (await fetch(`${base}/api/v1/game-data/reconciliation/characters`)).json()).data;
  let report = await getReport();
  const candidate = report.items.find((item) => item.displayName === 'Test Amber');
  assert.equal(candidate.status, 'id-match');
  const identity = await fetch(`${base}/api/v1/game-data/reconciliation/reviews`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: candidate.reviewFingerprint, decision: 'accepted' }) });
  assert.equal(identity.status, 200);
  report = await getReport();
  const accepted = report.items.find((item) => item.displayName === 'Test Amber');
  const conflict = accepted.conflicts.find((item) => item.field === 'element');
  const invalidChoice = await fetch(`${base}/api/v1/game-data/reconciliation/field-reviews`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: conflict.fingerprint, decision: 'selected-source', selectedSourceId: 'genshin-db', selectedValue: 'Hydro' }) });
  assert.equal(invalidChoice.status, 409);
  const saved = await fetch(`${base}/api/v1/game-data/reconciliation/field-reviews`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: conflict.fingerprint, decision: 'selected-source', selectedSourceId: 'genshin-db', selectedValue: 'Pyro' }) });
  assert.equal(saved.status, 200);
  const updated = await getReport();
  assert.equal(updated.items.find((item) => item.displayName === 'Test Amber').conflicts[0].review.decision, 'selected-source');
  const projection = (await (await fetch(`${base}/api/v1/game-data/canonical-characters`)).json()).data;
  const character = projection.items.find((item) => item.displayName === 'Test Amber');
  assert.equal(character.fields.element.value, 'Pyro');
  assert.equal(character.fields.element.state, 'adjudicated');
  assert.equal(character.conflicts.length, 0);
  assert.equal(projection.summary.adjudicatedFields, 1);
  const history = await (await fetch(`${base}/api/v1/game-data/reconciliation/field-reviews/${conflict.fingerprint}`)).json();
  assert.equal(history.data.length, 1);
  assert.equal(history.data[0].selectedSourceId, 'genshin-db');
  const firstReportSnapshotResponse = await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(firstReportSnapshotResponse.status, 201);
  const firstReportSnapshot = (await firstReportSnapshotResponse.json()).data;
  const repeatedReportSnapshot = await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(repeatedReportSnapshot.status, 200);
  assert.equal((await repeatedReportSnapshot.json()).data.id, firstReportSnapshot.id);
  assert.equal((await (await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots/${firstReportSnapshot.id}`)).json()).data.snapshot.items.length, 1);

  const firstSnapshotResponse = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(firstSnapshotResponse.status, 201);
  const firstSnapshot = (await firstSnapshotResponse.json()).data;
  const db2 = new DatabaseSync(join(directory, 'test.sqlite'));
  try {
    const revisedAt = new Date(Date.now() + 1000).toISOString();
    db2.prepare("UPDATE game_datasets SET state='superseded' WHERE id='enka-fixture'").run();
    db2.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at,approved_at) VALUES (?,?,?,\'approved\',?,?,?)').run('enka-fixture-v2', 'enka-avatar-catalog', 'enka-field-test-v2', JSON.stringify({ sourceRevision: 'fixture-v2' }), revisedAt, revisedAt);
    db2.prepare("INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES ('enka-fixture-character-v2','enka-fixture-v2','avatar-definition','1001',?,'https://example.test/enka','fixture-v2','complete')").run(JSON.stringify({ id: 1001, nameTextMapHash: 'missing-localization', element: 'Hydro', weaponType: 'Bow', rarity: 4 }));
  } finally { db2.close(); }
  const revisedReport = await getReport();
  const revisedCandidate = revisedReport.items.find((item) => item.displayName === 'Test Amber');
  assert.equal(revisedCandidate.review, null, 'new dataset versions require renewed identity review');
  const revisedLink = await fetch(`${base}/api/v1/game-data/reconciliation/reviews`, { method: 'POST', headers, body: JSON.stringify({ fingerprint: revisedCandidate.reviewFingerprint, decision: 'accepted' }) });
  assert.equal(revisedLink.status, 200);
  const secondReportSnapshotResponse = await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(secondReportSnapshotResponse.status, 201);
  const secondReportSnapshot = (await secondReportSnapshotResponse.json()).data;
  const reportDiff = await (await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots/compare?from=${firstReportSnapshot.id}&to=${secondReportSnapshot.id}`)).json();
  assert.equal(reportDiff.data.sourceDatasetsChanged, true);
  assert.equal(reportDiff.data.fieldChanges.find((change) => change.field === 'element').before[1].normalized, 'Cryo');
  assert.equal(reportDiff.data.fieldChanges.find((change) => change.field === 'element').after[1].normalized, 'Hydro');
  assert.equal(reportDiff.data.candidateChanges.length, 1);
  const reportHistory = await (await fetch(`${base}/api/v1/game-data/reconciliation/characters/snapshots`)).json();
  assert.equal(reportHistory.data.total, 2);
  const secondSnapshotResponse = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(secondSnapshotResponse.status, 201);
  const secondSnapshot = (await secondSnapshotResponse.json()).data;
  const comparisonResponse = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots/compare?from=${firstSnapshot.id}&to=${secondSnapshot.id}`);
  assert.equal(comparisonResponse.status, 200);
  const comparison = (await comparisonResponse.json()).data;
  assert.equal(comparison.sourceDatasetsChanged, true);
  assert.equal(comparison.fieldChanges.find((change) => change.field === 'element').before.state, 'adjudicated');
  assert.equal(comparison.fieldChanges.find((change) => change.field === 'element').after.state, 'conflict');
  assert.deepEqual(compareCanonicalCharacterSnapshots(firstSnapshot, secondSnapshot).summary, comparison.summary);
});

test('canonical projection snapshots are immutable, reproducible, and browseable', async () => {
  await waitForServer();
  const forbidden = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(forbidden.status, 403);
  const first = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(first.status, 200);
  const created = (await first.json()).data;
  assert.equal(created.created, false);
  assert.equal(created.snapshot.total, 1);
  const repeated = await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`, { method: 'POST', headers, body: '{}' });
  assert.equal(repeated.status, 200);
  const duplicate = (await repeated.json()).data;
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.id, created.id);
  const history = await (await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots`)).json();
  assert.equal(history.data.total, 2);
  assert.equal(history.data.items[0].datasetVersion, created.datasetVersion);
  const stored = await (await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots/${created.id}`)).json();
  assert.equal(stored.data.snapshot.dataset.version, created.datasetVersion);
  assert.deepEqual(stored.data.snapshot, created.snapshot);
  assert.equal((await fetch(`${base}/api/v1/game-data/canonical-characters/snapshots/not-a-uuid`)).status, 404);
});

test('knowledge dataset updates stay in draft until explicit approval', async () => {
  await waitForServer();
  const dataset = {
    key: 'knowledge-core',
    version: '0.1.1',
    provenance: 'Temporary integration-test fixture.',
    entries: [{
      slug: 'elemental-application-and-icd-basics',
      category: 'combat-mechanics',
      title: 'Elemental application and internal cooldowns',
      summary: 'Integration-test revised summary.',
      content: 'Integration-test draft content only.',
      keywords: ['ICD', 'test'],
      verificationState: 'experimental',
      confidence: 0.2,
      limitations: ['Test fixture; not game information.'],
      gameVersion: null,
      sources: [{ title: 'Test source', publisher: 'Test suite', url: 'https://example.com/test', checkedAt: '2026-11-12', sourceVersion: null, notes: 'Temporary fixture.' }],
    }],
  };
  const previewResponse = await fetch(`${base}/api/v1/knowledge/datasets/preview`, { method: 'POST', headers, body: JSON.stringify(dataset) });
  assert.equal(previewResponse.status, 201);
  const preview = (await previewResponse.json()).data;
  assert.deepEqual(preview.counts, { added: 0, modified: 1, unchanged: 0 });
  assert.equal(preview.entries[0].change, 'modified');

  const beforeApproval = (await (await fetch(`${base}/api/v1/knowledge/elemental-application-and-icd-basics`)).json()).data;
  assert.equal(beforeApproval.dataset.version, '0.1.0');
  const draft = (await (await fetch(`${base}/api/v1/knowledge/datasets/${preview.datasetId}`)).json()).data;
  assert.equal(draft.state, 'draft');
  assert.equal(draft.entries[0].sources.length, 1);

  const approval = await fetch(`${base}/api/v1/knowledge/datasets/${preview.datasetId}/approve`, { method: 'POST', headers, body: '{}' });
  assert.equal(approval.status, 200);
  const afterApproval = (await (await fetch(`${base}/api/v1/knowledge/elemental-application-and-icd-basics`)).json()).data;
  assert.equal(afterApproval.dataset.version, '0.1.1');
  assert.equal(afterApproval.verificationState, 'experimental');

  const laterDataset = {
    key: 'knowledge-core',
    version: '0.1.2',
    provenance: 'Temporary omission-retention integration-test fixture.',
    entries: [{
      slug: 'temporary-test-entry',
      category: 'test-fixture',
      title: 'Temporary test entry',
      summary: 'This record exists only inside the isolated integration-test database.',
      content: 'This is not game information.',
      keywords: ['fixture'],
      verificationState: 'experimental',
      confidence: null,
      limitations: ['Test fixture only.'],
      gameVersion: null,
      sources: [{ title: 'Test source', publisher: 'Test suite', url: 'https://example.com/test', checkedAt: '2026-11-12', sourceVersion: null, notes: 'Temporary fixture.' }],
    }],
  };
  const laterPreview = await fetch(`${base}/api/v1/knowledge/datasets/preview`, { method: 'POST', headers, body: JSON.stringify(laterDataset) });
  assert.equal(laterPreview.status, 201);
  const laterDraft = (await laterPreview.json()).data;
  assert.deepEqual(laterDraft.counts, { added: 1, modified: 0, unchanged: 0 });
  const laterApproval = await fetch(`${base}/api/v1/knowledge/datasets/${laterDraft.datasetId}/approve`, { method: 'POST', headers, body: '{}' });
  assert.equal(laterApproval.status, 200);

  const retained = (await (await fetch(`${base}/api/v1/knowledge/elemental-application-and-icd-basics`)).json()).data;
  assert.equal(retained.dataset.version, '0.1.2');
  assert.match(retained.summary, /Integration-test revised summary/);
  const laterHistory = (await (await fetch(`${base}/api/v1/knowledge/datasets/${laterDraft.datasetId}/revisions`)).json()).data;
  assert.equal(laterHistory[1].details.carriedForward, 1);

  const versions = (await (await fetch(`${base}/api/v1/knowledge/datasets`)).json()).data;
  assert.equal(versions.find((item) => item.version === '0.1.0').state, 'superseded');
  assert.equal(versions.find((item) => item.version === '0.1.1').state, 'superseded');
  assert.equal(versions.find((item) => item.version === '0.1.2').state, 'approved');
  const history = (await (await fetch(`${base}/api/v1/knowledge/datasets/${preview.datasetId}/revisions`)).json()).data;
  assert.deepEqual(history.map((item) => item.type), ['import-preview', 'approval']);
});
