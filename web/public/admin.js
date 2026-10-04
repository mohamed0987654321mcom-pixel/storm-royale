(function () {
  const $ = (s) => document.querySelector(s);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  function toast(text, bad) {
    const el = h('div', { class: `toast ${bad ? 'bad' : ''}` }, text);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4000);
  }

  let status = 'open';

  async function act(report, action, hours) {
    const r = await fetch(`/api/admin/reports/${report.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, hours, targetId: report.targetId }),
    });
    if (!r.ok) return toast('Failed', true);
    toast(action === 'dismiss' ? 'Dismissed' : `${action} applied to ${report.targetName}`);
    load();
  }

  async function load() {
    const r = await fetch(`/api/admin/reports?status=${status}`);
    if (r.status === 401) return (location.href = '/');
    if (r.status === 403) return ($('#reports').textContent = 'Admins only. Add your email to ADMIN_EMAILS on Railway.');
    const data = await r.json();
    $('#live').textContent = `${data.live.online} online · ${data.live.parties} parties · ${data.live.inVoice} in voice`;
    $('#empty').hidden = data.reports.length > 0;
    $('#reports').replaceChildren(
      ...data.reports.map((rep) =>
        h('div', { class: `report ${rep.source}` },
          h('div', { class: 'head' },
            h('span', { class: 'who' }, rep.targetName),
            h('span', { class: 'muted' }, `reported by ${rep.reporterName}`),
            h('span', { class: 'muted' }, new Date(rep.createdAt).toLocaleString()),
          ),
          h('div', { class: 'reason' }, rep.reason),
          rep.context.length
            ? h('div', { class: 'ctx' }, rep.context.map((c) => h('div', { class: c.blocked ? 'blocked' : '' }, `${new Date(c.ts).toLocaleTimeString()} — ${c.text}${c.blocked ? '  (blocked)' : ''}`)))
            : null,
          status === 'open'
            ? h('div', { class: 'actions' },
              h('button', { class: 'btn ghost', onclick: () => act(rep, 'dismiss') }, 'DISMISS'),
              h('button', { class: 'btn', onclick: () => act(rep, 'mute', 24) }, 'MUTE 24H'),
              h('button', { class: 'btn danger', onclick: () => act(rep, 'ban', 24 * 7) }, 'BAN 7 DAYS'),
              h('button', { class: 'btn danger', onclick: () => act(rep, 'ban', 24 * 365) }, 'BAN 1 YEAR'),
            )
            : h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => act(rep, 'unban') }, 'UNBAN / UNMUTE')),
        ),
      ),
    );
  }

  document.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', () => {
      status = b.dataset.status;
      document.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('active', x === b));
      load();
    }),
  );
  load();
  setInterval(load, 20000);
})();
