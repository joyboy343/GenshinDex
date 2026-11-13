const requestHeaders = { 'content-type': 'application/json', 'x-genshindex-request': '1' };
const list = document.querySelector('#account-list');
const dialog = document.querySelector('#account-dialog');
const form = document.querySelector('#account-form');
const errorBox = document.querySelector('#form-error');
const jobStatus = document.querySelector('#job-status');

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body.data;
}

async function refreshAccounts() {
  const accounts = await api('/api/v1/accounts');
  document.querySelector('#account-count').textContent = String(accounts.length);
  const selectedId = localStorage.getItem('genshindex.activeAccount');
  if (!accounts.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-orbit">✧</span><span>No accounts yet</span><small>Create a local profile to get started.</small></div>';
    document.querySelector('#account-toggle').innerHTML = 'Choose account <span>⌄</span>';
    return;
  }
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];
  localStorage.setItem('genshindex.activeAccount', selected.id);
  document.querySelector('#account-toggle').innerHTML = `${escapeHtml(selected.nickname)} <span>⌄</span>`;
  list.replaceChildren(...accounts.map((account) => {
    const row = document.createElement('div');
    row.className = 'account-item';
    row.innerHTML = `<span class="account-avatar">✦</span><span class="account-meta"><strong>${escapeHtml(account.nickname)}</strong><small>${escapeHtml(serverLabel(account.server))}${account.uid ? ` · UID ${escapeHtml(account.uid)}` : ''}</small></span>${account.id === selected.id ? '<span class="account-selected">ACTIVE</span>' : ''}`;
    row.title = 'Select this local profile';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => { localStorage.setItem('genshindex.activeAccount', account.id); refreshAccounts(); });
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
    return row;
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function serverLabel(server) {
  return ({ unknown: 'Server not set', os_usa: 'America', os_europe: 'Europe', os_asia: 'Asia', os_cht: 'TW, HK, MO' })[server] ?? 'Server not set';
}

function openAccountDialog() {
  errorBox.textContent = '';
  dialog.showModal();
  document.querySelector('#nickname').focus();
}

document.querySelector('#new-account').addEventListener('click', openAccountDialog);
document.querySelector('#add-account').addEventListener('click', openAccountDialog);
document.querySelector('#account-toggle').addEventListener('click', () => {
  if (!list.querySelector('.account-item')) return openAccountDialog();
  list.querySelector('.account-item')?.focus();
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const account = await api('/api/v1/accounts', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ nickname: data.get('nickname'), uid: data.get('uid') || undefined, server: data.get('server') }) });
    localStorage.setItem('genshindex.activeAccount', account.id);
    form.reset();
    dialog.close();
    await refreshAccounts();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#run-job').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  jobStatus.textContent = 'Starting local worker…';
  try {
    const job = await api('/api/v1/jobs/sample', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ steps: 12, delayMs: 80 }) });
    jobStatus.innerHTML = `<span class="job-label">${escapeHtml(job.message)}</span><div class="job-progress"><span style="width:${job.progress * 100}%"></span></div>`;
    const events = new EventSource(`/api/v1/jobs/${encodeURIComponent(job.id)}/events`);
    events.addEventListener('job', (message) => {
      const update = JSON.parse(message.data);
      jobStatus.innerHTML = `<span class="job-label">${escapeHtml(update.message)}${update.status === 'completed' ? ' · This was an infrastructure check, not a game simulation.' : ''}</span><div class="job-progress"><span style="width:${update.progress * 100}%"></span></div>`;
      if (['completed', 'failed', 'cancelled'].includes(update.status)) { events.close(); button.disabled = false; }
    });
    events.onerror = () => { events.close(); button.disabled = false; jobStatus.textContent = 'Live updates disconnected. Check job progress through the local API.'; };
  } catch (error) {
    button.disabled = false;
    jobStatus.textContent = error.message;
  }
});

refreshAccounts().catch((error) => { list.innerHTML = `<div class="empty-state"><span>Local API unavailable</span><small>${escapeHtml(error.message)}</small></div>`; });

const knowledgeForm = document.querySelector('#knowledge-search-form');
const knowledgeInput = document.querySelector('#knowledge-query');
const knowledgeVerification = document.querySelector('#knowledge-verification');
const knowledgeStatus = document.querySelector('#knowledge-status');
const knowledgeResults = document.querySelector('#knowledge-results');
const knowledgeDatasetInput = document.querySelector('#knowledge-dataset-json');
const knowledgePreviewButton = document.querySelector('#preview-knowledge-dataset');
const knowledgeApproveButton = document.querySelector('#approve-knowledge-dataset');
const knowledgeUpdateStatus = document.querySelector('#knowledge-update-status');
const knowledgeUpdatePreview = document.querySelector('#knowledge-update-preview');
const sourceCatalogStatus = document.querySelector('#source-catalog-status');
const sourceCatalogList = document.querySelector('#source-catalog-list');
const characterCatalogPreviewButton = document.querySelector('#preview-character-catalog');
const characterCatalogApproveButton = document.querySelector('#approve-character-catalog');
const characterCatalogStatus = document.querySelector('#character-catalog-status');
const characterCatalogPreview = document.querySelector('#character-catalog-preview');
let knowledgeTimer;
let knowledgeRequest = 0;
let activeDraftId = null;
let activeCharacterCatalogDraftId = null;

characterCatalogPreviewButton.addEventListener('click', async () => {
  activeCharacterCatalogDraftId = null;
  characterCatalogApproveButton.disabled = true;
  characterCatalogPreviewButton.disabled = true;
  characterCatalogStatus.textContent = 'Fetching the fixed Enka static catalog and validating records…';
  characterCatalogPreview.replaceChildren();
  try {
    const preview = await api('/api/v1/game-data/characters/preview', { method: 'POST', headers: requestHeaders, body: '{}' });
    activeCharacterCatalogDraftId = preview.datasetId;
    characterCatalogApproveButton.disabled = false;
    characterCatalogStatus.textContent = preview.datasetState === 'approved' ? `This exact catalog ${preview.version} is already active. Enka revision: ${preview.sourceRevision ?? 'not supplied'}.` : preview.datasetState === 'draft' ? `This exact catalog ${preview.version} already has a draft awaiting review. Enka revision: ${preview.sourceRevision ?? 'not supplied'}.` : `Catalog draft ${preview.version} is ready. Enka revision: ${preview.sourceRevision ?? 'not supplied'}.`;
    characterCatalogApproveButton.disabled = preview.datasetState === 'approved';
    characterCatalogPreview.innerHTML = `<p class="knowledge-meta">${preview.candidateCharacterCount} entries have both element and weapon metadata · ${preview.counts.added} added · ${preview.counts.modified} modified · ${preview.counts.unchanged} unchanged. The candidate count is not an independently verified playable-roster count.</p><p class="knowledge-meta">Review the canonical catalog at <code>/api/v1/game-data/characters</code> after approval. Removed records are retained by the approval workflow.</p>`;
  } catch (error) {
    characterCatalogStatus.textContent = `Catalog preview failed: ${error.message}`;
  } finally { characterCatalogPreviewButton.disabled = false; }
});

