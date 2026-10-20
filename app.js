(() => {
  'use strict';

  const DATA = window.CR_DATA;
  const INAT = 'https://api.inaturalist.org/v1';
  const PLACE = DATA.place.id;
  const STORE = 'crLifeList.checklist.v1';
  const UI_STORE = 'crLifeList.ui.v1';
  const PAGE = 150;
  const THREAT = new Set(['VU', 'EN', 'CR', 'EW']);
  const IUCN_LABEL = { LC: 'Least concern', NT: 'Near threatened', VU: 'Vulnerable', EN: 'Endangered', CR: 'Critically endangered', EW: 'Extinct in the wild', EX: 'Extinct', DD: 'Data deficient', NE: 'Not evaluated' };
  const GROUP_VAR = { birds: 'var(--birds)', mammals: 'var(--mammals)', reptiles: 'var(--reptiles)', amphibians: 'var(--amphibians)', mushrooms: 'var(--mushrooms)', all: 'var(--brand)' };
  const GROUP_SINGULAR = { birds: 'Bird', mammals: 'Mammal', reptiles: 'Reptile', amphibians: 'Amphibian', mushrooms: 'Mushroom' };
  const BOOK_NAME = DATA.books;
  // Simple outline icons shown in place of a photo.
  const icon = (d) => `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${d}"/></svg>`;
  const GROUP_ICON = {
    birds: icon('M12 38c6-2 10-8 14-14 3-5 9-8 15-6 4 1 7 4 8 8l7 2-7 3c-1 8-8 15-18 16l-6 7-2-7c-5-1-9-4-11-9z M42 26h.1'),
    mammals: icon('M14 44c0-10 8-18 18-18h8l4-8 4 2-2 8c4 3 6 8 6 13v9h-6v-6H24v6h-6v-6c-2 0-4-1-4-0z M12 30c-3-1-4-4-3-7'),
    reptiles: icon('M8 40c6-6 12-6 18 0s12 6 18 0 10-6 14-2c2 2 2 5-1 6-3 1-5-2-8 0-6 6-12 6-18 0s-12-6-18 0z M52 38l4-2'),
    mushrooms: icon('M10 34c0-12 10-20 22-20s22 8 22 20z M26 34v14c0 3 3 5 6 5s6-2 6-5V34'),
    amphibians: icon('M20 30c0-7 5-12 12-12s12 5 12 12c0 3-1 5-3 7l6 9-5 2-6-7c-3 1-5 1-8 0l-6 7-5-2 6-9c-2-2-3-4-3-7z M26 24a2 2 0 1 0 .1 0 M38 24a2 2 0 1 0 .1 0'),
  };
  const TICK_SVG ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmt = (n) => (n ?? 0).toLocaleString();
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const pctLabel = (a, b) => { const p = pct(a, b); return (p > 0 && p < 1 ? p.toFixed(1) : Math.round(p)) + '%'; };
  const today = () => new Date().toISOString().slice(0, 10);
  // Photo hosts that send CORS headers are requested in CORS mode, so the
  // offline cache (sw.js) can store them efficiently.
  const corsAttr = (url) => (/^https:\/\/(inaturalist-open-data\.s3\.amazonaws\.com|upload\.wikimedia\.org)\//.test(url || '') ? ' crossorigin="anonymous"' : '');
  const photoSize = (url, size) => (url ? url.replace(/\/(square|small|medium|large|original)\./, `/${size}.`) : null);

  // ---------- data ----------
  const species = DATA.species;
  const byId = new Map(species.map((s) => [s.id, s]));
  const byInat = new Map(species.filter((s) => s.inat).map((s) => [s.inat, s]));
  species.forEach((s, i) => {
    s._i = i;
    s._q = fold([s.en, s.es, s.sci, s.family, s.familyEn, s.genusEn, s.order].join(' '));
  });
  // Extinct species stay listed but are left out of progress; unconfirmed ones
  // are counted unless "Confirmed only" is on.
  const genusOf = (s) => s.sci.split(' ')[0];
  const countable = (s) => !s.ext && !(s.u && ui.flags.has('confirmed'));
  const UNCONF_NOTE = {
    inat: 'Only unverified (needs-ID) iNaturalist observations from Costa Rica so far.',
    gbif: 'Known in Costa Rica only from GBIF records, such as museum specimens or survey data. It may be a rare visitor, a historical record, an outdated name or a misidentification.',
    lit: 'Published research suggests it occurs in Costa Rica, but the record is contested or not yet confirmed.',
    guide: 'In the field guide because it very likely occurs, but not yet recorded in Costa Rica.',
  };
  // Edible mushrooms: how Wikidata (from Wikipedia's mushroom infoboxes) rates them.
  const EDIBLE_TAG = { choice: 'Choice edible', edible: 'Edible', cooked: 'Edible when cooked', caution: 'Caution: conflicting reports' };
  function edibilityHtml(s) {
    const e = s.ed;
    const detail = {
      choice: 'Rated a choice (highly regarded) edible.',
      edible: 'Rated edible.',
      cooked: 'Rated edible only when cooked.',
      caution: `Rated edible, but also recorded as ${(e.warnings || []).join(' and ')}. Treat it as not safe to eat.`,
    }[e.c];
    return `<div class="d-sec"><h3>Edibility</h3>
      <p class="mushroom-warning"><b>Never eat a wild mushroom identified with this app.</b> Many edible species have deadly look-alikes, and edibility can vary by region, preparation and person. Only eat mushrooms an expert has identified in hand.</p>
      <p><span class="tag ed-${e.c}">${EDIBLE_TAG[e.c]}</span> ${esc(detail)}${e.cooked && e.c !== 'cooked' ? ' Some sources say to eat it only cooked.' : ''}${e.alsoInedible ? ' Some sources call it inedible (tough or bitter).' : ''}</p>
      <p class="muted">Edibility from <a href="https://www.wikidata.org/wiki/${esc(e.wikidata)}" target="_blank" rel="noopener">Wikidata</a>, which takes it from Wikipedia's mushroom pages.</p></div>`;
  }
  // Species not taken from a field guide account: why they are on the list.
  const ADD_TAG = { rg: 'Not in field guide', 'rg-hypothetical': 'Hypothetical in guide', research: 'Added from research' };

  // ---------- storage ----------
  const safeGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  let checklist = safeGet(STORE) || {};
  const saveChecklist = () => {
    if (!safeSet(STORE, checklist)) toast('Could not save — browser storage is unavailable. Export a backup!');
    queueCloudChanges();
  };

  const ui = Object.assign({ group: 'all', seen: 'all', family: '', genus: '', sort: 'tax', view: 'grid', flags: [] }, safeGet(UI_STORE) || {});
  ui.flags = new Set(ui.flags);
  ui.q = '';
  const saveUi = () => safeSet(UI_STORE, { ...ui, flags: [...ui.flags], q: undefined });

  const isSeen = (s) => !!checklist[s.id];
  function setSeen(s, on, extra = {}) {
    if (on) checklist[s.id] = { d: today(), n: '', src: 'manual', t: Date.now(), ...(checklist[s.id] || {}), ...extra };
    else delete checklist[s.id];
    saveChecklist();
    refreshItem(s);
    renderProgress();
  }

  // ---------- progress ----------
  function tally(group) {
    const list = species.filter((s) => countable(s) && (group === 'all' || s.g === group));
    return { total: list.length, seen: list.filter(isSeen).length };
  }
  function renderProgress() {
    const all = tally('all');
    $('.overall-head .label').textContent = ui.flags.has('confirmed') ? 'Confirmed species seen' : 'Species seen';
    $('#ovSeen').textContent = fmt(all.seen);
    $('#ovTotal').textContent = fmt(all.total);
    $('#ovPct').textContent = pctLabel(all.seen, all.total);
    $('#ovBar').style.width = pct(all.seen, all.total) + '%';
    $('#ovBarWrap').setAttribute('aria-valuenow', Math.round(pct(all.seen, all.total)));
    const tabs = [{ key: 'all', label: 'All groups' }, ...DATA.groups];
    $('#groupTabs').innerHTML = tabs.map((g) => {
      const t = tally(g.key);
      return `<button class="gtab ${ui.group === g.key ? 'on' : ''}" data-group="${g.key}" style="--bar:${GROUP_VAR[g.key]}" aria-pressed="${ui.group === g.key}">
        <span class="t"><span>${esc(g.label)}</span><span class="p">${pctLabel(t.seen, t.total)}</span></span>
        <span class="bar"><span style="width:${pct(t.seen, t.total)}%"></span></span>
        <span class="n">${fmt(t.seen)} of ${fmt(t.total)} seen</span>
      </button>`;
    }).join('');
  }

  // ---------- filtering ----------
  function filtered() {
    const words = fold(ui.q).split(/\s+/).filter(Boolean);
    let list = species.filter((s) => {
      if (ui.group !== 'all' && s.g !== ui.group) return false;
      if (ui.seen === 'seen' && !isSeen(s)) return false;
      if (ui.seen === 'unseen' && isSeen(s)) return false;
      if (ui.family && s.family !== ui.family) return false;
      if (ui.genus && genusOf(s) !== ui.genus) return false;
      if (ui.flags.has('endemic') && s.est !== 'endemic') return false;
      if (ui.flags.has('threat') && !THREAT.has(s.iucn)) return false;
      if (ui.flags.has('book') && !s.books.length) return false;
      if (ui.flags.has('native') && s.est === 'introduced') return false;
      if (ui.flags.has('confirmed') && s.u) return false;
      return words.every((w) => s._q.includes(w));
    });
    const name = (s) => (s.en || s.sci).toLowerCase();
    const sorters = {
      tax: (a, b) => a._i - b._i,
      family: (a, b) => (a.family || '~').localeCompare(b.family || '~') || a.g.localeCompare(b.g) || a._i - b._i,
      name: (a, b) => name(a).localeCompare(name(b)),
      sci: (a, b) => a.sci.localeCompare(b.sci),
      obs: (a, b) => b.obs - a.obs || b.gbifN - a.gbifN,
      rare: (a, b) => a.obs - b.obs || a.gbifN - b.gbifN,
      recent: (a, b) => (checklist[b.id]?.t || 0) - (checklist[a.id]?.t || 0) || a._i - b._i,
    };
    return list.sort(sorters[ui.sort] || sorters.tax);
  }

  function renderFamilies() {
    const fams = new Map();
    species.filter((s) => ui.group === 'all' || s.g === ui.group).forEach((s) => {
      if (!s.family) return;
      const f = fams.get(s.family) || { en: s.familyEn, n: 0, i: s._i };
      f.n++; fams.set(s.family, f);
    });
    if (ui.family && !fams.has(ui.family)) ui.family = '';
    $('#family').innerHTML = '<option value="">All families</option>' + [...fams.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fam, f]) => `<option value="${esc(fam)}" ${fam === ui.family ? 'selected' : ''}>${esc(fam)}${f.en ? ' — ' + esc(f.en) : ''} (${f.n})</option>`).join('');
    renderGenera();
  }
  // The genus picker lists the genera of the chosen family.
  function renderGenera() {
    const sel = $('#genus');
    const genera = new Map();
    if (ui.family) species.filter((s) => s.family === ui.family && (ui.group === 'all' || s.g === ui.group)).forEach((s) => {
      const g = genera.get(genusOf(s)) || { en: s.genusEn, n: 0 };
      g.n++; genera.set(genusOf(s), g);
    });
    if (ui.genus && !genera.has(ui.genus)) ui.genus = '';
    sel.hidden = genera.size < 2;
    sel.innerHTML = `<option value="">All genera (${genera.size})</option>` + [...genera.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, v]) => `<option value="${esc(g)}" ${g === ui.genus ? 'selected' : ''}>${esc(g)}${v.en ? ' — ' + esc(v.en) : ''} (${v.n})</option>`).join('');
  }

  // ---------- results ----------
  let current = [];
  let shown = 0;
  function tags(s) {
    const t = [];
    if (s.ext) t.push('<span class="tag ext">Extinct</span>');
    if (s.u) t.push(`<span class="tag unconf" title="${esc(UNCONF_NOTE[s.u])}">Unconfirmed</span>`);
    if (s.ed) t.push(`<span class="tag ed-${s.ed.c}">${EDIBLE_TAG[s.ed.c]}</span>`);
    if (s.add) t.push(`<span class="tag added" title="${esc(s.note || '')}">${ADD_TAG[s.add]}</span>`);
    if (s.est === 'endemic') t.push('<span class="tag end">Endemic</span>');
    if (s.est === 'introduced') t.push('<span class="tag intro">Introduced</span>');
    if (s.iucn && !['LC', 'NE', 'DD'].includes(s.iucn)) t.push(`<span class="tag iucn-${s.iucn}" title="${IUCN_LABEL[s.iucn] || ''}">${s.iucn}</span>`);
    return t.join('');
  }
  function cardHtml(s) {
    const img = photoSize(s.photo, 'medium');
    return `<div class="card ${isSeen(s) ? 'seen' : ''}" data-id="${s.id}" tabindex="0">
      <div class="ph">${img ? `<img loading="lazy" src="${esc(img)}"${corsAttr(img)} alt="">` : `<span class="noimg">${GROUP_ICON[s.g]}<span>No public photo</span></span>`}${s.photoKind === 'specimen' ? '<span class="ph-kind">Museum specimen</span>' : ''}</div>
      <button class="tick" data-tick aria-pressed="${isSeen(s)}" aria-label="${isSeen(s) ? 'Unmark' : 'Mark'} ${esc(s.en || s.sci)} as seen">${TICK_SVG}</button>
      <div class="meta">
        <span class="en">${esc(s.en || s.sci)}</span>
        ${s.en ? `<span class="sn">${esc(s.sci)}</span>` : ''}
        <span class="fam">${esc(s.familyEn || s.family || '')}</span>
        <div class="tags">${tags(s)}</div>
      </div>
    </div>`;
  }
  function rowHtml(s) {
    const img = photoSize(s.photo, 'square');
    return `<div class="row ${isSeen(s) ? 'seen' : ''}" data-id="${s.id}" tabindex="0">
      <button class="box" data-tick aria-pressed="${isSeen(s)}" aria-label="${isSeen(s) ? 'Unmark' : 'Mark'} ${esc(s.en || s.sci)} as seen">${TICK_SVG}</button>
      ${img ? `<img loading="lazy" src="${esc(img)}"${corsAttr(img)} alt="">` : `<span class="noimg">${GROUP_ICON[s.g]}</span>`}
      <div class="names"><span class="en">${esc(s.en || s.sci)}</span>${s.en ? `<span class="sn">${esc(s.sci)}</span>` : ''} ${tags(s)}</div>
      <div class="right">${checklist[s.id]?.d ? `<span>seen ${esc(checklist[s.id].d)}</span>` : ''}<span title="iNaturalist observations in Costa Rica">${fmt(s.obs)} obs</span></div>
    </div>`;
  }
  // Taxonomic and family sorts show each family under its own header and each
  // genus under a sub-header, in both views.
  const byFamily = () => ui.sort === 'tax' || ui.sort === 'family';
  const famKey = (s) => `${s.g}:${s.family || ''}`;
  const genusKey = (s) => `${famKey(s)}:${genusOf(s)}`;
  function groupHead(s, level) {
    const keyOf = level === 'family' ? famKey : genusKey;
    const members = species.filter((x) => keyOf(x) === keyOf(s) && countable(x));
    const seenN = members.filter(isSeen).length;
    const title = level === 'family'
      ? `<b>${esc(s.family || 'Unplaced')}</b>${s.familyEn ? `<span>${esc(s.familyEn)}</span>` : ''}`
      : `<b><i>${esc(genusOf(s))}</i></b>${s.genusEn ? `<span class="en-name" title="${esc(s.genusEn)}">${esc(s.genusEn)}</span>` : ''}`;
    return `<div class="${level === 'family' ? 'fam-head' : 'genus-head'}" data-head="${esc(keyOf(s))}" style="--bar:${GROUP_VAR[s.g]}">${title}
      <span class="fam-count">${seenN} / ${members.length}</span>
      <span class="bar fam-bar"><span style="width:${pct(seenN, members.length)}%"></span></span></div>`;
  }

  function render() {
    current = filtered();
    shown = 0;
    const box = $('#results');
    box.className = ui.view === 'list' ? 'list' : byFamily() ? 'grid grouped' : 'grid';
    box.innerHTML = current.length ? '' : '<div class="empty">No species match these filters.</div>';
    genusCards = null;
    const seenN = current.filter(isSeen).length;
    $('#resultCount').textContent = `${fmt(current.length)} species · ${fmt(seenN)} seen` + (ui.q ? ` · matching “${ui.q}”` : '');
    more();
  }
  function more() {
    if (shown >= current.length) return;
    const slice = current.slice(shown, shown + PAGE);
    const box = $('#results');
    if (ui.view === 'grid' && byFamily()) {
      // Each genus is a compact block of cards, so small genera share a row.
      // A genus can continue into the next page, so keep its card container.
      slice.forEach((s, k) => {
        const prev = current[shown + k - 1];
        if (!prev || famKey(prev) !== famKey(s)) box.insertAdjacentHTML('beforeend', groupHead(s, 'family'));
        if (!prev || genusKey(prev) !== genusKey(s) || !genusCards) {
          box.insertAdjacentHTML('beforeend', `<section class="gblock">${groupHead(s, 'genus')}<div class="gcards"></div></section>`);
          genusCards = box.lastElementChild.querySelector('.gcards');
        }
        genusCards.insertAdjacentHTML('beforeend', cardHtml(s));
      });
    } else {
      let html = '';
      slice.forEach((s, k) => {
        const prev = current[shown + k - 1];
        if (byFamily()) {
          if (!prev || famKey(prev) !== famKey(s)) html += groupHead(s, 'family');
          if (!prev || genusKey(prev) !== genusKey(s)) html += groupHead(s, 'genus');
        }
        html += ui.view === 'list' ? rowHtml(s) : cardHtml(s);
      });
      box.insertAdjacentHTML('beforeend', html);
    }
    shown += slice.length;
  }
  let genusCards = null;
  new IntersectionObserver((e) => { if (e[0].isIntersecting) more(); }, { rootMargin: '800px' }).observe($('#sentinel'));

  function refreshItem(s) {
    $$(`[data-id="${CSS.escape(s.id)}"]`).forEach((el) => {
      el.classList.toggle('seen', isSeen(s));
      const b = $('[data-tick]', el);
      if (b) { b.setAttribute('aria-pressed', isSeen(s)); b.setAttribute('aria-label', `${isSeen(s) ? 'Unmark' : 'Mark'} ${s.en || s.sci} as seen`); }
      const right = $('.right', el);
      if (right) right.innerHTML = `${checklist[s.id]?.d ? `<span>seen ${esc(checklist[s.id].d)}</span>` : ''}<span>${fmt(s.obs)} obs</span>`;
    });
    if (byFamily()) {
      for (const [level, key] of [['family', famKey(s)], ['genus', genusKey(s)]]) {
        const head = $(`[data-head="${CSS.escape(key)}"]`);
        if (head) head.outerHTML = groupHead(s, level);
      }
    }
    const seenN = current.filter(isSeen).length;
    $('#resultCount').textContent = `${fmt(current.length)} species · ${fmt(seenN)} seen` + (ui.q ? ` · matching “${ui.q}”` : '');
    if (openId === s.id) renderSeenBox(s);
  }

  // ---------- events: list ----------
  $('#results').addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const s = byId.get(item.dataset.id);
    if (e.target.closest('[data-tick]')) { e.stopPropagation(); setSeen(s, !isSeen(s)); return; }
    location.hash = '#/species/' + encodeURIComponent(s.id);
  });
  $('#results').addEventListener('keydown', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item || e.target.closest('button')) return;
    if (e.key === 'Enter') location.hash = '#/species/' + encodeURIComponent(item.dataset.id);
    if (e.key === ' ') { e.preventDefault(); const s = byId.get(item.dataset.id); setSeen(s, !isSeen(s)); }
  });
  $('#groupTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    ui.group = b.dataset.group; ui.family = '';
    saveUi(); renderProgress(); renderFamilies(); render();
  });
  let qTimer;
  $('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = e.target.value.trim(); render(); }, 120); });
  $$('[data-seen]').forEach((b) => b.addEventListener('click', () => {
    ui.seen = b.dataset.seen; $$('[data-seen]').forEach((x) => x.classList.toggle('on', x === b)); saveUi(); render();
  }));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    ui.view = b.dataset.view; $$('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); saveUi(); render();
  }));
  $$('[data-flag]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.flag;
    ui.flags.has(f) ? ui.flags.delete(f) : ui.flags.add(f);
    b.classList.toggle('on', ui.flags.has(f)); saveUi(); render();
    if (f === 'confirmed') renderProgress();
  }));
  $('#family').addEventListener('change', (e) => { ui.family = e.target.value; ui.genus = ''; renderGenera(); saveUi(); render(); });
  $('#genus').addEventListener('change', (e) => { ui.genus = e.target.value; saveUi(); render(); });
  $('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; saveUi(); render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); }
    if (e.key === 'Escape' && openId) closeDetail();
  });

  // ---------- detail ----------
  let openId = null;
  let map = null;
  let crOutline = null;
  let detailAbort = null;

  function closeDetail() {
    if (location.hash.startsWith('#/species/')) history.pushState('', document.title, location.pathname + location.search);
    hideDetail();
  }
  function hideDetail() {
    openId = null;
    $('#detail').hidden = true;
    document.body.style.overflow = '';
    if (map) { map.remove(); map = null; }
    if (detailAbort) detailAbort.abort();
  }
  $('#detail').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDetail(); });
  window.addEventListener('hashchange', route);
  function route() {
    const m = location.hash.match(/^#\/species\/(.+)$/);
    const s = m && byId.get(decodeURIComponent(m[1]));
    if (s) openDetail(s); else if (openId) hideDetail();
  }

  function renderSeenBox(s) {
    const box = $('#seenBox');
    if (!box) return;
    const c = checklist[s.id];
    box.innerHTML = `
      <button class="seen-btn ${c ? 'on' : ''}" id="seenBtn" aria-pressed="${!!c}">${TICK_SVG}${c ? 'Seen' : 'Mark as seen'}</button>
      ${c ? `<div class="seen-fields">
        <input type="date" id="seenDate" value="${esc(c.d || '')}" aria-label="Date seen">
        <input type="text" id="seenNote" value="${esc(c.n || '')}" placeholder="Where / notes" aria-label="Notes">
      </div>${c.src === 'inat' ? '<span class="muted">Imported from your iNaturalist observations.</span>' : ''}` : ''}`;
    $('#seenBtn').onclick = () => setSeen(s, !isSeen(s));
    const d = $('#seenDate'), n = $('#seenNote');
    if (d) d.onchange = () => { checklist[s.id].d = d.value; saveChecklist(); refreshItem(s); };
    if (n) n.oninput = () => { checklist[s.id].n = n.value; saveChecklist(); };
  }

  function elevationBar(e) {
    const top = 3820; // Cerro Chirripó
    const lo = e[0] ?? 0, hi = e[1] ?? top;
    return `<div class="elev">
        <div class="elev-bar" title="${fmt(lo)}–${fmt(hi)} m"><span style="left:${(lo / top) * 100}%;width:${Math.max(1.2, ((Math.min(hi, top) - lo) / top) * 100)}%"></span></div>
        <div class="elev-scale"><span>Sea level</span><span>1,000 m</span><span>2,000 m</span><span>3,000 m</span><span>Chirripó 3,820 m</span></div>
      </div>`;
  }

  // Facts from the user's field guides (extracted at build time; no book text).
  const VENOMOUS_FAMILIES = new Set(['Viperidae', 'Elapidae']);
  function factsHtml(s) {
    const f = s.facts || {};
    const e = s.books.find((b) => b.elev)?.elev;
    const rows = [
      ['Size', f.size], ['Wingspan', f.wingspan], ['Weight', f.weight],
      ['Abundance', f.abundance], ['Season in Costa Rica', f.season], ['Where in Costa Rica', f.regions?.join(', ')],
      ['Elevation', e ? (e[0] != null && e[0] === e[1] ? `${fmt(e[0])} m` : `${e[0] == null ? '?' : fmt(e[0])}–${e[1] == null ? '?' : fmt(e[1])} m`) : null],
      ['Habitat', f.habitat?.join(', ')], ['Activity', f.activity?.join(', ')], ['Diet', f.diet?.join(', ')],
      ['World range', f.worldRange],
    ].filter(([, v]) => v);
    const venom = VENOMOUS_FAMILIES.has(s.family) ? '<p class="venom"><b>Dangerously venomous.</b> Keep your distance and never handle it.</p>' : '';
    const sources = s.books.length ? `<p class="muted source-line">From ${s.books.map((b) => `${esc(BOOK_NAME[b.b])}${b.p ? `, p. ${b.p}` : ''}${b.pdf ? ` (PDF p. ${b.pdf})` : ''}`).join('; ')}</p>` : '';
    if (!rows.length && !venom) {
      return `<div class="d-sec"><h3>Field guide facts</h3><p class="muted">${s.books.length ? 'No structured facts could be read from the guide for this species.' : 'Not covered in your field guides.'}</p>${sources}</div>`;
    }
    return `<div class="d-sec"><h3>Field guide facts</h3>${venom}
      ${rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${e ? elevationBar(e) : ''}${sources}</div>`;
  }

  function openDetail(s) {
    if (map) { map.remove(); map = null; }
    if (detailAbort) detailAbort.abort();
    detailAbort = new AbortController();
    openId = s.id;
    const color = GROUP_VAR[s.g];
    const groupLabel = DATA.groups.find((g) => g.key === s.g)?.label || '';
    const big = photoSize(s.photo, 'large');
    const inatLink = s.inat ? `https://www.inaturalist.org/taxa/${s.inat}` : `https://www.inaturalist.org/search?q=${encodeURIComponent(s.sci)}`;
    const iucn = s.iucn ? `<span class="tag iucn-${s.iucn}">IUCN: ${IUCN_LABEL[s.iucn] || s.iucn}</span>` : '';
    const est = s.est ? `<span class="tag ${s.est === 'endemic' ? 'end' : s.est === 'introduced' ? 'intro' : ''}">${esc(s.est[0].toUpperCase() + s.est.slice(1))} in Costa Rica</span>` : '';

    $('#detailBody').innerHTML = `
      <div class="d-hero" style="--bar:${color}">
        <figure class="d-photo" style="margin:0">${big ? `<img src="${esc(big)}"${corsAttr(big)} alt="${esc(s.en || s.sci)}"><figcaption>${s.photoKind === 'specimen' ? 'Museum specimen · ' : ''}${esc(s.attr || '')}${s.photoLink ? ` · <a href="${esc(s.photoLink)}" target="_blank" rel="noopener">source</a>` : ''}${s.seeLink ? ` · <a href="${esc(s.seeLink.url)}" target="_blank" rel="noopener">${esc(s.seeLink.label)}</a>` : ''}</figcaption>` : `<div class="muted" style="padding:40px">No public photo found yet${s.seeLink ? `<br><a href="${esc(s.seeLink.url)}" target="_blank" rel="noopener">${esc(s.seeLink.label)}</a>` : ''}</div>`}</figure>
        <div class="d-head">
          <span class="grp">${esc(groupLabel)}</span>
          <h2 id="dTitle">${esc(s.en || s.sci)}</h2>
          ${s.en ? `<span class="sn"><i>${esc(s.sci)}</i></span>` : ''}
          ${s.es ? `<span class="es">Español: ${esc(s.es)}</span>` : ''}
          <span class="tax">${[s.order, s.family && `${s.family}${s.familyEn ? ' (' + s.familyEn + ')' : ''}`].filter(Boolean).map(esc).join(' › ')}</span>
          <div class="tags">${s.ext ? '<span class="tag ext">Extinct</span>' : ''}${s.u ? '<span class="tag unconf">Unconfirmed</span>' : ''}${s.ed ? `<span class="tag ed-${s.ed.c}">${EDIBLE_TAG[s.ed.c]}</span>` : ''}${s.add ? `<span class="tag added">${ADD_TAG[s.add]}</span>` : ''}${est}${iucn}${s.list ? '<span class="tag">On iNat Costa Rica checklist</span>' : ''}</div>
          ${s.u ? `<p class="unconf-note">${esc(UNCONF_NOTE[s.u])}</p>` : ''}
          ${s.note ? `<p class="list-note">${esc(s.note)}${s.ref ? ` <a href="${esc(s.ref.url)}" target="_blank" rel="noopener">${esc(s.ref.authors)}</a>` : ''}</p>` : ''}
          <div class="seen-box" id="seenBox"></div>
          <button class="btn ask-btn server-only" id="askAbout">Ask: where &amp; when to see it</button>
        </div>
      </div>
      <div class="d-sec">
        <div class="stats">
          <div class="stat"><b>${fmt(s.obs)}</b><span>iNat observations in CR</span></div>
          <div class="stat"><b>${fmt(s.rg)}</b><span>research grade</span></div>
          <div class="stat"><b>${fmt(s.gbifN)}</b><span>GBIF records in CR</span></div>
          <div class="stat"><b id="worldObs">…</b><span>iNat observations worldwide</span></div>
        </div>
      </div>
      <div class="d-sec server-only"><h3>Field guide summary</h3><div id="summaryBody"><span class="muted">Checking…</span></div></div>
      ${s.ed ? edibilityHtml(s) : factsHtml(s)}
      <div class="d-sec"><h3>Description</h3><div id="descBody" class="prose"><span class="muted">Loading…</span></div></div>
      <div class="d-sec"><h3>When &amp; where to look</h3><div id="whenWhere"><span class="muted">Loading…</span></div></div>
      <div class="d-sec">
        <h3>Range &amp; records</h3>
        <div class="layers" id="layerBtns"></div>
        <div class="map-wrap"><div id="map"></div></div>
        <p class="map-note" id="mapNote">Loading map layers…</p>
      </div>
      <div class="d-sec"><h3>Research</h3><div id="papers"><span class="muted">Loading…</span></div></div>
      <div class="d-sec"><h3>Recent photos from Costa Rica</h3><div class="obs-grid" id="recentObs"><span class="muted">Loading…</span></div></div>
      <div class="d-sec"><h3>Links</h3><div class="links">
        <a href="${inatLink}" target="_blank" rel="noopener">iNaturalist taxon</a>
        ${s.inat ? `<a href="https://www.inaturalist.org/observations?taxon_id=${s.inat}&place_id=${PLACE}" target="_blank" rel="noopener">iNat observations in CR</a>` : ''}
        ${s.gbif ? `<a href="https://www.gbif.org/species/${s.gbif}" target="_blank" rel="noopener">GBIF species</a>
        <a href="https://www.gbif.org/occurrence/search?taxon_key=${s.gbif}&country=CR" target="_blank" rel="noopener">GBIF records in CR</a>` : ''}
        ${s.wiki ? `<a href="${esc(s.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
        ${s.g === 'birds' ? `<a href="https://xeno-canto.org/species/${encodeURIComponent(s.sci.replace(' ', '-'))}" target="_blank" rel="noopener">Calls on xeno-canto</a>` : ''}
        ${s.g === 'amphibians' ? `<a href="https://amphibiaweb.org/cgi/amphib_query?where-scientific_name=${encodeURIComponent(s.sci)}&rel-scientific_name=equals" target="_blank" rel="noopener">AmphibiaWeb</a>` : ''}
        ${s.g === 'reptiles' ? `<a href="https://reptile-database.reptarium.cz/species?genus=${encodeURIComponent(s.sci.split(' ')[0])}&species=${encodeURIComponent(s.sci.split(' ')[1] || '')}" target="_blank" rel="noopener">Reptile Database</a>` : ''}
        <a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`"${s.sci}"`)}" target="_blank" rel="noopener">Image search</a>
      </div></div>`;
    renderSeenBox(s);
    $('#askAbout').onclick = () => {
      openChat();
      askChat(`What's the best place and time to see the ${s.en || s.sci} (${s.sci}) in Costa Rica?`, s.id);
    };
    $('#detail').hidden = false;
    document.body.style.overflow = 'hidden';
    $('.detail-card').scrollTop = 0;
    setTimeout(() => buildMap(s, detailAbort.signal), 30);
    const signal = detailAbort.signal;
    loadRecent(s, signal);
    loadAbout(s, signal);
    if (hasServer) loadSummary(s, signal);
    loadDescription(s, signal);
    loadWhenWhere(s, signal);
    loadPapers(s, signal);
  }

  async function getJson(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function buildMap(s, signal) {
    if (openId !== s.id || typeof L === 'undefined') { $('#mapNote').textContent = 'Map library failed to load (offline?).'; return; }
    map = L.map('map', { worldCopyJump: true, zoomSnap: 0.5 }).setView([9.75, -84.2], 7);
    const bases = {
      Map: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap contributors' }),
      Topographic: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, attribution: 'Tiles © Esri' }),
      Terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, crossOrigin: true, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)' }),
      Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, attribution: 'Imagery © Esri' }),
    };
    bases.Map.addTo(map);
    L.control.layers(bases, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    // iNat and GBIF serve 512px tiles on the standard z/x/y grid.
    const t512 = (url, o = {}) => L.tileLayer(url, { tileSize: 512, zoomOffset: -1, minZoom: 1, maxZoom: 19, crossOrigin: true, ...o });
    let info = { ranges: false, geomodel: false, gbif_id: s.gbif };
    if (s.inat) {
      try { info = { ...info, ...(await getJson(`${INAT}/taxa/${s.inat}/map_layers`, signal)) }; } catch (e) { if (signal.aborted) return; }
    }
    if (signal.aborted || !map) return;
    const gbifKey = info.gbif_id || s.gbif;
    const defs = [
      { key: 'range', label: 'Known range', sw: '#e0457b', avail: info.ranges, on: true,
        make: () => t512(`${INAT}/taxon_ranges/${s.inat}/{z}/{x}/{y}.png`, { opacity: 0.8, attribution: 'Range: iNaturalist' }) },
      { key: 'geomodel', label: 'Expected range (iNat model)', sw: '#8f6bd8', avail: info.geomodel, on: !info.ranges,
        make: () => t512(`${INAT}/geomodel/${s.inat}/{z}/{x}/{y}.png`, { opacity: 0.6, attribution: 'Geomodel: iNaturalist' }) },
      { key: 'inat', label: 'iNat observations', sw: '#ff5a1f', avail: !!s.inat, on: true,
        make: () => L.layerGroup([
          t512(`${INAT}/grid/{z}/{x}/{y}.png?taxon_id=${s.inat}&verifiable=true&color=%23ff5a1f`, { maxZoom: 9, attribution: 'Observations: iNaturalist' }),
          t512(`${INAT}/points/{z}/{x}/{y}.png?taxon_id=${s.inat}&verifiable=true&color=%23ff5a1f`, { minZoom: 9.5 }),
        ]) },
      { key: 'gbif', label: 'GBIF records', sw: '#3d6fd9', avail: !!gbifKey, on: true,
        make: () => t512(`https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=${gbifKey}&style=blueHeat.point&srs=EPSG:3857`, { opacity: 0.85, attribution: 'Records: GBIF.org' }) },
    ];
    const layers = {};
    $('#layerBtns').innerHTML = defs.map((d) => `<button class="layer" data-layer="${d.key}" style="--sw:${d.sw}" ${d.avail ? '' : 'disabled title="Not available for this species"'}><i></i>${d.label}</button>`).join('');
    defs.forEach((d) => {
      if (!d.avail) return;
      layers[d.key] = d.make();
      const btn = $(`[data-layer="${d.key}"]`);
      const set = (on) => { on ? layers[d.key].addTo(map) : map.removeLayer(layers[d.key]); btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); };
      set(d.on);
      btn.onclick = () => set(!map.hasLayer(layers[d.key]));
    });
    const notes = [];
    if (!info.ranges) notes.push('No published range map on iNaturalist for this species');
    if (info.ranges) notes.push('Known range from iNaturalist (often IUCN-derived)');
    notes.push('orange = iNaturalist research/needs-ID observations, blue = GBIF occurrence records (all datasets, incl. eBird and museum specimens)');
    $('#mapNote').textContent = notes.join(' · ') + '.';
    drawOutline(signal);
    map.invalidateSize();
  }

  async function drawOutline(signal) {
    try {
      if (!crOutline) {
        const r = await getJson(`${INAT}/places/${PLACE}`, signal);
        crOutline = r.results[0].geometry_geojson;
      }
      if (map && !signal.aborted) L.geoJSON(crOutline, { style: { color: '#1f5f22', weight: 1.5, fill: false, dashArray: '5 4', opacity: 0.8 }, interactive: false }).addTo(map);
    } catch { /* outline is decorative */ }
  }

  async function loadRecent(s, signal) {
    const box = $('#recentObs');
    if (!s.inat) { box.innerHTML = '<span class="muted">This species has no iNaturalist taxon.</span>'; $('#worldObs').textContent = '–'; return; }
    try {
      const r = await getJson(`${INAT}/observations?taxon_id=${s.inat}&place_id=${PLACE}&photos=true&verifiable=true&order_by=observed_on&order=desc&per_page=12&locale=en`, signal);
      if (signal.aborted) return;
      box.innerHTML = r.results.length ? r.results.map((o) => {
        const p = o.photos?.[0]?.url;
        return `<a class="obs" href="https://www.inaturalist.org/observations/${o.id}" target="_blank" rel="noopener" title="${esc(o.place_guess || '')}">
          ${p ? `<img loading="lazy" src="${esc(photoSize(p, 'small'))}"${corsAttr(p)} alt="">` : ''}
          <span>${esc(o.observed_on || '')} · ${esc(o.place_guess || 'Costa Rica')}</span></a>`;
      }).join('') : '<span class="muted">No photographed observations from Costa Rica yet — yours could be the first!</span>';
    } catch (e) { if (!signal.aborted) box.innerHTML = '<span class="muted">Could not load observations (offline?).</span>'; }
  }

  async function loadAbout(s, signal) {
    if (!s.inat) { $('#worldObs').textContent = '–'; return; }
    try {
      const r = await getJson(`${INAT}/taxa/${s.inat}?locale=en`, signal);
      if (!signal.aborted) $('#worldObs').textContent = fmt(r.results[0].observations_count);
    } catch { if (!signal.aborted) $('#worldObs').textContent = '–'; }
  }

  // ---------- description (Wikipedia, English then Spanish) ----------
  const WIKI_SECTIONS = /descri|appearance|identif|morpholog|distribu|habitat|range|behaviou?r|ecolog|diet|feeding|food|breed|reproduc|life ?(cycle|history)|vocal|call|song|status|conserv|threat|tox|venom|comportamiento|alimentaci|dieta|reproducci|estado|amenaza/i;
  function wikiParagraphs(text, max) {
    let used = 0;
    const out = [];
    for (const raw of text.split(/\n+/)) {
      const p = raw.trim();
      if (!p || used >= max) continue;
      if (p.startsWith('§')) { out.push(`<h5>${esc(p.slice(1))}</h5>`); continue; }
      const cut = p.length + used > max ? p.slice(0, Math.max(0, max - used)).replace(/\s+\S*$/, '') + '…' : p;
      out.push(`<p>${esc(cut)}</p>`);
      used += cut.length;
    }
    return out.join('');
  }
  async function loadDescription(s, signal) {
    const box = $('#descBody');
    const article = async (lang, title) => {
      if (!title) return null;
      const r = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`, signal);
      const page = Object.values(r.query?.pages || {})[0];
      return page && page.extract && !('missing' in page) ? { lang, title: page.title, text: page.extract } : null;
    };
    try {
      const enTitle = s.wiki ? decodeURIComponent(s.wiki.split('/wiki/')[1] || '').replace(/_/g, ' ') : null;
      const w = await article('en', enTitle) || await article('en', s.sci) || await article('es', s.sci);
      if (signal.aborted) return;
      if (!w) { box.innerHTML = '<p class="muted">No Wikipedia article for this species yet.</p>'; return; }
      const parts = w.text.split(/\n(={2,4}) *(.+?) *\1\n/);
      const sections = [];
      for (let i = 1; i < parts.length; i += 3) {
        const level = parts[i].length, heading = parts[i + 1], body = (parts[i + 2] || '').trim();
        if (level === 2) sections.push({ heading, body });
        else if (sections.length) sections[sections.length - 1].body += `\n§${heading}\n${body}`;
      }
      const url = `https://${w.lang}.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, '_'))}`;
      box.innerHTML = wikiParagraphs(parts[0], 1400)
        + sections.filter((x) => WIKI_SECTIONS.test(x.heading) && x.body.replace(/§.*\n/g, '').trim())
          .map((x) => `<details><summary>${esc(x.heading)}</summary>${wikiParagraphs(x.body, 2600)}</details>`).join('')
        + `<p class="muted source-line">Text from <a href="${esc(url)}" target="_blank" rel="noopener">Wikipedia${w.lang === 'es' ? ' (español)' : ''}</a>, CC BY-SA 4.0.</p>`;
    } catch { if (!signal.aborted) box.innerHTML = '<p class="muted">Could not load the description (offline?).</p>'; }
  }

  // ---------- when & where (iNaturalist months, GBIF sites) ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const VAGUE_LOCALITY = /^(costa rica|cr|san jos[eé]|alajuela|cartago|heredia|guanacaste|puntarenas|lim[oó]n)(,.*)?$/i;
  const groupMonths = {};
  async function monthCounts(taxon, signal) {
    const r = await getJson(`${INAT}/observations/histogram?taxon_id=${taxon}&place_id=${PLACE}&interval=month_of_year&date_field=observed&verifiable=true`, signal);
    return MONTHS.map((_, i) => r.results.month_of_year[i + 1] || 0);
  }
  async function loadWhenWhere(s, signal) {
    const box = $('#whenWhere');
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    let html = '';
    try {
      let counts = null, index = null, note = '';
      if (s.inat && s.obs > 0) {
        const groupTaxon = DATA.groups.find((g) => g.key === s.g).inat;
        groupMonths[groupTaxon] ??= monthCounts(groupTaxon, signal).catch((e) => { delete groupMonths[groupTaxon]; throw e; });
        const [own, group] = await Promise.all([monthCounts(s.inat, signal), groupMonths[groupTaxon]]);
        const total = sum(own), groupTotal = sum(group);
        counts = own;
        // Adjust for observer activity: share of this species' records over the group's share that month.
        index = own.map((n, i) => (total && group[i] ? (n / total) / (group[i] / groupTotal) : 0));
        note = `Based on ${fmt(total)} iNaturalist observations, adjusted for how many people record ${(DATA.groups.find((g) => g.key === s.g).label).toLowerCase()} each month.`;
      } else if (s.gbif) {
        const r = await getJson(`https://api.gbif.org/v1/occurrence/search?country=CR&taxonKey=${s.gbif}&basisOfRecord=HUMAN_OBSERVATION&limit=0&facet=month&facetLimit=12`, signal);
        const byMonth = Object.fromEntries((r.facets[0]?.counts || []).map((c) => [Number(c.name), c.count]));
        counts = index = MONTHS.map((_, i) => byMonth[i + 1] || 0);
        note = `Based on ${fmt(sum(counts))} GBIF field records.`;
      }
      if (counts && sum(counts) >= 5) {
        const max = Math.max(...index);
        const peak = index.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => i).sort((a, b) => a - b);
        html += `<div class="months" role="img" aria-label="Relative sightings by month">${MONTHS.map((m, i) =>
          `<div class="mbar ${peak.includes(i) ? 'peak' : ''}" title="${MONTH_NAMES[i]}: ${fmt(counts[i])} records"><span style="height:${max ? Math.max(2, (index[i] / max) * 100) : 0}%"></span><i>${m[0]}</i></div>`).join('')}</div>
          <p class="when-line">Best months: <b>${peak.map((i) => MONTH_NAMES[i]).join(', ')}</b></p><p class="muted">${note}</p>`;
      }
      if (s.gbif) {
        const r = await getJson(`https://api.gbif.org/v1/occurrence/search?country=CR&taxonKey=${s.gbif}&basisOfRecord=HUMAN_OBSERVATION&basisOfRecord=MACHINE_OBSERVATION&limit=0&facet=locality&facetLimit=30`, signal);
        // Skip country/province-only names and bare dataset codes such as "CG-BOR".
        const sites = (r.facets[0]?.counts || []).filter((c) => !VAGUE_LOCALITY.test(c.name.trim()) && /[a-z]/.test(c.name)).slice(0, 6);
        if (sites.length) {
          html += `<h4 class="sub">Top sites by records</h4><ol class="sites">${sites.map((c) => `<li><span>${esc(c.name)}</span><b>${fmt(c.count)}</b></li>`).join('')}</ol>
            <p class="muted">Field records on GBIF (mostly eBird and iNaturalist). Well-visited sites are over-represented.</p>`;
        }
      }
      if (!signal.aborted) box.innerHTML = html || '<p class="muted">Too few records to show when and where it is seen.</p>';
    } catch { if (!signal.aborted) box.innerHTML = '<p class="muted">Could not load records (offline?).</p>'; }
  }

  // ---------- research papers (OpenAlex), cached per species ----------
  const PAPER_STORE = 'crLifeList.papers.v1';
  const paperCache = safeGet(PAPER_STORE) || {};
  const stripTags = (t) => String(t || '').replace(/<[^>]+>/g, '');
  function renderPapers(items) {
    const box = $('#papers');
    if (!items.length) { box.innerHTML = '<p class="muted">No papers found in OpenAlex for this scientific name.</p>'; return; }
    box.innerHTML = `<ol class="papers">${items.map((p) => {
      const link = p.doi || p.id;
      const authors = p.authors.length ? `${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}` : '';
      return `<li><a href="${esc(link)}" target="_blank" rel="noopener">${esc(stripTags(p.title))}</a>
        <span class="muted">${esc([authors, p.year, p.venue].filter(Boolean).join(' · '))}${p.cites ? ` · cited ${fmt(p.cites)}×` : ''}</span>
        ${p.cr ? '<span class="tag">Costa Rica study</span>' : ''}${p.oa ? ` <a class="oa" href="${esc(p.oa)}" target="_blank" rel="noopener">free full text</a>` : ''}</li>`;
    }).join('')}</ol><p class="muted source-line">Most-cited papers mentioning this species, Costa Rica studies first. From <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a>.</p>`;
  }
  async function loadPapers(s, signal) {
    const hit = paperCache[s.id];
    if (hit && Date.now() - hit.t < 30 * 864e5) { renderPapers(hit.items); return; }
    const fields = 'id,display_name,publication_year,cited_by_count,doi,primary_location,authorships,open_access';
    const query = (extra) => `https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(`"${s.sci}"${extra}`)}&sort=cited_by_count:desc&per_page=5&select=${fields}`;
    const pick = (w, cr) => ({
      id: w.id, title: w.display_name, year: w.publication_year, cites: w.cited_by_count, doi: w.doi, cr,
      venue: w.primary_location?.source?.display_name || null, oa: w.open_access?.oa_url || null,
      authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
    });
    try {
      const local = await getJson(query(' AND "Costa Rica"'), signal);
      const items = local.results.map((w) => pick(w, true));
      if (items.length < 5) {
        const all = await getJson(query(''), signal);
        for (const w of all.results) if (items.length < 6 && !items.some((x) => x.id === w.id)) items.push(pick(w, false));
      }
      if (signal.aborted) return;
      paperCache[s.id] = { t: Date.now(), items };
      const ids = Object.keys(paperCache);
      if (ids.length > 400) for (const id of ids.sort((a, b) => paperCache[a].t - paperCache[b].t).slice(0, ids.length - 400)) delete paperCache[id];
      safeSet(PAPER_STORE, paperCache);
      renderPapers(items);
    } catch { if (!signal.aborted) $('#papers').innerHTML = '<p class="muted">Could not reach OpenAlex (offline, or its free daily limit is used up).</p>'; }
  }

  // ---------- field guide summary (written by Claude on the local server) ----------
  const citeMarks = (html) => html.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, '<sup class="cite">[$1]</sup>');
  function renderSummary(s, d) {
    const box = $('#summaryBody');
    box.innerHTML = `<div class="prose">${citeMarks(markdown(d.markdown))}</div>
      <ol class="sources">${d.sources.map((src) => `<li>${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.label)}</a>` : esc(src.label)}</li>`).join('')}</ol>
      <p class="muted source-line">Written by Claude from your field guides and ${d.paperCount} research paper${d.paperCount === 1 ? '' : 's'} on ${esc(d.generated)}. Check important details against the sources. <button class="linkish" id="rewriteSummary">Rewrite</button></p>`;
    $('#rewriteSummary').onclick = () => writeSummary(s, true);
  }
  function renderSummaryPrompt(s) {
    $('#summaryBody').innerHTML = `<p class="muted">Claude can write an original account of this species from your field guides and published research, with numbered citations. It's saved, so each species is only written once.</p>
      <button class="btn" id="writeSummary">Write a summary (about 5¢)</button>`;
    $('#writeSummary').onclick = () => writeSummary(s, false);
  }
  async function writeSummary(s, refresh) {
    const box = $('#summaryBody');
    box.innerHTML = '<div class="msg-status"><span class="spinner"></span> Reading your field guides and research papers… (about 30 seconds)</div>';
    try {
      const r = await fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ species_id: s.id, refresh }) });
      const d = await r.json().catch(() => ({}));
      if (openId !== s.id) return;
      if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
      renderSummary(s, d);
    } catch (err) {
      if (openId !== s.id) return;
      const needsKey = /API key/i.test(err.message);
      box.innerHTML = `<p class="muted">${esc(err.message)}</p>${needsKey ? '<button class="btn primary" id="addKey">Add API key</button> ' : ''}<button class="btn" id="writeSummary">Try again</button>`;
      $('#writeSummary').onclick = () => writeSummary(s, refresh);
      if (needsKey) $('#addKey').onclick = () => { openChat(); setTimeout(showKeyForm, 400); };
    }
  }
  async function loadSummary(s, signal) {
    const box = $('#summaryBody');
    if (location.protocol === 'file:') { box.innerHTML = '<p class="muted">Start the app with <code>node tools/serve.mjs</code> to have Claude write summaries from your field guides and research.</p>'; return; }
    try {
      const r = await fetch(`/api/summary?species_id=${encodeURIComponent(s.id)}`, { signal });
      if (!r.ok) throw new Error();
      const { summary } = await r.json();
      if (signal.aborted) return;
      if (summary) renderSummary(s, summary); else renderSummaryPrompt(s);
    } catch { if (!signal.aborted) box.innerHTML = '<p class="muted">The app server is not running, so summaries are unavailable.</p>'; }
  }

  // ---------- menu actions ----------
  const menuBtn = $('#menuBtn'), menuPanel = $('#menuPanel');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menuPanel.hidden = !menuPanel.hidden; menuBtn.setAttribute('aria-expanded', !menuPanel.hidden); });
  document.addEventListener('click', (e) => { if (!menuPanel.hidden && !e.target.closest('.menu')) { menuPanel.hidden = true; menuBtn.setAttribute('aria-expanded', false); } });
  menuPanel.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menuPanel.hidden = true;
    ({ account: openAccount, install: installApp, inat: importInat, export: exportJson, csv: exportCsv, import: () => $('#importFile').click(), about, reset })[act]();
  });

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportJson() {
    download(`costa-rica-life-list-${today()}.json`, JSON.stringify({ app: 'costa-rica-life-list', version: 1, exported: new Date().toISOString(), checklist }, null, 1), 'application/json');
  }
  function exportCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['group', 'english_name', 'spanish_name', 'scientific_name', 'family', 'date_seen', 'notes', 'inat_taxon_id']];
    species.filter(isSeen).forEach((s) => rows.push([s.g, s.en, s.es, s.sci, s.family, checklist[s.id].d, checklist[s.id].n, s.inat]));
    download(`costa-rica-seen-species-${today()}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
  }
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const incoming = j.checklist || j;
      let added = 0;
      for (const [id, v] of Object.entries(incoming)) {
        if (!byId.has(id) || typeof v !== 'object') continue;
        if (!checklist[id]) added++;
        checklist[id] = { ...v, ...(checklist[id] || {}) };
      }
      saveChecklist(); renderProgress(); render();
      toast(`Imported backup: ${added} new species marked seen.`);
    } catch { toast('That file is not a checklist backup.'); }
  });

  function dialog(html, onSubmit) {
    const dlg = $('#dlg');
    $('#dlgForm').innerHTML = html;
    $('#dlgForm').onsubmit = async (e) => {
      if (e.submitter?.value !== 'ok') return;
      if (onSubmit) { e.preventDefault(); await onSubmit(dlg); }
    };
    dlg.showModal();
  }

  function importInat() {
    dialog(`<h2>Import from iNaturalist</h2>
      <p>Marks every species in this list that you have observed on iNaturalist as seen. Nothing is sent anywhere except iNaturalist's public API.</p>
      <input name="user" id="inatUser" placeholder="Your iNaturalist username" required autocomplete="username">
      <label class="muted"><input type="checkbox" id="inatCrOnly" checked> Only observations made in Costa Rica</label>
      <p class="muted" id="inatStatus"></p>
      <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Import</button></div>`,
    async (dlg) => {
      const user = $('#inatUser').value.trim();
      if (!user) return;
      const status = $('#inatStatus');
      const crOnly = $('#inatCrOnly').checked;
      const taxa = DATA.groups.map((g) => g.inat).join(',');
      let page = 1, total = 0, matched = 0, added = 0;
      try {
        for (;;) {
          status.textContent = `Fetching page ${page}…`;
          const r = await getJson(`${INAT}/observations/species_counts?user_login=${encodeURIComponent(user)}&taxon_id=${taxa}${crOnly ? `&place_id=${PLACE}` : ''}&verifiable=any&per_page=500&page=${page}`);
          total = r.total_results;
          for (const row of r.results) {
            const ids = [row.taxon.id, ...(row.taxon.ancestor_ids || []).slice().reverse()];
            const s = ids.map((id) => byInat.get(id)).find(Boolean);
            if (!s || (s.inat !== row.taxon.id && row.taxon.rank_level > 10)) continue;
            matched++;
            if (!checklist[s.id]) { checklist[s.id] = { d: '', n: '', src: 'inat', t: Date.now() }; added++; }
          }
          if (page * 500 >= total || !r.results.length) break;
          page++;
        }
        saveChecklist(); renderProgress(); render();
        dlg.close();
        toast(`${user}: ${matched} matching species on iNaturalist, ${added} newly marked seen.`);
      } catch {
        status.textContent = 'Could not reach iNaturalist or that user does not exist.';
      }
    });
  }

  function about() {
    const g = DATA.groups.map((x) => `${x.label}: ${fmt(x.count)}`).join(' · ');
    dialog(`<h2>About the data</h2>
      <p><b>${fmt(species.length)} species</b> (${g}), built ${esc(DATA.generated)}.</p>
      <p><b>Birds</b> follow Dyer &amp; Howell, <i>Birds of Costa Rica</i> (2023), including its appendix of rare visitors and vagrants. Species the book lacks, or calls hypothetical, are added only with a research-grade iNaturalist observation in Costa Rica (${fmt(species.filter((s) => s.g === 'birds' && s.add).length)} species, tagged).</p>
      <p><b>Amphibians and reptiles</b> follow Leenders' field guides (2016 and 2019), with names updated to current taxonomy, plus species described or first recorded in Costa Rica since then in peer-reviewed papers (${fmt(species.filter((s) => s.add === 'research').length)} species, tagged “Added from research”; each page cites the paper). Captive and escaped animals are not included.</p>
      <p><b>Edible mushrooms</b> are fungi with a research-grade iNaturalist observation in Costa Rica that Wikidata (from Wikipedia's mushroom pages) lists as edible. Species also recorded as poisonous or psychoactive are marked “Caution”, and a few species wrongly listed as edible, such as earthballs and the false morel, are left out. Never eat a wild mushroom based on this app.</p>
      <p><b>Mammals</b> are species on iNaturalist's Costa Rica checklist, with a research-grade iNaturalist observation in Costa Rica, or in Henderson's guide.</p>
      <p><b>Unconfirmed</b> species (${fmt(species.filter((s) => s.u).length)}) are counted unless you turn on “Confirmed only”: contested published records for amphibians and reptiles, and for mammals unverified iNaturalist observations or GBIF-only records. Domestic animals and hybrids are left out; extinct species are listed but not counted toward progress.</p>
      <p>Maps use live iNaturalist range, model and observation tiles and GBIF occurrence tiles. Photos are from iNaturalist users under their stated licenses.</p>
      <p>${sync.email ? `Your checklist is saved in this browser and in your account (${esc(sync.email)}).` : `Your checklist is stored in this browser only${FIREBASE ? '; sign in to keep it in an account' : ''}. Use “Export checklist” for backups.`}</p>
      <div class="actions"><button class="btn primary" value="cancel">Close</button></div>`);
  }

  function reset() {
    dialog(`<h2>Clear all marks?</h2><p>This removes all ${fmt(Object.keys(checklist).length)} seen marks from this browser${sync.uid ? ' and from your account, on every device' : ''}. Export a backup first if you might want them back.</p>
      <div class="actions"><button class="btn" value="cancel">Cancel</button><button class="btn danger" value="ok">Clear everything</button></div>`,
    (dlg) => { checklist = {}; saveChecklist(); renderProgress(); render(); dlg.close(); toast('Checklist cleared.'); });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  // A dialog that resolves with the value of the button that closed it ('' for Escape).
  function ask(html) {
    const dlg = $('#dlg');
    if (dlg.open) dlg.close();
    dlg.returnValue = '';
    dialog(html);
    return new Promise((resolve) => {
      const done = () => { if (dlg.open) return; dlg.removeEventListener('close', done); resolve(dlg.returnValue); };
      dlg.addEventListener('close', done); // a late close event from an earlier dialog finds it open and waits
    });
  }

  // ---------- account & cloud sync ----------
  // With a Firebase project set up (firebase-config.js), people can sign in and
  // keep their checklist in their account, so it follows them between devices.
  // The list still lives in localStorage and works offline. Each change also
  // goes in an outbox (sync.pending) that is sent to the account when there is
  // a connection, and whenever the account's list changes it replaces this
  // device's copy, with any unsent changes laid on top. The Firebase code
  // (vendor/firebase/cloud.js, built from src/cloud.mjs) loads only for people
  // who sign in.
  const FIREBASE = window.CR_FIREBASE;
  const SYNC_STORE = 'crLifeList.sync.v1';
  // uid: the account this device's list belongs to; email: shown while signed
  // in; pending: changes not yet in the account ({id: entry, or null if unmarked}).
  const sync = Object.assign({ uid: null, email: '', pending: {} }, safeGet(SYNC_STORE) || {});
  const saveSync = () => safeSet(SYNC_STORE, sync);
  const entryKey = (v) => (v ? JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]])) : '');
  const keysOf = (list) => new Map(Object.entries(list).map(([id, v]) => [id, entryKey(v)]));
  const changedIds = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id) !== b.get(id));
  let saved = keysOf(checklist); // the list as last saved, to tell what a save changed
  let cloud = null, cloudLoading = null, user = null, unwatch = null, userGen = 0;
  let joining = false, remoteWhileJoining = null;
  let flushing = false, flushTimer = null, retryMs = 2000, syncError = '';

  // Called on every save: whatever changed goes in the outbox.
  function queueCloudChanges() {
    const now = keysOf(checklist);
    const ids = changedIds(saved, now);
    saved = now;
    if (!sync.uid || !ids.length) return;
    for (const id of ids) sync.pending[id] = checklist[id] ? { ...checklist[id] } : null;
    saveSync();
    scheduleFlush();
    renderSync();
  }

  function scheduleFlush(ms = 500) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms);
  }
  // Sends the outbox to the account. Changes made while a save is under way
  // stay in the outbox for the next one.
  async function flush() {
    if (!cloud || !user || user.uid !== sync.uid || flushing) return;
    const ids = Object.keys(sync.pending);
    if (!ids.length) return;
    const batch = Object.fromEntries(ids.map((id) => [id, sync.pending[id] && { ...sync.pending[id] }]));
    const gen = userGen;
    flushing = true;
    renderSync();
    try {
      await cloud.save(sync.uid, batch);
      if (gen !== userGen) return;
      for (const id of ids) if (entryKey(sync.pending[id]) === entryKey(batch[id])) delete sync.pending[id];
      saveSync();
      syncError = ''; retryMs = 2000;
    } catch (err) {
      if (gen !== userGen) return;
      syncError = authMessage(err) || 'Could not save.';
      retryMs = Math.min(retryMs * 2, 60000);
    } finally {
      if (gen === userGen) {
        flushing = false;
        if (Object.keys(sync.pending).length) scheduleFlush(syncError ? retryMs : 300);
        renderSync();
      }
    }
  }

  // The account's list arrived or changed: it becomes this device's list, with
  // changes still in the outbox laid on top.
  function applyRemote(remote) {
    const next = { ...remote };
    for (const [id, v] of Object.entries(sync.pending)) { if (v) next[id] = { ...v }; else delete next[id]; }
    const now = keysOf(next);
    const ids = changedIds(saved, now);
    checklist = next; saved = now;
    if (!ids.length) return;
    safeSet(STORE, checklist);
    renderProgress();
    if (ids.length > 40 || ui.seen !== 'all' || ui.sort === 'recent') {
      render();
      if (openId) renderSeenBox(byId.get(openId));
    } else {
      ids.forEach((id) => { const s = byId.get(id); if (s) refreshItem(s); });
    }
  }

  // First sign-in on this device: species marked only here are added to the
  // account, after asking when the account already has a list of its own.
  async function join(u, remote) {
    const localOnly = Object.keys(checklist).filter((id) => !(id in remote));
    const remoteCount = Object.keys(remote).length;
    const add = !(remoteCount && localOnly.length) || (await ask(`<h2>Add this device's marks to your account?</h2>
      <p>Your account has ${fmt(remoteCount)} seen species. This device has ${fmt(localOnly.length)} more that aren't in your account yet.</p>
      <p class="muted">If you leave them out, this device will show only your account's list.</p>
      <div class="actions"><button class="btn" value="skip">Leave them out</button><button class="btn primary" value="ok">Add them</button></div>`)) !== 'skip';
    if (user !== u) return; // signed out meanwhile
    sync.uid = u.uid;
    sync.pending = add ? Object.fromEntries(localOnly.map((id) => [id, { ...checklist[id] }])) : {};
    saveSync();
    joining = false;
    applyRemote(remoteWhileJoining || remote);
    remoteWhileJoining = null;
    flush();
    renderSync();
    toast(add && localOnly.length
      ? `Signed in. ${fmt(localOnly.length)} species from this device ${remoteCount ? 'added to' : 'saved in'} your account.`
      : 'Signed in. Your list is saved in your account.');
  }

  function onUser(u) {
    userGen++;
    if (unwatch) { unwatch(); unwatch = null; }
    user = u; flushing = false; syncError = ''; joining = false; remoteWhileJoining = null;
    if (!u) {
      // Signed out: this device keeps its copy of the list.
      if (sync.uid || sync.email) { sync.uid = null; sync.email = ''; sync.pending = {}; saveSync(); }
      renderSync();
      return;
    }
    sync.email = u.email || u.name || 'your account';
    saveSync();
    joining = sync.uid !== u.uid;
    const gen = userGen;
    let first = true;
    unwatch = cloud.watch(u.uid, (remote) => {
      if (gen !== userGen) return;
      if (joining) {
        if (first) { first = false; join(u, remote); } else remoteWhileJoining = remote;
        return;
      }
      applyRemote(remote);
      renderSync();
    }, (err) => {
      if (gen !== userGen) return;
      syncError = authMessage(err) || 'The account could not be read.';
      renderSync();
    });
    if (!joining) flush();
    renderSync();
  }

  function startCloud() {
    if (!FIREBASE) return Promise.reject(new Error('Accounts are not set up for this copy of the app.'));
    cloudLoading ||= import('./vendor/firebase/cloud.js')
      .then((m) => { cloud = m.connect(FIREBASE); cloud.onUser(onUser); return cloud; })
      .catch(() => { cloudLoading = null; throw new Error('Could not load sign-in. Check your connection and try again.'); });
    return cloudLoading;
  }

  const AUTH_ERRORS = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account uses that email. Use “Create account” to make one.',
    'auth/email-already-in-use': 'That email already has an account. Use “Sign in” instead.',
    'auth/weak-password': 'Choose a password of at least 6 characters.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/popup-blocked': 'The browser blocked Google’s sign-in window. Allow pop-ups for this site, or use email.',
    'auth/popup-closed-by-user': '',
    'auth/cancelled-popup-request': '',
    'auth/user-cancelled': '',
    'auth/operation-not-allowed': 'This way of signing in isn’t switched on for the app yet.',
    'auth/unauthorized-domain': 'This web address isn’t allowed to use Google sign-in yet.',
    'auth/network-request-failed': 'No connection. Try again when you’re online.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
    'auth/user-disabled': 'This account has been switched off.',
    'auth/requires-recent-login': 'Sign out and in again, then try once more.',
    'permission-denied': 'The account’s storage refused it (its security rules may not be set up).',
    'unavailable': 'The account service can’t be reached right now.',
  };
  function authMessage(err) {
    const code = err?.code || '';
    if (code in AUTH_ERRORS) return AUTH_ERRORS[code];
    return String(err?.message || 'Something went wrong.').replace(/^Firebase:\s*/, '').replace(/\s*\((auth|firestore)\/[^)]*\)\.?$/, '');
  }

  function renderSync() {
    if (!FIREBASE) return;
    const n = Object.keys(sync.pending).length;
    const waiting = `${fmt(n)} change${n === 1 ? '' : 's'}`;
    let state, text;
    if (!sync.email) { state = 'local'; text = 'Saved on this device only. <button class="linkish" data-account>Sign in</button> to keep your list in an account.'; }
    else if (syncError) { state = 'err'; text = `Not saved to your account: ${esc(syncError)}`; }
    else if (!user || joining) { state = 'busy'; text = 'Connecting to your account…'; }
    else if (!navigator.onLine) { state = 'off'; text = n ? `Offline: ${waiting} will be saved to your account when you’re back online.` : 'Offline. Changes will be saved to your account when you’re back online.'; }
    else if (n || flushing) { state = 'busy'; text = 'Saving to your account…'; }
    else { state = 'ok'; text = 'Saved to your account'; }
    const line = $('#syncLine');
    line.innerHTML = `<span class="sdot ${state}"></span><span>${text}${sync.email ? ` · <button class="linkish" data-account>${esc(sync.email)}</button>` : ''}</span>`;
    line.hidden = false;
    $('#accountItem').textContent = sync.email ? 'Account and sync…' : 'Sign in to save your list…';
    $('#accountItem').hidden = false;
  }

  function openAccount() {
    if (!FIREBASE) return;
    if (sync.email) accountDialog(); else signInDialog();
  }

  const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  function signInDialog() {
    startCloud().catch(() => {}); // load it now, so Google's window can open straight from the click
    dialog(`<h2>Save your list to an account</h2>
      <p>Sign in to keep your checklist in your own account. It syncs between your phone and computer, and stays safe if you clear your browser or change phones. Only you can see it.</p>
      <button type="button" class="btn google" id="authGoogle">${GOOGLE_G}Continue with Google</button>
      <div class="or"><span>or use an email and password</span></div>
      <input type="email" id="authEmail" placeholder="Email" autocomplete="email" required>
      <input type="password" id="authPw" placeholder="Password (at least 6 characters)" autocomplete="current-password" minlength="6" required>
      <button type="button" class="linkish forgot" id="authForgot">Forgot your password?</button>
      <p class="auth-msg" id="authMsg" role="status"></p>
      <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn" value="create">Create account</button><button class="btn primary" value="ok">Sign in</button></div>`);
    const dlg = $('#dlg'), msg = $('#authMsg');
    const say = (text, isError) => { msg.textContent = text; msg.classList.toggle('err', !!isError); };
    const lock = (on) => $$('#dlgForm button:not([value="cancel"])').forEach((b) => { b.disabled = on; });
    // action may return a note to show instead of closing the dialog. With
    // Firebase already loaded it runs within the click, so Google's sign-in
    // window isn't blocked as a pop-up.
    const run = async (label, action, locking = true) => {
      say(label); if (locking) lock(true);
      try {
        const note = await action(cloud || (await startCloud()));
        if (note) say(note); else if (dlg.open) dlg.close();
      } catch (err) {
        if (msg.textContent === label) say(authMessage(err), true); // unless a newer attempt has started
      } finally { if (locking) lock(false); }
    };
    // The buttons stay usable while Google's window is open: if it's closed
    // without signing in, Firebase can take a while to notice.
    $('#authGoogle').onclick = () => run('Waiting for Google… (finish signing in in the window that opened)', async (c) => { await c.signInGoogle(); }, false);
    $('#authForgot').onclick = () => {
      const email = $('#authEmail');
      if (!email.value || !email.checkValidity()) { say('Enter your email above first.', true); email.focus(); return; }
      run('Sending…', async (c) => {
        await c.resetPassword(email.value.trim());
        return `If ${email.value.trim()} has an account, an email with a link to choose a new password is on its way.`;
      });
    };
    $('#dlgForm').onsubmit = (e) => {
      const v = e.submitter?.value;
      if (v !== 'ok' && v !== 'create') return;
      e.preventDefault();
      const email = $('#authEmail').value.trim(), pw = $('#authPw').value;
      run(v === 'create' ? 'Creating your account…' : 'Signing in…', async (c) => {
        await (v === 'create' ? c.createAccount(email, pw) : c.signIn(email, pw));
      });
    };
  }

  function accountDialog() {
    const n = species.filter(isSeen).length, p = Object.keys(sync.pending).length;
    dialog(`<h2>Your account</h2>
      <p>Signed in as <b>${esc(sync.email)}</b>. Your list of ${fmt(n)} seen species is saved in your account and syncs to every device where you sign in.</p>
      <p class="muted">${p ? `${fmt(p)} change${p === 1 ? '' : 's'} waiting to be saved${navigator.onLine ? '' : ' (offline)'}.` : syncError ? esc(syncError) : 'Everything is saved.'}</p>
      <div class="actions"><button class="linkish danger" value="delete">Delete account…</button><span class="spacer"></span><button class="btn" value="signout">Sign out</button><button class="btn primary" value="cancel">Close</button></div>`);
    $('#dlgForm').onsubmit = (e) => {
      const v = e.submitter?.value;
      if (v === 'signout') { e.preventDefault(); signOutFlow(); }
      if (v === 'delete') { e.preventDefault(); deleteDialog(); }
    };
  }

  async function signOutFlow() {
    const p = Object.keys(sync.pending).length;
    if (p && (await ask(`<h2>Sign out?</h2>
      <p>${fmt(p)} change${p === 1 ? ' hasn’t' : 's haven’t'} reached your account yet${navigator.onLine ? '' : ' (you are offline)'}. ${p === 1 ? 'It stays' : 'They stay'} on this device, and you can add ${p === 1 ? 'it' : 'them'} to your account the next time you sign in.</p>
      <div class="actions"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Sign out</button></div>`)) !== 'ok') return;
    try {
      await (cloud || (await startCloud())).signOut();
      if ($('#dlg').open) $('#dlg').close();
      toast('Signed out. Your list is still saved in your account, and this device keeps a copy.');
    } catch (err) { toast(authMessage(err) || 'Could not sign out.'); }
  }

  function deleteDialog() {
    const google = !!user?.google;
    dialog(`<h2>Delete your account?</h2>
      <p>This permanently deletes your account and the list saved in it. This device keeps its own copy of the list.</p>
      ${google ? '<p class="muted">Google will ask you to confirm it’s you.</p>' : '<input type="password" id="delPw" placeholder="Your password" autocomplete="current-password" required>'}
      <p class="auth-msg err" id="authMsg" role="status"></p>
      <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn danger" value="ok">Delete account</button></div>`,
    async (dlg) => {
      if (!cloud || !user) return;
      const me = user;
      if (unwatch) { unwatch(); unwatch = null; } // so deleting the saved list doesn't empty this device's copy
      try {
        await cloud.deleteAccount(google ? undefined : $('#delPw').value);
        dlg.close();
        toast('Your account and the list saved in it are deleted. This device keeps its copy.');
      } catch (err) {
        $('#authMsg').textContent = authMessage(err) || 'The account was not deleted.';
        // Start over as a first sign-in, which puts this device's list back if the saved one is gone.
        sync.uid = null; saveSync();
        if (user === me) onUser(me);
      }
    });
  }

  document.addEventListener('click', (e) => { if (e.target.closest('[data-account]')) openAccount(); });
  window.addEventListener('online', () => { renderSync(); scheduleFlush(100); });
  window.addEventListener('offline', renderSync);

  // ---------- chat ----------
  // Talks to the local server's /api/chat (tools/chat.mjs), which streams
  // Server-Sent Events. The conversation itself lives on the server; the
  // browser keeps the session id and a copy of the transcript for display.
  const CHAT_STORE = 'crLifeList.chat.v1';
  const chatState = Object.assign({ session: null, log: [] }, safeGet(CHAT_STORE) || {});
  let chatBusy = false;
  const saveChat = () => safeSet(CHAT_STORE, { session: chatState.session, log: chatState.log.slice(-60) });
  const SUGGESTIONS = [
    "What's the best place and time to see a Resplendent Quetzal?",
    'Where can I find Red-eyed Tree Frogs, and in which months?',
    'Which mammals can I see at Corcovado in March?',
    "What birds I haven't seen yet are likely at Monteverde?",
  ];

  // Small, safe Markdown renderer: the text is escaped first, then a few
  // constructs (headings, bold, italics, code, links, lists, tables) are added.
  function markdown(src) {
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    const out = [];
    let list = null, para = [], table = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
      out.push(`<table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`);
      table = [];
    };
    for (const line of src.split('\n')) {
      const t = line.trim();
      const bullet = t.match(/^[-*•]\s+(.*)$/), numbered = t.match(/^\d+[.)]\s+(.*)$/), heading = t.match(/^#{1,4}\s+(.*)$/);
      if (t.startsWith('|')) { flushPara(); flushList(); table.push(t); continue; }
      flushTable();
      if (!t) { flushPara(); flushList(); continue; }
      if (heading) { flushPara(); flushList(); out.push(`<h4>${inline(heading[1])}</h4>`); continue; }
      if (bullet || numbered) {
        flushPara();
        const type = bullet ? 'ul' : 'ol';
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push((bullet || numbered)[1]);
        continue;
      }
      if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1] += ' ' + t; continue; }
      flushList();
      para.push(t);
    }
    flushPara(); flushList(); flushTable();
    return out.join('');
  }

  // Approximate API cost of an answer, as reported by the server.
  const costNote = (m) => (m.cost ? `<div class="cost">API cost about ${m.cost < 0.01 ? '<1¢' : `${Math.round(m.cost * 100)}¢`}</div>` : '');
  function renderChatLog() {
    const log = $('#chatLog');
    if (!chatState.log.length) {
      log.innerHTML = `<div class="chat-intro"><p>Ask where and when to find an animal, what lives at a place, or what you still haven't seen. Answers combine iNaturalist and GBIF records with your field guides.</p>
        <div class="suggest">${SUGGESTIONS.map((q) => `<button type="button" data-suggest="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
      return;
    }
    log.innerHTML = chatState.log.map((m) => m.role === 'user'
      ? `<div class="msg user">${esc(m.text)}</div>`
      : `<div class="msg bot ${m.error ? 'error' : ''}">${m.error ? esc(m.text) : markdown(m.text)}${costNote(m)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  let chatChecked = false;
  async function checkChat() {
    if (chatChecked) return;
    chatChecked = true;
    let problem = null;
    if (location.protocol === 'file:') problem = 'The chat needs the local server. Start it with `node tools/serve.mjs` in the app folder and open http://localhost:5173.';
    else {
      try {
        const st = await (await fetch('/api/chat/status')).json();
        if (!st.ready) problem = st.reason;
        chatCredentials = st.credentials;
      } catch { problem = 'The chat server is not responding. Start the app with `node tools/serve.mjs`.'; }
    }
    if (problem) {
      $('#chatLog').insertAdjacentHTML('beforeend', `<div class="msg bot error">${markdown(problem)}</div>`);
      $('#chatSend').disabled = true;
    } else if (chatCredentials === 'unknown') showKeyForm();
  }

  // The user pastes their Anthropic API key here; the local server saves it to
  // .env and uses it right away. It never leaves this computer.
  let chatCredentials = null;
  function showKeyForm() {
    if ($('#keyForm')) return;
    $('#chatLog').insertAdjacentHTML('beforeend', `<div class="msg bot keybox" id="keyBox">
      <p><b>Add your Anthropic API key</b> to use the chat and the field guide summaries. It is saved in the app folder's <code>.env</code> file on this computer.</p>
      <form id="keyForm"><input type="password" id="keyInput" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="Anthropic API key"><button class="btn primary">Save</button></form>
      <p class="muted" id="keyMsg"></p></div>`);
    $('#keyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#keyInput');
      $('#keyMsg').textContent = 'Saving…';
      try {
        const r = await fetch('/api/config/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: input.value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
        input.value = '';
        chatCredentials = 'environment';
        $('#keyBox').innerHTML = '<p><b>Key saved.</b> The chat and summaries are ready.</p>';
      } catch (err) { $('#keyMsg').textContent = err.message; }
    });
    const log = $('#chatLog');
    log.scrollTop = log.scrollHeight;
  }

  function openChat() {
    $('#chat').hidden = false;
    $('#chatFab').setAttribute('aria-expanded', 'true');
    renderChatLog();
    if (chatCredentials === 'unknown') showKeyForm();
    checkChat();
    setTimeout(() => $('#chatInput').focus(), 50);
  }
  function closeChat() {
    $('#chat').hidden = true;
    $('#chatFab').setAttribute('aria-expanded', 'false');
  }

  async function askChat(question, speciesId) {
    question = question.trim();
    if (!question || chatBusy) return;
    chatBusy = true;
    $('#chatSend').disabled = true;
    chatState.log.push({ role: 'user', text: question });
    const answer = { role: 'bot', text: '' };
    chatState.log.push(answer);
    renderChatLog();
    const bubble = $('#chatLog').lastElementChild;
    let status = 'Thinking';
    let frame = 0;
    const paint = () => {
      frame = 0;
      bubble.className = `msg bot ${answer.error ? 'error' : ''}`;
      bubble.innerHTML = (answer.error ? esc(answer.text) : markdown(answer.text)) + (status ? `<div class="status">${esc(status)}…</div>` : costNote(answer));
      const log = $('#chatLog');
      log.scrollTop = log.scrollHeight;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: chatState.session, message: question, seen: Object.keys(checklist), species_id: speciesId || null, today: today() }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = (chunk.match(/^event: (.*)$/m) || [])[1];
          const data = JSON.parse((chunk.match(/^data: (.*)$/m) || [])[1] || '{}');
          if (event === 'session') chatState.session = data.session;
          else if (event === 'status') status = data.text;
          else if (event === 'text') { answer.text += data.delta; if (data.delta.trim()) status = ''; }
          else if (event === 'error') { answer.error = !answer.text.trim(); answer.text = answer.error ? data.message : `${answer.text}\n\n_${data.message}_`; }
          else if (event === 'done') { status = ''; if (data.cost) answer.cost = data.cost; }
          schedule();
        }
      }
    } catch (err) {
      answer.error = true;
      answer.text = `Could not get an answer: ${err.message}`;
    }
    status = '';
    answer.text = answer.text.trim() || (answer.error ? answer.text : 'No answer came back. Please try again.');
    paint();
    saveChat();
    chatBusy = false;
    $('#chatSend').disabled = false;
  }

  $('#chatFab').addEventListener('click', openChat);
  $('#chatClose').addEventListener('click', closeChat);
  $('#chatNew').addEventListener('click', () => {
    if (chatBusy) return;
    chatState.session = null; chatState.log = [];
    saveChat(); renderChatLog();
  });
  $('#chatLog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-suggest]');
    if (b) askChat(b.dataset.suggest, openId);
  });
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const q = input.value;
    input.value = ''; input.style.height = '';
    askChat(q, openId);
  });
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); }
  });
  $('#chatInput').addEventListener('input', (e) => {
    e.target.style.height = '';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  // ---------- app install, offline, hosted mode ----------
  // Offline support and installing need the service worker (sw.js), which runs
  // when the app is served over http(s): the local server or a web host.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('#installItem').hidden = true; toast('Installed. Open Costa Rica Life List from your apps.'); });
  if (standalone()) $('#installItem').hidden = true;
  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') installPrompt = null;
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    dialog(`<h2>Install the app</h2>
      ${location.protocol === 'file:' ? '<p>Installing needs the app to be opened from a web address: start <code>node tools/serve.mjs</code> and open http://localhost:5173, or use the hosted link.</p>' : ios
        ? '<p>In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>'
        : '<p>In Chrome or Edge, use the <b>Install</b> icon at the right end of the address bar, or the browser menu → <b>Install app</b> (on Android: ⋮ → <b>Add to Home screen</b>).</p>'}
      <p>The installed app opens in its own window and works offline with the species you've looked at. ${FIREBASE ? 'Sign in there too, and your list syncs between your devices.' : 'Your checklist stays on this device; use Export for backups.'}</p>
      <div class="actions"><button class="btn primary" value="cancel">OK</button></div>`);
  }
  const offlineBar = () => { $('#offlineBar').hidden = navigator.onLine; };
  window.addEventListener('online', offlineBar);
  window.addEventListener('offline', offlineBar);
  offlineBar();

  // Chat and summaries need the local server; on a web host (or opened as a
  // file) they are hidden.
  let hasServer = false;
  async function detectServer() {
    if (/^https?:$/.test(location.protocol)) {
      try { hasServer = (await fetch('/api/chat/status', { cache: 'no-store' })).ok; } catch { hasServer = false; }
    }
    document.body.classList.toggle('no-server', !hasServer);
  }

  // ---------- init ----------
  $$('[data-seen]').forEach((x) => x.classList.toggle('on', x.dataset.seen === ui.seen));
  $$('[data-view]').forEach((x) => x.classList.toggle('on', x.dataset.view === ui.view));
  $$('[data-flag]').forEach((x) => x.classList.toggle('on', ui.flags.has(x.dataset.flag)));
  $('#sort').value = ui.sort;
  renderProgress();
  renderFamilies();
  render();
  renderSync();
  if (FIREBASE && sync.email) startCloud().catch((err) => { syncError = err.message; renderSync(); });
  detectServer().finally(route);
})();
