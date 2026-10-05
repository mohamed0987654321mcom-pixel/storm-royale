// Storm Royale locker: dress up your Storm Royale character with the Roblox items you own.
// Saved looks reach the game within ~10 s; looks saved in the game show up here too.
(function () {
  const $ = (s) => document.querySelector(s);
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  function s(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }
  function toast(text, bad) {
    const el = h('div', { class: `toast ${bad ? 'bad' : ''}` }, text);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }
  async function api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) location.href = '/';
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const SWATCHES = [
    '#ffe0bd', '#f5cd9b', '#eab892', '#d4a373', '#c68642', '#a0662f', '#8d5524', '#5c3a21', '#3b2219',
    '#ffffff', '#e5e4df', '#a3a2a5', '#635f62', '#1b1b1b', '#ff4f6d', '#ff9a3d', '#ffdc32', '#47e27a',
    '#4b974b', '#00c2a8', '#6e99ca', '#3fa9ff', '#1b3fae', '#6a2fd1', '#ff66cc',
  ];
  const PART_LABELS = { all: 'Whole body', head: 'Head', torso: 'Torso', leftArm: 'Left arm', rightArm: 'Right arm', leftLeg: 'Left leg', rightLeg: 'Right leg' };
  const SCALE_TEXT = {
    height: ['Height', 'How tall you are'],
    width: ['Width', 'How wide your body is'],
    head: ['Head size', 'A slightly smaller or bigger head'],
    proportion: ['Proportion', 'From classic blocky to slender'],
    bodyType: ['Body type', 'From classic to more human-like'],
  };

  const st = {
    data: null, // GET /api/avatar
    look: null, // what's being edited
    savedJson: '', // to spot unsaved changes
    cat: 'head',
    type: null,
    q: '',
    part: 'all',
    thumbs: new Map(),
    asked: new Set(),
  };
  const R = () => st.data.rules;
  const dirty = () => JSON.stringify(st.look) !== st.savedJson;
  const wearing = (id) => st.look.items.some((i) => i.id === id);

  // ------------------------------------------------------------ thumbnails
  async function loadThumbs(ids) {
    const need = ids.filter((id) => !st.thumbs.has(id) && !st.asked.has(id)).slice(0, 120);
    if (!need.length) return;
    need.forEach((id) => st.asked.add(id));
    try {
      const { thumbs } = await api('/api/avatar/thumbs', { ids: need });
      for (const [id, url] of Object.entries(thumbs)) st.thumbs.set(Number(id), url);
      for (const id of need) if (!st.thumbs.has(id)) st.asked.delete(id); // still being made on Roblox's side: ask again later
      document.querySelectorAll('[data-thumb]').forEach((el) => {
        const url = st.thumbs.get(Number(el.dataset.thumb));
        if (url && !el.querySelector('img')) el.replaceChildren(h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
      });
    } catch {
      need.forEach((id) => st.asked.delete(id));
    }
  }
  function pic(id, cls) {
    const url = st.thumbs.get(id);
    return h('span', { class: cls, 'data-thumb': id }, url ? h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph' }, '👕'));
  }

  // ------------------------------------------------------------ preview (colors + sizes)
  function renderMannequin() {
    const svg = $('#mannequin');
    const c = st.look.colors;
    const sc = st.look.scales;
    const col = (p, fallback) => c[p] || fallback;
    const w = sc.width;
    const ht = sc.height;
    const legs = 1 + sc.proportion * 0.12; // slender = longer legs
    const torsoW = 64 * (1 - sc.bodyType * 0.12);
    svg.replaceChildren();
    svg.append(s('ellipse', { cx: 100, cy: 258, rx: 60, ry: 8, fill: 'rgba(0,0,0,0.35)' }));
    const g = s('g', { transform: `translate(100 250) scale(${w} ${ht}) translate(-100 -250)` });
    const legH = 84 * legs;
    const legY = 250 - legH;
    const torsoY = legY - 82;
    const armX = 100 + torsoW / 2 + 2;
    g.append(
      s('rect', { x: 100 - torsoW / 2, y: legY, width: torsoW / 2 - 1, height: legH, rx: 6, fill: col('rightLeg', '#6e99ca') }),
      s('rect', { x: 101, y: legY, width: torsoW / 2 - 1, height: legH, rx: 6, fill: col('leftLeg', '#6e99ca') }),
      s('rect', { x: 100 - torsoW / 2, y: torsoY, width: torsoW, height: 84, rx: 8, fill: col('torso', '#4b974b') }),
      s('rect', { x: 100 - torsoW / 2 - 28, y: torsoY + 2, width: 26, height: 78, rx: 7, fill: col('rightArm', '#e5e4df') }),
      s('rect', { x: armX, y: torsoY + 2, width: 26, height: 78, rx: 7, fill: col('leftArm', '#e5e4df') }),
    );
    const head = 46 * sc.head;
    const hy = torsoY - head - 4;
    const hg = s('g');
    hg.append(
      s('rect', { x: 100 - head / 2, y: hy, width: head, height: head, rx: 12, fill: col('head', '#e5e4df') }),
      s('circle', { cx: 100 - head * 0.18, cy: hy + head * 0.42, r: head * 0.06, fill: '#1b1b1b' }),
      s('circle', { cx: 100 + head * 0.18, cy: hy + head * 0.42, r: head * 0.06, fill: '#1b1b1b' }),
      s('path', { d: `M ${100 - head * 0.2} ${hy + head * 0.64} Q 100 ${hy + head * 0.8} ${100 + head * 0.2} ${hy + head * 0.64}`, stroke: '#1b1b1b', 'stroke-width': head * 0.06, fill: 'none', 'stroke-linecap': 'round' }),
    );
    g.append(hg);
    svg.append(g);
  }

  function renderWearing() {
    const items = st.look.items;
    $('#wearCount').textContent = `(${items.length})`;
    $('#wearing').replaceChildren(
      ...(items.length
        ? items.map((it) =>
          h('button', { class: 'wear-chip', type: 'button', title: `Take off ${it.name}`, onclick: () => { removeItem(it.id); render(); } },
            pic(it.id, 'pc'), h('span', { class: 'nm' }, it.name || R().types[it.type]?.label || 'Item'), h('span', { class: 'x' }, '✕'),
          ))
        : [h('span', { class: 'muted-note' }, 'Nothing yet. Tap items to wear them.')]),
    );
    loadThumbs(items.map((i) => i.id));
  }

  function renderSaved() {
    const tag = $('#savedTag');
    if (dirty()) {
      tag.textContent = '● not saved';
      tag.className = 'saved-tag';
    } else if (st.data.saved) {
      tag.textContent = '✓ in the game';
      tag.className = 'saved-tag live';
    } else {
      tag.textContent = 'normal Roblox avatar';
      tag.className = 'saved-tag';
    }
    $('#savebar').hidden = !dirty();
  }

  // ------------------------------------------------------------ builder
  function renderCats() {
    const counts = {};
    for (const it of st.data.items) {
      const c = R().types[it.type]?.cat;
      if (c) counts[c] = (counts[c] || 0) + 1;
    }
    const tabs = [...R().categories.map((c) => ({ ...c, n: counts[c.id] || 0 })), { id: 'colors', label: 'COLORS' }, { id: 'size', label: 'SIZE' }];
    $('#cats').replaceChildren(
      ...tabs.map((t) =>
        h('button', { class: `cat ${st.cat === t.id ? 'active' : ''}`, type: 'button', onclick: () => { st.cat = t.id; st.type = null; render(); } },
          t.label, t.n != null ? h('span', { class: 'n' }, t.n) : null,
        )),
    );
    $('#itemsPanel').hidden = ['colors', 'size'].includes(st.cat);
    $('#colorsPanel').hidden = st.cat !== 'colors';
    $('#sizePanel').hidden = st.cat !== 'size';
  }

  function renderItems() {
    const types = R().types;
    const inCat = st.data.items.filter((it) => types[it.type]?.cat === st.cat);
    const typesHere = [...new Set(inCat.map((it) => it.type))];
    $('#typeChips').replaceChildren(
      ...(typesHere.length > 1
        ? [h('button', { class: `chip ${!st.type ? 'active' : ''}`, type: 'button', onclick: () => { st.type = null; renderItems(); } }, 'All'),
          ...typesHere.map((t) => h('button', { class: `chip ${st.type === t ? 'active' : ''}`, type: 'button', onclick: () => { st.type = t; renderItems(); } }, types[t].label))]
        : []),
    );
    const q = st.q.trim().toLowerCase();
    const shown = inCat
      .filter((it) => (!st.type || it.type === st.type) && (!q || it.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(wearing(b.id)) - Number(wearing(a.id)));
    $('#grid').replaceChildren(
      ...shown.map((it) =>
        h('button', { class: `item ${wearing(it.id) ? 'on' : ''}`, type: 'button', title: it.name, onclick: () => { toggle(it); render(); } },
          pic(it.id, 'pic'), h('span', { class: 'nm' }, it.name || 'Item'), h('span', { class: 'ty' }, types[it.type].label), h('span', { class: 'tick' }, '✓'),
        )),
    );
    const empty = $('#empty');
    empty.hidden = shown.length > 0;
    empty.textContent = q
      ? 'No items match your search.'
      : st.data.inventoryAt
        ? "You don't own any items here yet. Get some on the Roblox Marketplace, then tap SHOW MY ITEMS in the game's locker again."
        : "No items here yet. Tap SHOW MY ITEMS in the game's locker to bring in everything you own.";
    loadThumbs(shown.slice(0, 120).map((i) => i.id));
  }

  function renderColors() {
    const parts = ['all', ...R().parts];
    $('#partChips').replaceChildren(
      ...parts.map((p) => h('button', { class: `chip ${st.part === p ? 'active' : ''}`, type: 'button', onclick: () => { st.part = p; renderColors(); } }, PART_LABELS[p])),
    );
    const current = st.part === 'all' ? st.look.colors.torso : st.look.colors[st.part];
    $('#swatches').replaceChildren(
      ...SWATCHES.map((hex) => {
        const b = h('button', { class: `swatch ${current === hex ? 'on' : ''}`, type: 'button', 'aria-label': hex, title: hex, onclick: () => { setColor(hex); render(); } });
        b.style.background = hex; // CSSOM (allowed by the page's security policy)
        return b;
      }),
    );
    if (current) $('#colorPick').value = current;
  }
  function setColor(hex) {
    const parts = st.part === 'all' ? R().parts : [st.part];
    for (const p of parts) st.look.colors[p] = hex;
  }
  $('#colorPick').addEventListener('input', (e) => {
    setColor(e.target.value);
    renderMannequin();
    renderSaved();
  });

  function renderSliders() {
    $('#sliders').replaceChildren(
      ...Object.entries(R().scales).map(([k, r]) => {
        const v = st.look.scales[k];
        const val = h('span', { class: 'val' }, `${Math.round(v * 100)}%`);
        const input = h('input', { type: 'range', min: r.min, max: r.max, step: 0.01, value: v, 'aria-label': SCALE_TEXT[k][0] });
        input.addEventListener('input', () => {
          st.look.scales[k] = Number(input.value);
          val.textContent = `${Math.round(Number(input.value) * 100)}%`;
          renderMannequin();
          renderSaved();
        });
        return h('div', { class: 'slider' },
          h('div', { class: 'top-line' }, h('span', {}, SCALE_TEXT[k][0]), val),
          h('div', { class: 'd' }, SCALE_TEXT[k][1]),
          input,
        );
      }),
    );
  }

  // ------------------------------------------------------------ wearing rules (the server checks them again)
  function removeItem(id) {
    st.look.items = st.look.items.filter((i) => i.id !== id);
  }
  function toggle(it) {
    if (wearing(it.id)) return removeItem(it.id);
    const types = R().types;
    const def = types[it.type];
    const rigid = (t) => ['Hat', 'HairAccessory', 'FaceAccessory', 'NeckAccessory', 'ShoulderAccessory', 'FrontAccessory', 'BackAccessory', 'WaistAccessory'].includes(t);
    // same slot already full: swap out the oldest one
    const same = st.look.items.filter((i) => (def.group ? types[i.type]?.group === def.group : i.type === it.type));
    const max = def.group ? 1 : def.max;
    if (same.length >= max) removeItem(same[0].id);
    if (rigid(it.type) && st.look.items.filter((i) => rigid(i.type)).length >= R().rigidMax) {
      return toast(`You can wear up to ${R().rigidMax} accessories at once. Take one off first.`, true);
    }
    if (def.layered && st.look.items.filter((i) => types[i.type]?.layered).length >= R().layeredMax) {
      return toast(`You can wear up to ${R().layeredMax} layered clothes at once.`, true);
    }
    if (st.look.items.length >= R().itemsMax) return toast(`That's the most items one look can have (${R().itemsMax}).`, true);
    st.look.items.push({ id: it.id, type: it.type, name: it.name });
  }

  function render() {
    renderMannequin();
    renderWearing();
    renderCats();
    if (st.cat === 'colors') renderColors();
    else if (st.cat === 'size') renderSliders();
    else renderItems();
    renderSaved();
  }

  $('#search').addEventListener('input', (e) => {
    st.q = e.target.value;
    renderItems();
  });

  // ------------------------------------------------------------ save / undo / reset
  $('#saveBtn').addEventListener('click', async () => {
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      const res = await api('/api/avatar', { look: st.look });
      st.data.look = res.look;
      st.data.saved = true;
      st.data.lookVer = res.lookVer;
      st.look = clone(res.look);
      st.savedJson = JSON.stringify(st.look);
      render();
      toast('Saved! 🎉 Your look shows up in Storm Royale within 10 seconds (in the lobby).');
      if (res.dropped?.length) toast(`${res.dropped.length} item(s) were taken off: this Roblox account doesn't own them, or it was too many.`, true);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  $('#undoBtn').addEventListener('click', () => {
    st.look = JSON.parse(st.savedJson);
    render();
  });
  $('#fromRoblox').addEventListener('click', () => {
    if (!st.data.robloxLook) return toast("Couldn't load your Roblox avatar right now. Try again in a moment.", true);
    st.look = clone(st.data.robloxLook);
    render();
    toast('Copied your Roblox avatar. Change anything you like, then SAVE.');
  });
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('Go back to your normal Roblox avatar in Storm Royale? Your saved look here will be cleared.')) return;
    try {
      await api('/api/avatar/reset', {});
      await load();
      toast('Done. Storm Royale uses your normal Roblox avatar again.');
    } catch (err) {
      toast(err.message, true);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (st.data && st.look && dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ------------------------------------------------------------ load + stay in sync with the game
  async function load() {
    const data = await api('/api/avatar');
    $('#loading').hidden = true;
    if (!data.linked) {
      $('#notLinked').hidden = false;
      $('#locker').hidden = true;
      return;
    }
    st.data = data;
    st.look = clone(data.look);
    st.savedJson = JSON.stringify(st.look);
    $('#locker').hidden = false;
    $('#invNote').hidden = Boolean(data.inventoryAt);
    render();
  }

  // a look saved in the game shows up here (unless you're in the middle of changing things)
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !st.data || dirty()) return;
    try {
      const { lookVer } = await api('/api/avatar/ver');
      if (lookVer !== st.data.lookVer) {
        await load();
        toast('Updated with the look you saved in the game ✨');
      }
    } catch {
      /* try again next time */
    }
  }, 15000);

  load().catch((err) => {
    $('#loading').textContent = err.message;
  });
})();