characterCatalogApproveButton.addEventListener('click', async () => {
  if (!activeCharacterCatalogDraftId) return;
  const id = activeCharacterCatalogDraftId;
  characterCatalogApproveButton.disabled = true;
  characterCatalogStatus.textContent = 'Approving the reviewed catalog…';
  try {
    const result = await api(`/api/v1/game-data/characters/datasets/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
    activeCharacterCatalogDraftId = null;
    characterCatalogStatus.textContent = `Catalog ${result.version} is active. Earlier versions remain in history.`;
  } catch (error) {
    characterCatalogApproveButton.disabled = false;
    characterCatalogStatus.textContent = `Approval failed: ${error.message}`;
  }
});

const enkaLocalizationRefresh = document.querySelector('#refresh-enka-localizations');
const enkaLocalizationStatus = document.querySelector('#enka-localizations-status');
const enkaLocalizationList = document.querySelector('#enka-localizations-list');
async function refreshEnkaLocalizationDrafts() {
  enkaLocalizationRefresh.disabled = true;
  enkaLocalizationStatus.textContent = 'Checking for a staged Enka localization draft…';
  enkaLocalizationList.replaceChildren();
  try {
    const drafts = await api('/api/v1/game-data/imports/enka-localizations');
    if (!drafts.length) {
      const active = await api('/api/v1/game-data/localizations/status?lang=en');
      enkaLocalizationStatus.textContent = active.dataset ? `No pending drafts. Approved English localization ${active.dataset.version} is active (${active.total} labels).` : 'No localization drafts found. Stage locs.json and run the preview command above.';
      return;
    }
    enkaLocalizationStatus.textContent = `${drafts.length} localization draft${drafts.length === 1 ? '' : 's'} ready for review.`;
    for (const draft of drafts) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const heading = document.createElement('h3');
      heading.textContent = `Enka localizations ${draft.version}`;
      const metadata = document.createElement('p');
      metadata.className = 'knowledge-meta';
      metadata.textContent = `${draft.preview.recordCount} labels · languages: ${draft.preview.languages.join(', ')} · ${draft.preview.counts.added} new · ${draft.preview.counts.modified} changed · ${draft.preview.counts.unchanged} unchanged`;
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'primary';
      approve.textContent = 'Approve localization snapshot';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        enkaLocalizationStatus.textContent = 'Approving reviewed localization data…';
        try {
          const result = await api(`/api/v1/game-data/imports/enka-localizations/${encodeURIComponent(draft.id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
          enkaLocalizationStatus.textContent = `Localization version ${result.version} is active. Character names resolve by text hash; original IDs and hashes remain available.`;
          await refreshEnkaLocalizationDrafts();
        } catch (error) { approve.disabled = false; enkaLocalizationStatus.textContent = `Approval failed: ${error.message}`; }
      });
      card.append(heading, metadata, approve);
      enkaLocalizationList.append(card);
    }
  } catch (error) { enkaLocalizationStatus.textContent = `Could not read localization drafts: ${error.message}`; }
  finally { enkaLocalizationRefresh.disabled = false; }
}
enkaLocalizationRefresh.addEventListener('click', refreshEnkaLocalizationDrafts);

const kqmPreviewButton = document.querySelector('#preview-kqm-guides');
const kqmApproveButton = document.querySelector('#approve-kqm-guides');
const kqmStatus = document.querySelector('#kqm-guides-status');
const kqmPreviewOutput = document.querySelector('#kqm-guides-preview');
let activeKqmDraftId = null;
kqmPreviewButton.addEventListener('click', async () => {
  activeKqmDraftId = null;
  kqmApproveButton.disabled = true;
  kqmPreviewButton.disabled = true;
  kqmStatus.textContent = 'Fetching the KQM index and extracting named character-reference pages…';
  kqmPreviewOutput.replaceChildren();
  try {
    const preview = await api('/api/v1/game-data/character-guides/preview', { method: 'POST', headers: requestHeaders, body: '{}' });
    activeKqmDraftId = preview.datasetId;
    kqmStatus.textContent = preview.datasetState === 'approved' ? `This exact index ${preview.version} is already active.` : preview.datasetState === 'draft' ? `This exact index ${preview.version} already has a draft awaiting review.` : `Coverage draft ${preview.version} is ready for review.`;
    kqmApproveButton.disabled = preview.datasetState === 'approved';
    kqmPreviewOutput.innerHTML = `<p class="knowledge-meta">${preview.pageCount} character-reference pages parsed · ${preview.counts.added} added · ${preview.counts.modified} modified · ${preview.counts.unchanged} unchanged. Page existence is not a playable-roster completeness assertion.</p>`;
  } catch (error) { kqmStatus.textContent = `KQM coverage preview failed: ${error.message}`; }
  finally { kqmPreviewButton.disabled = false; }
});
kqmApproveButton.addEventListener('click', async () => {
  if (!activeKqmDraftId) return;
  const id = activeKqmDraftId;
  kqmApproveButton.disabled = true;
  kqmStatus.textContent = 'Approving the reviewed coverage index…';
  try {
    const result = await api(`/api/v1/game-data/character-guides/datasets/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
    activeKqmDraftId = null;
    kqmStatus.textContent = `Coverage index ${result.version} is active; earlier versions remain in history.`;
  } catch (error) { kqmApproveButton.disabled = false; kqmStatus.textContent = `Approval failed: ${error.message}`; }
});
const kqmIndexDraftsButton = document.querySelector('#refresh-kqm-index-drafts');
const kqmIndexDrafts = document.querySelector('#kqm-index-drafts');
async function refreshKqmIndexDrafts() {
  kqmIndexDraftsButton.disabled = true;
  kqmIndexDrafts.replaceChildren();
  try {
    const drafts = await api('/api/v1/game-data/character-guides/drafts');
    if (!drafts.length) { kqmStatus.textContent = 'No KQM coverage drafts are waiting for approval.'; return; }
    kqmStatus.textContent = `${drafts.length} KQM page-index draft${drafts.length === 1 ? '' : 's'} awaiting approval.`;
    for (const draft of drafts) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const info = document.createElement('p');
      info.className = 'knowledge-meta';
      info.textContent = `${draft.version} · ${draft.pageCount} indexed character-reference pages · source revision ${draft.provenance.sourceRevision ?? 'not supplied'}`;
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'primary';
      approve.textContent = 'Approve KQM page index';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        try {
          const result = await api(`/api/v1/game-data/character-guides/datasets/${encodeURIComponent(draft.id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
          kqmStatus.textContent = `KQM page index ${result.version} is approved. You can now stage pages listed in that index.`;
          await refreshKqmIndexDrafts();
        } catch (error) { approve.disabled = false; kqmStatus.textContent = `KQM index approval failed: ${error.message}`; }
      });
      card.append(info, approve);
      kqmIndexDrafts.append(card);
    }
  } catch (error) { kqmStatus.textContent = `Could not load KQM page-index drafts: ${error.message}`; }
  finally { kqmIndexDraftsButton.disabled = false; }
}
kqmIndexDraftsButton.addEventListener('click', refreshKqmIndexDrafts);

