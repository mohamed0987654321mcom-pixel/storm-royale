// Storm Royale parent page
(function () {
  const $ = (s) => document.querySelector(s);
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
  function toast(text, bad) {
    const el = h('div', { class: `toast ${bad ? 'bad' : ''}` }, text);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data });
    return data;
  }

  let state = null;

  // ------------------------------------------------------------ sign in
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/parent/start', { email: $('#email').value.trim() });
      $('#sentNote').hidden = false;
      if (data.devLink) {
        $('#devLink').hidden = false;
        $('#devLink').href = data.devLink;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/parent/logout');
    location.href = '/parent';
  });

  // ------------------------------------------------------------ actions
  async function act(path, body, ok) {
    try {
      const data = await api(path, body);
      if (ok) toast(ok);
      await load();
      return data;
    } catch (err) {
      toast(err.message, true);
      return null;
    }
  }

  function statusPill(kid) {
    if (kid.consent === 'pending' || kid.consent === 'none') return h('span', { class: 'status pending' }, 'WAITING FOR YOU');
    if (kid.consent === 'verified') return h('span', { class: 'status verified' }, 'VERIFIED PARENT');
    return h('span', { class: 'status basic' }, 'APPROVED');
  }

  function toggle(kid, key, title, desc, needsVerify = true) {
    const verified = kid.consent === 'verified';
    const on = key === 'quick' ? kid.settings.quick !== false : kid.settings[key] === true;
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': title, checked: on, disabled: needsVerify && !verified && !on });
    input.addEventListener('change', () => act('/api/parent/settings', { kidId: kid.id, [key]: input.checked }, `${title} turned ${input.checked ? 'on' : 'off'}`));
    return h('div', { class: 'toggle' },
      h('div', {}, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)),
      h('label', { class: 'switch' }, input, h('span', { class: 'track' })),
    );
  }

  function kidCard(kid) {
    const pending = kid.consent === 'pending' || kid.consent === 'none';
    const card = h('section', { class: 'card kid-card' },
      h('h3', {}, kid.name, statusPill(kid), h('span', { class: 'online' }, kid.online ? '● online now' : '')),
    );
    if (!kid.stillKid) {
      card.append(h('p', { class: 'muted' }, `${kid.name} is 13 now, so kids' rules no longer apply to this account.`));
    }

    if (pending) {
      card.append(
        h('div', { class: 'consent-box' },
          h('p', {}, h('b', {}, `${kid.name} wants to join Storm Royale.`), " Here's what that means:"),
          h('ul', {},
            h('li', {}, 'They can join parties only with friends that you and the other parent both approve.'),
            h('li', {}, 'No open lobbies, no strangers, and never with teens or adults.'),
            h('li', {}, 'They can use quick chat: preset game phrases like "GG!" only. Typing and voice stay off until you verify that you are a parent.'),
            h('li', {}, 'We store their display name, birth date, email and your email. You can delete it all any time.'),
          ),
          h('div', { class: 'row' },
            h('button', { class: 'btn yellow', onclick: () => act('/api/parent/consent', { kidId: kid.id, approve: true }, `${kid.name}'s account is approved 🎉`) }, 'APPROVE'),
            h('button', {
              class: 'btn danger',
              onclick: () => confirm(`Decline and delete ${kid.name}'s account?`) && act('/api/parent/consent', { kidId: kid.id, approve: false }, 'Account declined and deleted'),
            }, 'DECLINE AND DELETE'),
          ),
        ),
      );
      return card;
    }

    // chat + voice
    const settings = h('div', { class: 'section' },
      h('h4', {}, 'CHAT AND VOICE'),
      toggle(kid, 'quick', 'Quick chat', 'Preset game phrases only, like "GG!" and "Follow me!". Nothing can be typed, so nothing personal can be shared.', false),
      toggle(kid, 'chat', 'Text chat', 'Typed messages with approved friends, checked by an AI moderator.'),
      toggle(kid, 'voice', 'Voice chat', 'Talking with approved friends. Speech is turned into text and checked; audio is never recorded.'),
    );
    if (!kid.emailVerified) {
      settings.append(h('p', { class: 'muted' }, `✉️ ${kid.name} hasn't confirmed their own email yet, so typing and voice stay off for them even when switched on here. Quick chat works.`));
    }
    if (kid.consent !== 'verified') {
      settings.append(
        h('div', { class: 'verify-note' },
          '🔒 To turn on typing or voice, first verify that you are a parent.',
          h('button', {
            class: 'btn',
            onclick: async () => {
              const data = await act('/api/parent/verify', { kidId: kid.id });
              if (data && data.url) location.href = data.url;
            },
          }, 'VERIFY'),
        ),
      );
    }
    card.append(settings);

    // friend requests waiting for this parent
    const reqs = kid.requests;
    if (reqs.length) {
      card.append(h('div', { class: 'section' },
        h('h4', {}, 'FRIEND REQUESTS'),
        h('ul', { class: 'plist' }, reqs.map((r) =>
          h('li', {},
            h('span', { class: 'nm' }, r.otherName),
            r.approvedByMe
              ? h('span', { class: 'st' }, 'You said yes. Waiting for their parent.')
              : [
                h('button', { class: 'btn yellow', onclick: () => act('/api/parent/request', { requestId: r.id, approve: true }, r.approvedByOther ? `${kid.name} and ${r.otherName} are friends now` : 'Approved. Waiting for the other parent.') }, 'APPROVE'),
                h('button', { class: 'btn ghost', onclick: () => act('/api/parent/request', { requestId: r.id, approve: false }, 'Declined') }, 'DECLINE'),
              ],
          ))),
      ));
    }

    // friends
    card.append(h('div', { class: 'section' },
      h('h4', {}, `FRIENDS (${kid.friends.length})`),
      kid.friends.length
        ? h('ul', { class: 'plist' }, kid.friends.map((f) =>
          h('li', {},
            h('span', { class: 'nm' }, f.name),
            h('button', { class: 'btn ghost', onclick: () => confirm(`Remove ${f.name} from ${kid.name}'s friends?`) && act('/api/parent/unfriend', { kidId: kid.id, friendId: f.id }, 'Friend removed') }, 'REMOVE'),
          )))
        : h('p', { class: 'muted' }, `${kid.name} has no friends added yet. Requests show up here for your OK.`),
    ));

    card.append(h('div', { class: 'section danger-zone' },
      h('button', {
        class: 'btn danger',
        onclick: () => confirm(`Delete ${kid.name}'s account and all its data? This can't be undone.`) && act('/api/parent/delete', { kidId: kid.id }, 'Account deleted'),
      }, 'DELETE ACCOUNT'),
    ));
    return card;
  }

  async function load() {
    const r = await fetch('/api/parent/me');
    if (r.status === 401) {
      $('#signedOut').hidden = false;
      $('#signedIn').hidden = true;
      $('#logout').hidden = true;
      return;
    }
    state = await r.json();
    $('#signedOut').hidden = true;
    $('#signedIn').hidden = false;
    $('#logout').hidden = false;
    $('#who').textContent = `Signed in as ${state.email}`;
    $('#kids').replaceChildren(...(state.kids.length ? state.kids.map(kidCard) : [h('section', { class: 'card' }, h('p', {}, 'No kids accounts use this email right now.'))]));
  }

  if (new URLSearchParams(location.search).get('error') === 'link') {
    toast('That link expired. Enter your email to get a new one.', true);
    history.replaceState(null, '', '/parent');
  }
  load();
  setInterval(() => document.visibilityState === 'visible' && load(), 30000);
})();
