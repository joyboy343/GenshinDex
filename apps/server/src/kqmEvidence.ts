import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const DATASET_KEY = 'kqm-character-page-evidence';
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_COUNT = 100;
const MAX_EVIDENCE_PER_PAGE = 1200;
const EXTRACTOR_VERSION = 'kqm-page-evidence-v1';

function decodeHtml(value: string) {
  return value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, number: string) => String.fromCodePoint(Number(number))).replace(/&#x([0-9a-f]+);/gi, (_, number: string) => String.fromCodePoint(parseInt(number, 16)));
}

function plainText(html: string) {
  return decodeHtml(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<br\b[^>]*>/gi, ' ')
    .replace(/<\/(p|li|h[1-6]|tr|th|td|div|section|article)>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function normalizeHeading(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function parseTable(tableHtml: string) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
    return [...(row[1] ?? '').matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => plainText(cell[1] ?? '').slice(0, 500));
  }).filter((row) => row.some(Boolean));
  if (!rows.length) return null;
  let headers: string[] = [];
  let body = rows;
  const headerRow = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<th\b/i);
  if (headerRow) { headers = rows[0] ?? []; body = rows.slice(1); }
  return { headers, rows: body.slice(0, 300) };
}

export function parseKqmCharacterPageEvidence(html: string, input: { slug: string; displayName: string; pageUrl: string }) {
  if (Buffer.byteLength(html, 'utf8') > MAX_PAGE_BYTES) throw new Error(`KQM page ${input.slug} exceeds the 4 MB import limit.`);
  const url = new URL(input.pageUrl);
  if (url.origin !== 'https://library.keqingmains.com' || !url.pathname.startsWith('/characters/')) throw new Error(`KQM page URL is outside the approved character-library path: ${input.slug}.`);
  if (url.pathname.split('/').at(-1)?.toLocaleLowerCase() !== input.slug.toLocaleLowerCase()) throw new Error(`KQM page URL does not match the approved slug ${input.slug}.`);
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const pageHeading = headings.find((heading) => Number(heading[1]) === 1 && normalizeHeading(plainText(heading[2] ?? '')) === normalizeHeading(input.displayName));
  if (!pageHeading || pageHeading.index === undefined) throw new Error(`Could not verify the expected KQM character heading for ${input.slug}.`);
  const bodyStart = pageHeading.index + pageHeading[0].length;
  const footer = html.toLocaleLowerCase().indexOf('<footer', bodyStart);
  const body = html.slice(bodyStart, footer >= 0 ? footer : undefined);
  const localHeadings = [...body.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  if (!localHeadings.length) throw new Error(`No section headings were recognized in KQM page ${input.slug}.`);
  const records: Array<Record<string, unknown>> = [];
  const pathStack: Array<{ level: number; text: string }> = [];
  for (let index = 0; index < localHeadings.length; index += 1) {
    const heading = localHeadings[index]!;
    const level = Number(heading[1]);
    const title = plainText(heading[2] ?? '');
    if (!title || title.length > 180) continue;
    while (pathStack.length && pathStack[pathStack.length - 1]!.level >= level) pathStack.pop();
    pathStack.push({ level, text: title });
    const start = heading.index! + heading[0].length;
    const end = index + 1 < localHeadings.length ? localHeadings[index + 1]!.index! : body.length;
    const section = body.slice(start, end);
    const sectionPath = pathStack.map((entry) => entry.text);
    const ignored = ['resources', 'previous', 'next', 'on this page'];
    if (ignored.includes(normalizeHeading(title))) continue;
    for (const match of section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      const table = parseTable(match[0]);
      if (table) records.push({ sectionPath, kind: 'table', ...table });
    }
    const prose = section.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' ');
    for (const match of prose.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const content = plainText(match[2] ?? '');
      if (content.length >= 8 && content.length <= 2500) records.push({ sectionPath, kind: match[1] === 'li' ? 'list-item' : 'statement', text: content });
    }
    if (records.length > MAX_EVIDENCE_PER_PAGE) throw new Error(`KQM page ${input.slug} exceeds the ${MAX_EVIDENCE_PER_PAGE} extracted-evidence-item limit.`);
  }
  if (!records.length) throw new Error(`No section text or tables were extracted from KQM page ${input.slug}.`);
  const pageSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const evidence = records.map((record, index) => {
    const evidenceId = createHash('sha256').update(JSON.stringify({ slug: input.slug, index, record })).digest('hex').slice(0, 24);
    return {
      evidenceId,
      slug: input.slug,
      displayName: input.displayName,
      sourceUrl: input.pageUrl,
      sourcePublisher: 'KeqingMains Theorycrafting Library',
      sourceRevision: `sha256-${pageSha256}`,
      extractorVersion: EXTRACTOR_VERSION,
      sectionPath: record.sectionPath,
      kind: record.kind,
      ...(record.headers ? { headers: record.headers } : {}),
      ...(record.rows ? { rows: record.rows } : {}),
      ...(record.text ? { text: record.text } : {}),
      verificationState: 'experimental',
      confidence: null,
      calculationEligible: false,
      limitations: ['Extracted from a user-staged HTML page; verify against the cited source before using.', 'Text and table cells preserve displayed values and are not converted into game mechanics or calculations.'],
    };
  });
  return { slug: input.slug, displayName: input.displayName, pageUrl: input.pageUrl, pageSha256, extractorVersion: EXTRACTOR_VERSION, evidence };
}