const kqmEvidenceStatus = document.querySelector('#kqm-evidence-status');
const kqmEvidenceList = document.querySelector('#kqm-evidence-list');
const kqmEvidenceDraftsButton = document.querySelector('#refresh-kqm-evidence-drafts');
const kqmApprovedEvidenceButton = document.querySelector('#refresh-kqm-approved-evidence');
async function refreshKqmEvidenceDrafts() {
  kqmEvidenceDraftsButton.disabled = true;
  kqmEvidenceList.replaceChildren();
  try {
    const drafts = await api('/api/v1/game-data/character-guides/evidence/drafts');
    if (!drafts.length) { kqmEvidenceStatus.textContent = 'No KQM page evidence drafts. Stage page HTML and run npm run kqm-pages:preview.'; return; }
    kqmEvidenceStatus.textContent = `${drafts.length} experimental KQM evidence draft${drafts.length === 1 ? '' : 's'} awaiting review.`;
    for (const draft of drafts) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const summary = document.createElement('p');
      summary.className = 'knowledge-meta';
      summary.textContent = `${draft.version} · ${draft.pageCount} pages · ${draft.recordCount} evidence items · ${draft.provenance.extractorVersion} · source index ${draft.provenance.sourceIndexVersion}`;
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'primary';
      approve.textContent = 'Approve experimental evidence';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        try {
          const result = await api(`/api/v1/game-data/character-guides/evidence/datasets/${encodeURIComponent(draft.id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
          kqmEvidenceStatus.textContent = `Experimental evidence ${result.version} is approved for local reference browsing.`;
          await refreshKqmEvidenceDrafts();
          await browseKqmEvidence();
        } catch (error) { approve.disabled = false; kqmEvidenceStatus.textContent = `Evidence approval failed: ${error.message}`; }
      });
      card.append(summary, approve);
      kqmEvidenceList.append(card);
    }
  } catch (error) { kqmEvidenceStatus.textContent = `Could not load KQM evidence drafts: ${error.message}`; }
  finally { kqmEvidenceDraftsButton.disabled = false; }
}
async function browseKqmEvidence() {
  kqmApprovedEvidenceButton.disabled = true;
  kqmEvidenceList.replaceChildren();
  try {
    const result = await api('/api/v1/game-data/character-guides/evidence?limit=50');
    if (!result.total) { kqmEvidenceStatus.textContent = 'No approved KQM page evidence. Drafts remain separate until approval.'; return; }
    kqmEvidenceStatus.textContent = `${result.total} experimental evidence items in ${result.dataset.version}; none are calculation-eligible.`;
    for (const entry of result.items) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const heading = document.createElement('h3');
      heading.textContent = `${entry.displayName} · ${entry.sectionPath.join(' / ')} · ${entry.kind}`;
      const content = document.createElement('p');
      content.className = 'knowledge-meta';
      content.textContent = entry.text ?? `${entry.headers.join(' | ')} — ${entry.rows.map((row) => row.join(' | ')).join(' · ')}`;
      const source = document.createElement('a');
      source.className = 'source-catalog-link';
      source.href = entry.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Open KQM source page';
      card.append(heading, content, source);
      kqmEvidenceList.append(card);
    }
  } catch (error) { kqmEvidenceStatus.textContent = `Could not browse KQM evidence: ${error.message}`; }
  finally { kqmApprovedEvidenceButton.disabled = false; }
}
kqmEvidenceDraftsButton.addEventListener('click', refreshKqmEvidenceDrafts);
kqmApprovedEvidenceButton.addEventListener('click', browseKqmEvidence);

const reconciliationButton = document.querySelector('#run-character-reconciliation');
const reconciliationFilter = document.querySelector('#reconciliation-status-filter');
const reconciliationSearch = document.querySelector('#reconciliation-search');
const reconciliationStatus = document.querySelector('#reconciliation-status');
const reconciliationSummary = document.querySelector('#reconciliation-summary');
const reconciliationResults = document.querySelector('#reconciliation-results');
const reconciliationLoadMore = document.querySelector('#reconciliation-load-more');
let reconciliationOffset = 0;
let reconciliationTotal = 0;
function appendReconciliationItems(items) {
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'source-catalog-item';
    const title = document.createElement('h3');
    title.textContent = item.displayName;
    const status = document.createElement('p');
    status.className = 'knowledge-meta';
    status.textContent = `${item.status}${item.matchedBy ? ` · ${item.matchedBy}` : ''} · review: ${item.review?.decision ?? 'unreviewed'}`;
    card.append(title, status);
    for (const source of item.sources) {
      const line = document.createElement('p');
      line.className = 'knowledge-meta';
      line.textContent = `${source.sourceId} · key ${source.key} · ${source.version}`;
      card.append(line);
    }
    if (item.conflicts.length) {
      const heading = document.createElement('h4');
      heading.textContent = 'Comparable field differences';
      const list = document.createElement('ul');
      for (const conflict of item.conflicts) {
        const line = document.createElement('li');
        line.textContent = `${conflict.field}: ${conflict.values.map((value) => `${value.sourceId} “${value.raw}” → ${value.normalized}`).join(' · ')}`;
        list.append(line);
      }
      card.append(heading, list);
      for (const conflict of item.conflicts) {
        if (!['id-match', 'name-match'].includes(item.status) || !conflict.fingerprint) continue;
        const reviewBlock = document.createElement('div');
        reviewBlock.className = 'knowledge-update';
        const label = document.createElement('p');
        label.className = 'knowledge-meta';
        label.textContent = `${conflict.field} field decision: ${conflict.review?.decision ?? (item.review?.decision === 'accepted' ? 'unreviewed' : 'confirm identity first')}`;
        reviewBlock.append(label);
        if (item.review?.decision === 'accepted') {
          const controls = document.createElement('div');
          controls.className = 'knowledge-update-actions';
          const choice = document.createElement('select');
          choice.setAttribute('aria-label', `Select source value for ${conflict.field}`);
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'Choose reviewed value';
          choice.append(empty);
          for (const value of conflict.values) {
            const option = document.createElement('option');
            option.value = JSON.stringify({ sourceId: value.sourceId, normalized: value.normalized });
            option.textContent = `${value.sourceId}: ${value.raw} → ${value.normalized}`;
            if (conflict.review?.decision === 'selected-source' && conflict.review.selectedSourceId === value.sourceId && conflict.review.selectedValue === value.normalized) option.selected = true;
            choice.append(option);
          }
          const apply = document.createElement('button');
          apply.type = 'button';
          apply.className = 'text-action';
          apply.textContent = 'Apply field decision';
          apply.addEventListener('click', async () => {
            if (!choice.value) { reconciliationStatus.textContent = `Choose a current evidence value for ${conflict.field}.`; return; }
            apply.disabled = true;
            try {
              const selected = JSON.parse(choice.value);
              await api('/api/v1/game-data/reconciliation/field-reviews', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ fingerprint: conflict.fingerprint, decision: 'selected-source', selectedSourceId: selected.sourceId, selectedValue: selected.normalized }) });
              await loadCharacterReconciliation(true);
            } catch (error) { apply.disabled = false; reconciliationStatus.textContent = `Could not save field decision: ${error.message}`; }
          });
          const defer = document.createElement('button');
          defer.type = 'button';
          defer.className = 'text-action';
          defer.textContent = 'Defer field review';
          defer.disabled = conflict.review?.decision === 'deferred';
          defer.addEventListener('click', async () => {
            defer.disabled = true;
            try {
              await api('/api/v1/game-data/reconciliation/field-reviews', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ fingerprint: conflict.fingerprint, decision: 'deferred' }) });
              await loadCharacterReconciliation(true);
            } catch (error) { defer.disabled = false; reconciliationStatus.textContent = `Could not defer field review: ${error.message}`; }
          });
          controls.append(choice, apply, defer);
          reviewBlock.append(controls);
        }
        card.append(reviewBlock);
      }
    } else {
      const note = document.createElement('p');
      note.className = 'knowledge-meta';
      note.textContent = 'No disagreements among comparable fields. Missing source values remain unknown.';
      card.append(note);
    }
    if (item.possibleMatches.length && !['id-match', 'name-match'].includes(item.status)) {
      const possible = document.createElement('p');
      possible.className = 'knowledge-meta';
      possible.textContent = `Possible matches to review: ${item.possibleMatches.map((match) => `${match.displayName ?? '(unlocalized)'} [${match.sourceId}]`).join(', ')}`;
      card.append(possible);
    }
    for (const guide of item.guideReferences) {
      const link = document.createElement('a');
      link.className = 'source-catalog-link';
      link.href = guide.pageUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `KQM TCL reference: ${guide.displayName} ↗`;
      card.append(link);
    }
    if (item.reviewFingerprint && ['id-match', 'name-match'].includes(item.status)) {
      const actions = document.createElement('div');
      actions.className = 'knowledge-update-actions';
      for (const [decision, label] of [['accepted', 'Confirm link'], ['rejected', 'Reject link'], ['deferred', 'Defer review']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = decision === 'accepted' ? 'primary' : 'text-action';
        button.textContent = label;
        button.disabled = item.review?.decision === decision;
        button.addEventListener('click', async () => {
          button.disabled = true;
          reconciliationStatus.textContent = 'Saving the reviewed identity decision…';
          try {
            await api('/api/v1/game-data/reconciliation/reviews', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ fingerprint: item.reviewFingerprint, decision }) });
            await loadCharacterReconciliation(true);
          } catch (error) {
            button.disabled = false;
            reconciliationStatus.textContent = `Could not save review: ${error.message}`;
          }
        });
        actions.append(button);
      }
      card.append(actions);
    }
    reconciliationResults.append(card);
  }
}
async function loadCharacterReconciliation(reset = true) {
  reconciliationButton.disabled = true;
  if (reset) {
    reconciliationOffset = 0;
    reconciliationSummary.replaceChildren();
    reconciliationResults.replaceChildren();
    reconciliationStatus.textContent = 'Comparing approved source snapshots…';
  }
  try {
    const query = new URLSearchParams({ limit: '100', offset: String(reconciliationOffset), q: reconciliationSearch.value, status: reconciliationFilter.value });
    const report = await api(`/api/v1/game-data/reconciliation/characters?${query}`);
    reconciliationTotal = report.total;
    const summary = report.summary;
    const versions = Object.entries(report.sourceDatasets).map(([source, dataset]) => `${source}: ${dataset?.version ?? 'not imported'}`).join(' · ');
    if (reset) {
      const totals = document.createElement('p');
      totals.className = 'knowledge-meta';
      const reviews = summary.reviews ?? { accepted: 0, rejected: 0, deferred: 0, unreviewed: 0 };
      totals.textContent = `Genshin-DB ${summary.genshinDbCharacters} · Enka ${summary.enkaAvatarDefinitions} · KQM TCL pages ${summary.guideReferencePages} · ID matches ${summary.matchedById} · name suggestions ${summary.matchedByName} · ambiguous ${summary.ambiguous} · candidates with conflicts ${summary.conflicts} · review decisions accepted ${reviews.accepted}, rejected ${reviews.rejected}, deferred ${reviews.deferred}, unreviewed ${reviews.unreviewed} · unmatched KQM pages ${summary.unmatchedGuideReferencePages}`;
      const versionsLine = document.createElement('p');
      versionsLine.className = 'knowledge-meta';
      versionsLine.textContent = versions;
      reconciliationSummary.append(totals, versionsLine);
      if (report.unmatchedGuideReferences.length) {
        const details = document.createElement('details');
        const label = document.createElement('summary');
        label.textContent = `KQM TCL pages without a unique current name match (${report.unmatchedGuideReferences.length})`;
        const list = document.createElement('ul');
        for (const guide of report.unmatchedGuideReferences) {
          const row = document.createElement('li');
          const link = document.createElement('a');
          link.href = guide.pageUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${guide.displayName} ↗`;
          row.append(link);
          list.append(row);
        }
        details.append(label, list);
        reconciliationSummary.append(details);
      }
    }
    appendReconciliationItems(report.items);
    reconciliationOffset += report.items.length;
    reconciliationStatus.textContent = `${reconciliationTotal} candidates match the current filters; showing ${reconciliationOffset}.`;
    reconciliationLoadMore.hidden = reconciliationOffset >= reconciliationTotal;
  } catch (error) {
    reconciliationStatus.textContent = `Reconciliation failed: ${error.message}`;
    reconciliationLoadMore.hidden = true;
  } finally { reconciliationButton.disabled = false; }
}
reconciliationButton.addEventListener('click', () => loadCharacterReconciliation(true));
reconciliationLoadMore.addEventListener('click', () => loadCharacterReconciliation(false));

const reconciliationSnapshotSaveButton = document.querySelector('#save-reconciliation-snapshot');
const reconciliationHistoryButton = document.querySelector('#refresh-reconciliation-history');
const reconciliationHistory = document.querySelector('#reconciliation-history');
reconciliationSnapshotSaveButton.addEventListener('click', async () => {
  reconciliationSnapshotSaveButton.disabled = true;
  reconciliationStatus.textContent = 'Saving the full source reconciliation report…';
  try {
    const saved = await api('/api/v1/game-data/reconciliation/characters/snapshots', { method: 'POST', headers: requestHeaders, body: '{}' });
    reconciliationStatus.textContent = saved.created ? `Saved reconciliation snapshot ${saved.snapshotVersion}.` : `This report already has a saved snapshot: ${saved.snapshotVersion}.`;
    await refreshReconciliationHistory();
  } catch (error) { reconciliationStatus.textContent = `Could not save reconciliation snapshot: ${error.message}`; }
  finally { reconciliationSnapshotSaveButton.disabled = false; }
});

async function refreshReconciliationHistory() {
  reconciliationHistoryButton.disabled = true;
  reconciliationHistory.replaceChildren();
  try {
    const history = await api('/api/v1/game-data/reconciliation/characters/snapshots?limit=25');
    if (!history.total) {
      const empty = document.createElement('p');
      empty.className = 'knowledge-meta';
      empty.textContent = 'No full reconciliation reports have been saved.';
      reconciliationHistory.append(empty);
      return;
    }
    const latest = history.items[0];
    for (const snapshot of history.items) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const info = document.createElement('p');
      info.className = 'knowledge-meta';
      info.textContent = `${snapshot.snapshotVersion} · ${snapshot.summary.genshinDbCharacters ?? 0} Genshin-DB characters · ${snapshot.summary.enkaAvatarDefinitions ?? 0} Enka records · ${snapshot.summary.unmatchedGuideReferencePages ?? 0} unmatched KQM pages · saved ${new Date(snapshot.createdAt).toLocaleString()}`;
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'text-action';
      view.textContent = 'View saved report';
      view.addEventListener('click', async () => {
        view.disabled = true;
        try {
          const stored = await api(`/api/v1/game-data/reconciliation/characters/snapshots/${snapshot.id}`);
          reconciliationResults.replaceChildren();
          for (const candidate of stored.snapshot.items) {
            const row = document.createElement('p');
            row.className = 'knowledge-meta';
            row.textContent = `${candidate.displayName} · ${candidate.status} · ${candidate.conflicts.length} conflicts · ${candidate.guideReferences.length} KQM references`;
            reconciliationResults.append(row);
          }
          const unmatched = document.createElement('p');
          unmatched.className = 'knowledge-meta';
          unmatched.textContent = `Unmatched KQM reference pages: ${stored.snapshot.unmatchedGuideReferences.map((guide) => guide.displayName).join(', ') || 'none'}`;
          reconciliationResults.append(unmatched);
          reconciliationStatus.textContent = `Viewing saved report ${stored.snapshotVersion}; current source data was not changed.`;
        } catch (error) { reconciliationStatus.textContent = `Could not load saved report: ${error.message}`; }
        finally { view.disabled = false; }
      });
      card.append(info, view);
      if (latest && latest.id !== snapshot.id) {
        const compare = document.createElement('button');
        compare.type = 'button';
        compare.className = 'text-action';
        compare.textContent = 'Compare with latest report';
        compare.addEventListener('click', async () => {
          compare.disabled = true;
          try {
            const diff = await api(`/api/v1/game-data/reconciliation/characters/snapshots/compare?from=${encodeURIComponent(snapshot.id)}&to=${encodeURIComponent(latest.id)}`);
            const details = document.createElement('details');
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = `${diff.summary.addedCandidates} candidates added · ${diff.summary.removedCandidates} removed · ${diff.summary.changedFields} fields changed · ${diff.summary.conflictReviewChanges} field decisions changed · ${diff.summary.addedUnmatchedGuideReferences} unmatched guide pages added · ${diff.summary.removedUnmatchedGuideReferences} removed${diff.sourceDatasetsChanged ? ' · source versions changed' : ''}`;
            const list = document.createElement('ul');
            for (const change of [...diff.addedCandidates.map((item) => ({ label: `Added ${item.displayName} (${item.status})` })), ...diff.removedCandidates.map((item) => ({ label: `Removed ${item.displayName} (${item.status})` })), ...diff.candidateChanges.map((item) => ({ label: `${item.displayName} changed: ${item.changedProperties.join(', ')}` })), ...diff.fieldChanges.map((item) => ({ label: `${item.displayName} · ${item.field}: ${item.before.map((value) => `${value.sourceId}=${value.normalized}`).join(', ') || 'unknown'} → ${item.after.map((value) => `${value.sourceId}=${value.normalized}`).join(', ') || 'unknown'}` })), ...diff.conflictReviewChanges.map((item) => ({ label: `${item.displayName} · ${item.field} decision: ${item.before?.decision ?? 'none'} → ${item.after?.decision ?? 'none'}` })), ...diff.addedUnmatchedGuideReferences.map((item) => ({ label: `Unmatched KQM page added: ${item.displayName}` })), ...diff.removedUnmatchedGuideReferences.map((item) => ({ label: `Unmatched KQM page removed: ${item.displayName}` }))]) {
              const line = document.createElement('li');
              line.textContent = change.label;
              list.append(line);
            }
            details.append(summary, list);
            card.append(details);
            reconciliationStatus.textContent = `Compared report ${diff.fromVersion} with ${diff.toVersion}.`;
          } catch (error) { reconciliationStatus.textContent = `Reconciliation comparison failed: ${error.message}`; }
          finally { compare.disabled = false; }
        });
        card.append(compare);
      }
      reconciliationHistory.append(card);
    }
  } catch (error) { reconciliationStatus.textContent = `Could not load reconciliation history: ${error.message}`; }
  finally { reconciliationHistoryButton.disabled = false; }
}
reconciliationHistoryButton.addEventListener('click', refreshReconciliationHistory);