export function createKqmEvidenceDraft(db: DatabaseSync, pages: Array<{ slug: string; html: string }>) {
  if (!pages.length || pages.length > MAX_PAGE_COUNT) throw new Error(`Provide between 1 and ${MAX_PAGE_COUNT} KQM character pages.`);
  const index = db.prepare("SELECT id,version FROM game_datasets WHERE dataset_key='kqm-character-reference-index' AND state='approved' ORDER BY approved_at DESC LIMIT 1").get() as { id: string; version: string } | undefined;
  if (!index) throw new Error('Approve the KQM character-reference index before importing page evidence.');
  const indexed = db.prepare("SELECT entity_key,canonical_json,source_url FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-reference'").all(index.id) as Array<{ entity_key: string; canonical_json: string; source_url: string }>;
  const indexedBySlug = new Map(indexed.map((row) => [row.entity_key, { ...(JSON.parse(row.canonical_json) as Record<string, unknown>), pageUrl: row.source_url }]));
  const seen = new Set<string>();
  const parsedPages = pages.map((page) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug) || seen.has(page.slug)) throw new Error(`Duplicate or invalid KQM page slug: ${page.slug}.`);
    seen.add(page.slug);
    const indexedPage = indexedBySlug.get(page.slug);
    if (!indexedPage || typeof indexedPage.displayName !== 'string' || typeof indexedPage.pageUrl !== 'string') throw new Error(`KQM page ${page.slug} is not present in the latest approved page index.`);
    return parseKqmCharacterPageEvidence(page.html, { slug: page.slug, displayName: indexedPage.displayName, pageUrl: indexedPage.pageUrl });
  }).sort((a, b) => a.slug.localeCompare(b.slug));
  const version = `sha256-${createHash('sha256').update(JSON.stringify({ extractor: EXTRACTOR_VERSION, indexVersion: index.version, pages: parsedPages.map((page) => ({ slug: page.slug, pageSha256: page.pageSha256 })) })).digest('hex')}`;
  const known = db.prepare('SELECT id,state FROM game_datasets WHERE dataset_key=? AND version=?').get(DATASET_KEY, version) as { id: string; state: string } | undefined;
  const currentDataset = db.prepare("SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as { id: string } | undefined;
  const currentRows = currentDataset ? db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-evidence'").all(currentDataset.id) as Array<{ entity_key: string; canonical_json: string }> : [];
  const current = new Map(currentRows.map((row) => [row.entity_key, row.canonical_json]));
  let added = 0, modified = 0, unchanged = 0;
  const records = parsedPages.flatMap((page) => page.evidence.map((entry) => ({ page, entry, key: `${page.slug}:${entry.evidenceId}` })));
  for (const { entry, key } of records) {
    const before = current.get(key);
    if (before === undefined) added += 1;
    else if (before === JSON.stringify(entry)) unchanged += 1;
    else modified += 1;
  }
  if (known) return { datasetId: known.id, datasetState: known.state, version, pageCount: parsedPages.length, recordCount: records.length, counts: { added, modified, unchanged }, pages: parsedPages.map(({ slug, displayName, pageSha256, evidence }) => ({ slug, displayName, pageSha256: `sha256-${pageSha256}`, evidenceCount: evidence.length })) };
  const datasetId = randomUUID();
  const now = new Date().toISOString();
  const provenance = { source: 'user-staged KQM TCL HTML pages', sourceIndexVersion: index.version, extractorVersion: EXTRACTOR_VERSION, pageSlugs: parsedPages.map((page) => page.slug), pageHashes: Object.fromEntries(parsedPages.map((page) => [page.slug, `sha256-${page.pageSha256}`])), recordMeaning: 'Experimental evidence excerpts and displayed table values; not approved game mechanics or recommendations.' };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO game_datasets(id,dataset_key,version,state,provenance_json,created_at) VALUES (?,?,?,\'draft\',?,?)').run(datasetId, DATASET_KEY, version, JSON.stringify(provenance), now);
    const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
    for (const { page, entry, key } of records) insert.run(randomUUID(), datasetId, 'kqm-character-evidence', key, JSON.stringify(entry), page.pageUrl, `sha256-${page.pageSha256}`, 'partial');
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), datasetId, 'import-preview', now, JSON.stringify({ pageCount: parsedPages.length, recordCount: records.length, sourceIndexVersion: index.version, counts: { added, modified, unchanged } }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { datasetId, datasetState: 'draft', version, pageCount: parsedPages.length, recordCount: records.length, counts: { added, modified, unchanged }, pages: parsedPages.map(({ slug, displayName, pageSha256, evidence }) => ({ slug, displayName, pageSha256: `sha256-${pageSha256}`, evidenceCount: evidence.length })) };
}