const canonicalProjectionButton = document.querySelector('#load-canonical-projection');
const canonicalProjectionSaveButton = document.querySelector('#save-canonical-projection');
const canonicalSnapshotHistoryButton = document.querySelector('#refresh-canonical-snapshot-history');
const canonicalProjectionStatus = document.querySelector('#canonical-projection-status');
const canonicalProjectionResults = document.querySelector('#canonical-projection-results');
const canonicalProjectionHistory = document.querySelector('#canonical-projection-history');
function renderSavedCanonicalProjection(projection) {
  canonicalProjectionResults.replaceChildren();
  const summary = document.createElement('p');
  summary.className = 'knowledge-meta';
  summary.textContent = `Projection ${projection.dataset.version} · ${projection.summary.acceptedIdentityLinks} accepted links · ${projection.summary.unresolvedFieldConflicts} unresolved conflicts.`;
  canonicalProjectionResults.append(summary);
  for (const character of projection.items) {
    const card = document.createElement('article');
    card.className = 'source-catalog-item';
    const heading = document.createElement('h3');
    heading.textContent = character.displayName;
    const fields = document.createElement('ul');
    for (const [name, field] of Object.entries(character.fields)) {
      const line = document.createElement('li');
      line.textContent = `${name}: ${field.value ?? 'unresolved'} (${field.state})${field.adjudication ? ` · selected from ${field.adjudication.selectedSourceId}` : ''}`;
      fields.append(line);
    }
    card.append(heading, fields);
    canonicalProjectionResults.append(card);
  }
}
canonicalProjectionButton.addEventListener('click', async () => {
  canonicalProjectionButton.disabled = true;
  canonicalProjectionStatus.textContent = 'Building the versioned view from accepted identity links…';
  canonicalProjectionResults.replaceChildren();
  try {
    const projection = await api('/api/v1/game-data/canonical-characters');
    const summary = document.createElement('p');
    summary.className = 'knowledge-meta';
    summary.textContent = `Projection ${projection.dataset.version} · ${projection.summary.acceptedIdentityLinks} accepted links · ${projection.summary.corroboratedFields} corroborated fields · ${projection.summary.unresolvedFieldConflicts} unresolved conflicts · ${projection.summary.singleSourceFields} single-source fields.`;
    canonicalProjectionResults.append(summary);
    for (const character of projection.items) {
      const card = document.createElement('article');
      card.className = 'source-catalog-item';
      const heading = document.createElement('h3');
      heading.textContent = character.displayName;
      const identity = document.createElement('p');
      identity.className = 'knowledge-meta';
      identity.textContent = `Accepted ${character.matchedBy} · calculation eligible: no · ${character.canonicalName ? `label: ${character.canonicalName}` : 'canonical name unresolved'}`;
      const fields = document.createElement('ul');
      for (const [fieldName, field] of Object.entries(character.fields)) {
        const line = document.createElement('li');
        const evidence = field.evidence.map((item) => `${item.sourceId}: ${item.raw}`).join(' · ');
        line.textContent = `${fieldName}: ${field.value ?? 'unresolved'} (${field.state})${field.adjudication ? ` · selected from ${field.adjudication.selectedSourceId}` : ''} · ${evidence}`;
        fields.append(line);
      }
      card.append(heading, identity, fields);
      canonicalProjectionResults.append(card);
    }
    canonicalProjectionStatus.textContent = projection.total ? 'Projection is computed from the current approved source versions and accepted reviews.' : 'No accepted identity links yet. Confirm a match in the reconciliation list to include it.';
  } catch (error) { canonicalProjectionStatus.textContent = `Projection failed: ${error.message}`; }
  finally { canonicalProjectionButton.disabled = false; }
});

canonicalProjectionSaveButton.addEventListener('click', async () => {
  canonicalProjectionSaveButton.disabled = true;
  canonicalProjectionStatus.textContent = 'Saving an immutable snapshot of the current reviewed projection…';
  try {
    const saved = await api('/api/v1/game-data/canonical-characters/snapshots', { method: 'POST', headers: requestHeaders, body: '{}' });
    canonicalProjectionStatus.textContent = saved.created ? `Saved snapshot ${saved.datasetVersion}.` : `This projection already has a snapshot: ${saved.datasetVersion}.`;
    await refreshCanonicalSnapshotHistory();
  } catch (error) { canonicalProjectionStatus.textContent = `Snapshot save failed: ${error.message}`; }
  finally { canonicalProjectionSaveButton.disabled = false; }
});

async function refreshCanonicalSnapshotHistory() {
  canonicalSnapshotHistoryButton.disabled = true;
  canonicalProjectionHistory.replaceChildren();
  try {
    const history = await api('/api/v1/game-data/canonical-characters/snapshots?limit=25');
    if (!history.total) {
      const empty = document.createElement('p');
      empty.className = 'knowledge-meta';
      empty.textContent = 'No projection snapshots have been saved.';
      canonicalProjectionHistory.append(empty);
      return;
    }
    const latestSnapshot = history.items[0];
    for (const snapshot of history.items) {
      const item = document.createElement('article');
      item.className = 'source-catalog-item';
      const info = document.createElement('p');
      info.className = 'knowledge-meta';
      info.textContent = `${snapshot.datasetVersion} · ${snapshot.summary.acceptedIdentityLinks} accepted links · saved ${new Date(snapshot.createdAt).toLocaleString()}`;
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'text-action';
      view.textContent = 'View saved snapshot';
      view.addEventListener('click', async () => {
        view.disabled = true;
        try {
          const stored = await api(`/api/v1/game-data/canonical-characters/snapshots/${snapshot.id}`);
          renderSavedCanonicalProjection(stored.snapshot);
          canonicalProjectionStatus.textContent = `Viewing saved snapshot from ${new Date(stored.createdAt).toLocaleString()}; current data was not changed.`;
        } catch (error) { canonicalProjectionStatus.textContent = `Could not load saved snapshot: ${error.message}`; }
        finally { view.disabled = false; }
      });
      item.append(info, view);
      if (latestSnapshot && latestSnapshot.id !== snapshot.id) {
        const compare = document.createElement('button');
        compare.type = 'button';
        compare.className = 'text-action';
        compare.textContent = 'Compare with latest snapshot';
        compare.addEventListener('click', async () => {
          compare.disabled = true;
          try {
            const diff = await api(`/api/v1/game-data/canonical-characters/snapshots/compare?from=${encodeURIComponent(snapshot.id)}&to=${encodeURIComponent(latestSnapshot.id)}`);
            const details = document.createElement('details');
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = `Compared with latest: ${diff.summary.changedFields} changed fields, ${diff.summary.addedCharacters} added, ${diff.summary.removedCharacters} removed${diff.sourceDatasetsChanged ? ' · source versions changed' : ''}`;
            const changes = document.createElement('ul');
            for (const change of diff.fieldChanges) {
              const row = document.createElement('li');
              row.textContent = `${change.displayName} · ${change.field}: ${change.before?.value ?? 'unresolved'} (${change.before?.state ?? 'unknown'}) → ${change.after?.value ?? 'unresolved'} (${change.after?.state ?? 'unknown'})`;
              changes.append(row);
            }
            details.append(summary, changes);
            item.append(details);
            canonicalProjectionStatus.textContent = `Compared projection ${diff.fromVersion} with ${diff.toVersion}.`;
          } catch (error) { canonicalProjectionStatus.textContent = `Snapshot comparison failed: ${error.message}`; }
          finally { compare.disabled = false; }
        });
        item.append(compare);
      }
      canonicalProjectionHistory.append(item);
    }
  } catch (error) { canonicalProjectionStatus.textContent = `Snapshot history failed: ${error.message}`; }
  finally { canonicalSnapshotHistoryButton.disabled = false; }
}
canonicalSnapshotHistoryButton.addEventListener('click', refreshCanonicalSnapshotHistory);