export function listKqmEvidenceDrafts(db: DatabaseSync) {
  const rows = db.prepare("SELECT id,version,state,provenance_json AS provenance,created_at AS createdAt FROM game_datasets WHERE dataset_key=? AND state='draft' ORDER BY created_at DESC").all(DATASET_KEY) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const provenance = JSON.parse(String(row.provenance)) as Record<string, any>;
    const count = Number((db.prepare("SELECT COUNT(*) AS count FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-evidence'").get(row.id) as { count: number }).count);
    return { id: row.id, version: row.version, state: row.state, provenance, createdAt: row.createdAt, recordCount: count, pageCount: provenance.pageSlugs?.length ?? 0 };
  });
}

export function approveKqmEvidenceDraft(db: DatabaseSync, id: string) {
  const draft = db.prepare(`SELECT id,version,state,provenance_json AS provenance FROM game_datasets WHERE id=? AND dataset_key=?`).get(id, DATASET_KEY) as Record<string, unknown> | undefined;
  if (!draft) return { status: 404, error: { code: 'NOT_FOUND', message: 'KQM evidence draft not found.' } };
  if (draft.state === 'approved') return { status: 200, data: { id, version: draft.version, state: 'approved' } };
  if (draft.state !== 'draft') return { status: 409, error: { code: 'DATASET_NOT_APPROVABLE', message: 'Only a KQM evidence draft can be approved.' } };
  const provenance = JSON.parse(String(draft.provenance)) as { pageSlugs: string[] };
  const importedSlugs = new Set(provenance.pageSlugs);
  const prior = db.prepare(`SELECT id FROM game_datasets WHERE dataset_key=? AND state='approved'`).get(DATASET_KEY) as { id: string } | undefined;
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let carriedForwardPages = 0;
    if (prior) {
      const previous = db.prepare("SELECT * FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-evidence'").all(prior.id) as Array<Record<string, unknown>>;
      const insert = db.prepare('INSERT INTO game_entities(id,dataset_id,entity_type,entity_key,canonical_json,source_url,source_revision,completeness) VALUES (?,?,?,?,?,?,?,?)');
      const inserted = new Set<string>();
      for (const row of previous) {
        const entry = JSON.parse(String(row.canonical_json)) as { slug?: string };
        if (!entry.slug || importedSlugs.has(entry.slug) || inserted.has(String(row.entity_key))) continue;
        insert.run(randomUUID(), id, row.entity_type, row.entity_key, row.canonical_json, row.source_url, row.source_revision, row.completeness);
        inserted.add(String(row.entity_key));
        carriedForwardPages += 1;
      }
      db.prepare("UPDATE game_datasets SET state='superseded' WHERE id=?").run(prior.id);
    }
    db.prepare("UPDATE game_datasets SET state='approved',approved_at=? WHERE id=?").run(now, id);
    db.prepare('INSERT INTO knowledge_revisions(id,dataset_id,revision_type,occurred_at,details_json) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'approval', now, JSON.stringify({ carriedForwardEvidenceRecords: carriedForwardPages, importedPageSlugs: [...importedSlugs] }));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { status: 200, data: { id, version: draft.version, state: 'approved', approvedAt: now } };
}

export function listKqmEvidence(db: DatabaseSync, options: { q?: string; slug?: string; limit?: number; offset?: number } = {}) {
  const dataset = db.prepare("SELECT id,version,approved_at AS approvedAt,provenance_json AS provenance FROM game_datasets WHERE dataset_key=? AND state='approved' ORDER BY approved_at DESC LIMIT 1").get(DATASET_KEY) as Record<string, unknown> | undefined;
  if (!dataset) return { dataset: null, total: 0, limit: Math.max(1, Math.min(100, options.limit ?? 50)), offset: Math.max(0, options.offset ?? 0), items: [] };
  const rows = db.prepare("SELECT entity_key,canonical_json FROM game_entities WHERE dataset_id=? AND entity_type='kqm-character-evidence' ORDER BY entity_key").all(dataset.id) as Array<{ entity_key: string; canonical_json: string }>;
  const q = (options.q ?? '').trim().toLocaleLowerCase().slice(0, 100);
  const filtered = rows.map((row) => JSON.parse(row.canonical_json) as Record<string, any>).filter((entry) => (!options.slug || entry.slug === options.slug) && (!q || `${entry.displayName} ${entry.sectionPath.join(' ')} ${entry.text ?? ''} ${JSON.stringify(entry.headers ?? [])} ${JSON.stringify(entry.rows ?? [])}`.toLocaleLowerCase().includes(q)));
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.min(10000, Math.trunc(options.offset ?? 0)));
  return { dataset: { id: dataset.id, version: dataset.version, approvedAt: dataset.approvedAt, provenance: JSON.parse(String(dataset.provenance)) }, total: filtered.length, limit, offset, items: filtered.slice(offset, offset + limit) };
}