const localImportsButton = document.querySelector('#refresh-local-imports');
const localImportsStatus = document.querySelector('#local-imports-status');
const localImportsList = document.querySelector('#local-imports-list');
async function refreshLocalImports() {
  localImportsButton.disabled = true;
  localImportsStatus.textContent = 'Checking for staged local snapshots…';
  localImportsList.replaceChildren();
  try {
    const drafts = await api('/api/v1/game-data/imports');
    if (!drafts.length) { localImportsStatus.textContent = 'No local snapshot drafts found. Stage a dataset and run the preview command above.'; return; }
    localImportsStatus.textContent = `${drafts.length} draft snapshot${drafts.length === 1 ? '' : 's'} ready for review.`;
    for (const draft of drafts) {
      const item = document.createElement('article');
      item.className = 'source-catalog-item';
      const counts = draft.preview?.counts ?? { added: 0, modified: 0, unchanged: 0 };
      const categoryCounts = draft.preview?.categoryCounts ?? {};
      const categoryDiffs = draft.preview?.categoryDiffs ?? {};
      const carryForwardCounts = draft.preview?.carryForwardCounts ?? {};
      const categorySummary = Object.entries(categoryCounts).map(([category, count]) => {
        const diff = categoryDiffs[category] ?? { added: 0, modified: 0, unchanged: 0 };
        return `${escapeHtml(category)}: ${Number(count)} records (${Number(diff.added)} new, ${Number(diff.modified)} changed)`;
      }).join(' · ');
      const retainedSummary = Object.entries(carryForwardCounts).map(([category, count]) => `${escapeHtml(category)}: ${Number(count)} retained`).join(' · ');
      const missing = draft.preview?.optionalCategoriesMissing ?? {};
      item.innerHTML = `<h3>Genshin-DB ${escapeHtml(draft.version)}</h3><p class="knowledge-meta">${draft.recordCount} character records · ${counts.added} added · ${counts.modified} modified · ${counts.unchanged} unchanged</p>${categorySummary ? `<p class="knowledge-meta">Additional records · ${categorySummary}</p>` : ''}${retainedSummary ? `<p class="knowledge-meta">Omitted from this staged snapshot and retained on approval · ${retainedSummary}</p>` : ''}<p class="knowledge-meta">Source revision: ${escapeHtml(draft.provenance.sourceRevision ?? 'not supplied')} · Talents missing for ${Number(missing.talents ?? 0)} · Constellations missing for ${Number(missing.constellations ?? 0)}</p>`;
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'primary';
      approve.textContent = 'Approve local snapshot';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        localImportsStatus.textContent = 'Approving the reviewed snapshot…';
        try {
          const result = await api(`/api/v1/game-data/imports/${encodeURIComponent(draft.id)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
          localImportsStatus.textContent = `Snapshot ${result.version} is active. Previous versions remain in history.`;
          await refreshLocalImports();
        } catch (error) { approve.disabled = false; localImportsStatus.textContent = `Approval failed: ${error.message}`; }
      });
      item.append(approve);
      localImportsList.append(item);
    }
  } catch (error) { localImportsStatus.textContent = `Could not read local import drafts: ${error.message}`; }
  finally { localImportsButton.disabled = false; }
}
localImportsButton.addEventListener('click', refreshLocalImports);

const genshinDbBrowseButton = document.querySelector('#browse-genshin-db');
const genshinDbCategorySelect = document.querySelector('#genshin-db-category');
const genshinDbSearch = document.querySelector('#genshin-db-search');
const genshinDbBrowserStatus = document.querySelector('#genshin-db-browser-status');
const genshinDbBrowserList = document.querySelector('#genshin-db-browser-list');
const genshinDbLoadMore = document.querySelector('#genshin-db-load-more');
let genshinDbOffset = 0;
let genshinDbTotal = 0;
function renderGenshinDbRecords(items) {
  for (const item of items) {
    const article = document.createElement('article');
    article.className = 'source-catalog-item';
    const heading = document.createElement('h3');
    heading.textContent = item.name || item.key;
    const metadata = document.createElement('p');
    metadata.className = 'knowledge-meta';
    metadata.textContent = `Source key: ${item.key}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Inspect preserved source record';
    const source = document.createElement('pre');
    source.className = 'source-record-json';
    source.textContent = JSON.stringify(item.raw, null, 2);
    details.append(summary, source);
    article.append(heading, metadata, details);
    genshinDbBrowserList.append(article);
  }
}
async function browseGenshinDb(reset = true) {
  genshinDbBrowseButton.disabled = true;
  if (reset) {
    genshinDbOffset = 0;
    genshinDbBrowserList.replaceChildren();
    genshinDbBrowserStatus.textContent = 'Loading approved source records…';
  }
  try {
    const category = encodeURIComponent(genshinDbCategorySelect.value);
    const query = new URLSearchParams({ limit: '50', offset: String(genshinDbOffset), q: genshinDbSearch.value });
    const result = await api(`/api/v1/game-data/genshin-db/${category}?${query}`);
    genshinDbTotal = result.total;
    if (!result.dataset) {
      genshinDbBrowserStatus.textContent = 'No Genshin-DB snapshot has been approved yet.';
      genshinDbLoadMore.hidden = true;
      return;
    }
    renderGenshinDbRecords(result.items);
    genshinDbOffset += result.items.length;
    genshinDbBrowserStatus.textContent = `${genshinDbTotal} ${result.category} records in approved source version ${result.dataset.version}; showing ${genshinDbOffset}.`;
    genshinDbLoadMore.hidden = genshinDbOffset >= genshinDbTotal;
  } catch (error) {
    genshinDbBrowserStatus.textContent = `Could not load source records: ${error.message}`;
    genshinDbLoadMore.hidden = true;
  } finally { genshinDbBrowseButton.disabled = false; }
}
genshinDbBrowseButton.addEventListener('click', () => browseGenshinDb(true));
genshinDbLoadMore.addEventListener('click', () => browseGenshinDb(false));

function renderKnowledgeEntry(entry) {
  const card = document.createElement('article');
  card.className = 'knowledge-result';
  const confidence = entry.confidence === null ? 'Confidence not assessed' : `Confidence recorded: ${entry.confidence}`;
  const limitations = entry.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('');
  const sources = entry.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.publisher)}: ${escapeHtml(source.title)} <span aria-hidden="true">↗</span></a><small>Source checked ${escapeHtml(source.checkedAt)}</small>`).join('');
  card.innerHTML = `<div class="knowledge-result-top"><span class="knowledge-category">${escapeHtml(entry.category)}</span><span class="verification-tag verification-${escapeHtml(entry.verificationState)}">${escapeHtml(entry.verificationState)}</span></div><h3>${escapeHtml(entry.title)}</h3><p class="knowledge-summary">${escapeHtml(entry.summary)}</p><details><summary>Read details, limitations, and sources</summary><p class="knowledge-content">${escapeHtml(entry.content)}</p><p class="knowledge-meta">${escapeHtml(confidence)} · Dataset ${escapeHtml(entry.dataset.version)}${entry.gameVersion ? ` · Game version ${escapeHtml(entry.gameVersion)}` : ''}</p><h4>Known limitations</h4><ul>${limitations}</ul><h4>Sources</h4><div class="knowledge-sources">${sources}</div></details>`;
  return card;
}

function renderSource(source, coverage) {
  const card = document.createElement('article');
  card.className = 'source-catalog-item';
  const domains = source.domains.map(escapeHtml).join(' · ');
  const guardrails = source.guardrails.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const related = (coverage?.relatedDatasets ?? []).map((item) => `${item.label}: ${item.datasetState} (${item.approvedRecords} records; source check ${item.freshness.status})`).join(' · ');
  const freshness = coverage?.freshness;
  const checkText = !freshness || freshness.status === 'check-unknown'
    ? 'source check date unknown'
    : `last checked ${new Date(freshness.sourceCheckedAt).toLocaleString()} (${freshness.daysSinceCheck} day(s) ago) · ${freshness.status}`;
  const checkDetails = freshness?.checkedDatasetVersion ? ` · checked version ${freshness.checkedDatasetVersion}` : '';
  const provenance = freshness?.sourceRevision ? ` · source revision ${freshness.sourceRevision}` : '';
  const imported = freshness?.importedAt ? ` · imported ${new Date(freshness.importedAt).toLocaleString()}` : '';
  const state = coverage ? `${coverage.adapterStatus} · ${coverage.datasetState}${coverage.adapterStatus === 'implemented' ? ` · ${coverage.approvedRecords} approved records${coverage.draftCount ? ` · ${coverage.draftCount} draft(s)` : ''}` : ''}${related ? ` · ${related}` : ''}` : 'Coverage status unavailable';
  card.innerHTML = `<div class="knowledge-result-top"><span class="knowledge-category">${escapeHtml(source.authority)} · ${escapeHtml(source.status)}</span><a class="source-catalog-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div><h3>${escapeHtml(source.name)}</h3><p class="knowledge-summary">${escapeHtml(source.scope)}</p><p class="knowledge-meta">${escapeHtml(source.publisher)} · ${domains}</p><p class="knowledge-meta">Local status: ${escapeHtml(state)}${coverage?.datasetVersion ? ` · ${escapeHtml(coverage.datasetVersion)}` : ''}</p><p class="knowledge-meta">Source check: ${escapeHtml(checkText + checkDetails + provenance + imported)}</p><p class="knowledge-summary">Coverage: ${escapeHtml(source.coverage)}</p><p class="knowledge-summary">Update policy: ${escapeHtml(source.updatePolicy)}</p><ul>${guardrails}</ul>`;
  return card;
}

async function loadSourceCatalog() {
  try {
    const [sources, coverage] = await Promise.all([api('/api/v1/sources'), api('/api/v1/game-data/coverage')]);
    const bySource = new Map(coverage.map((item) => [item.sourceId, item]));
    sourceCatalogList.replaceChildren(...sources.map((source) => renderSource(source, bySource.get(source.id))));
    sourceCatalogStatus.textContent = `${sources.length} sources registered; adapter, imported-record, and source-check status are shown individually. Check age is informational; no freshness threshold is inferred.`;
  } catch (error) {
    sourceCatalogStatus.textContent = `Source registry unavailable: ${error.message}`;
  }
}

async function searchKnowledge() {
  const requestId = ++knowledgeRequest;
  const params = new URLSearchParams();
  const query = knowledgeInput.value.trim();
  const verification = knowledgeVerification.value;
  if (query) params.set('q', query);
  if (verification) params.set('verification', verification);
  knowledgeStatus.textContent = 'Searching saved knowledge…';
  try {
    const result = await api(`/api/v1/knowledge?${params}`);
    if (requestId !== knowledgeRequest) return;
    knowledgeResults.replaceChildren(...result.items.map(renderKnowledgeEntry));
    knowledgeStatus.textContent = result.total === 0 ? 'No entries match this search.' : `${result.total} ${result.total === 1 ? 'entry' : 'entries'} found`;
  } catch (error) {
    if (requestId !== knowledgeRequest) return;
    knowledgeResults.replaceChildren();
    knowledgeStatus.textContent = `Knowledge search unavailable: ${error.message}`;
  }
}

knowledgeForm.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(knowledgeTimer); searchKnowledge(); });
knowledgeInput.addEventListener('input', () => { clearTimeout(knowledgeTimer); knowledgeTimer = setTimeout(searchKnowledge, 180); });
knowledgeVerification.addEventListener('change', searchKnowledge);
knowledgeDatasetInput.addEventListener('input', () => {
  activeDraftId = null;
  knowledgeApproveButton.disabled = true;
  knowledgeUpdateStatus.textContent = 'Dataset changed. Preview it again before approval.';
  knowledgeUpdatePreview.replaceChildren();
});
knowledgePreviewButton.addEventListener('click', async () => {
  activeDraftId = null;
  knowledgeApproveButton.disabled = true;
  let dataset;
  try { dataset = JSON.parse(knowledgeDatasetInput.value); }
  catch { knowledgeUpdateStatus.textContent = 'Enter a valid JSON document first.'; return; }
  knowledgePreviewButton.disabled = true;
  knowledgeDatasetInput.disabled = true;
  knowledgeUpdateStatus.textContent = 'Validating and preparing a local draft…';
  knowledgeUpdatePreview.replaceChildren();
  try {
    const preview = await api('/api/v1/knowledge/datasets/preview', { method: 'POST', headers: requestHeaders, body: JSON.stringify(dataset) });
    activeDraftId = preview.datasetId;
    knowledgeApproveButton.disabled = false;
    knowledgeUpdateStatus.textContent = `Draft ${preview.key} v${preview.version} is ready for review.`;
    const changes = preview.entries.map((entry) => `<li><span class="change-${escapeHtml(entry.change)}">${escapeHtml(entry.change)}</span> ${escapeHtml(entry.slug)}</li>`).join('');
    knowledgeUpdatePreview.innerHTML = `<p class="knowledge-meta">${preview.counts.added} added · ${preview.counts.modified} modified · ${preview.counts.unchanged} unchanged</p><ul>${changes}</ul><p class="knowledge-meta">Entries omitted from the update are retained. Review the full draft before approval.</p>`;
  } catch (error) {
    knowledgeUpdateStatus.textContent = `Preview failed: ${error.message}`;
  } finally {
    knowledgePreviewButton.disabled = false;
    knowledgeDatasetInput.disabled = false;
  }
});
knowledgeApproveButton.addEventListener('click', async () => {
  if (!activeDraftId) return;
  const draftId = activeDraftId;
  knowledgeApproveButton.disabled = true;
  knowledgeUpdateStatus.textContent = 'Approving dataset…';
  try {
    const approved = await api(`/api/v1/knowledge/datasets/${encodeURIComponent(draftId)}/approve`, { method: 'POST', headers: requestHeaders, body: '{}' });
    activeDraftId = null;
    knowledgeUpdateStatus.textContent = `Dataset ${approved.version} is now active. The previous version remains available in history.`;
    await searchKnowledge();
  } catch (error) {
    knowledgeApproveButton.disabled = false;
    knowledgeUpdateStatus.textContent = `Approval failed: ${error.message}`;
  }
});
searchKnowledge();
loadSourceCatalog();
