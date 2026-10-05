// Storm Royale website: sign-in, parties, chat, voice UI.
(function () {
  const $ = (s) => document.querySelector(s);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const S = { me: null, room: null, rooms: [], history: [], speaking: new Set(), names: new Map() };
  let socket = null;
  let voice = null;

  const initial = (name) => String(name || '?').charAt(0).toUpperCase();
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const emit = (ev, payload) => new Promise((resolve) => socket.emit(ev, payload || {}, (r) => resolve(r || { ok: false })));
  const isBlocked = (id) => Boolean(S.me && S.me.blocked.includes(id));
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  // ---------------------------------------------------------------- toasts
  function toast(text, opts = {}) {
    const actions = (opts.actions || []).map((a) =>
      h('button', { class: `btn ${a.cls || ''}`, onclick: () => { el.remove(); if (a.fn) a.fn(); } }, a.label),
    );
    const el = h('div', { class: `toast ${opts.bad ? 'bad' : ''}` }, h('div', {}, text), actions.length ? h('div', { class: 'row' }, actions) : null);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), opts.actions ? 20000 : 4500);
  }

  // ---------------------------------------------------------------- sign in
  let signupMode = false;
  function showSignIn() {
    $('#signedOut').hidden = false;
    $('#app').hidden = true;
    $('#tabs').hidden = true;
    $('#meChip').hidden = true;
  }

  // skip = "skip email for now": make the account and sign in straight away
  async function submitSignin(skip) {
    const body = { email: $('#email').value.trim() };
    if (!body.email) return toast('Enter your email', { bad: true });
    if (signupMode) {
      if (!$('#rules').checked) return toast('Please accept the community rules first', { bad: true });
      body.name = $('#name').value.trim();
      body.birthDate = $('#birth').value;
      if (!body.name || !body.birthDate) return toast('Fill in your name and birth date', { bad: true });
      if (!$('#parentField').hidden) {
        body.parentEmail = $('#parentEmail').value.trim();
        if (!body.parentEmail) return toast("Enter your parent's email", { bad: true });
      }
      if (skip) body.skip = true;
    }
    const btns = [$('#signinBtn'), $('#skipBtn')];
    btns.forEach((b) => (b.disabled = true));
    try {
      const data = await api('/api/auth/start', body);
      if (data.needSignup) {
        signupMode = true;
        $('#signupFields').hidden = false;
        $('#skipBox').hidden = false;
        $('#signinBtn').textContent = 'CREATE ACCOUNT';
        $('#signinTitle').textContent = 'CREATE ACCOUNT';
        $('#signinSub').textContent = "Welcome! Pick a display name. Don't use your real name.";
        $('#name').focus();
        return;
      }
      if (data.needParent) {
        $('#parentField').hidden = false;
        $('#parentEmail').focus();
        toast("You're under 13, so a parent needs to say OK. Add their email.");
        return;
      }
      if (data.skipped) {
        // signed in already (the cookie came back with this answer)
        const confirmLink = data.devLink;
        toast(`You're in! 🎉 Confirm your email any time from the link we sent to ${body.email}.`, confirmLink ? { actions: [{ label: 'OPEN CONFIRM LINK (DEV)', cls: 'yellow', fn: () => (location.href = confirmLink) }] } : {});
        startApp();
        return;
      }
      $('#signinForm').hidden = true;
      $('#checkEmail').hidden = false;
      $('#sentTo').textContent = body.email;
      if (data.devLink) {
        $('#devLink').hidden = false;
        $('#devLink').href = data.devLink;
      }
    } catch (err) {
      toast(err.message, { bad: true });
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }
  $('#signinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitSignin(false);
  });
  $('#skipBtn').addEventListener('click', () => submitSignin(true));

  $('#resendByEmail').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    if (!email) return toast('Enter your email first', { bad: true });
    try {
      const data = await api('/api/auth/resend-verify', { email });
      toast(`If ${email} has an account waiting to be confirmed, its link is on the way. Check your inbox (and spam).`, data.devLink ? { actions: [{ label: 'OPEN CONFIRM LINK (DEV)', cls: 'yellow', fn: () => (location.href = data.devLink) }] } : {});
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });

  $('#backBtn').addEventListener('click', () => {
    signupMode = false;
    $('#signinForm').hidden = false;
    $('#checkEmail').hidden = true;
    $('#signupFields').hidden = true;
    $('#skipBox').hidden = true;
    $('#signinBtn').textContent = 'CONTINUE';
    $('#signinTitle').textContent = 'SIGN IN';
  });

  $('#rulesLink').addEventListener('click', (e) => {
    e.preventDefault();
    $('#rulesModal').showModal();
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------------------------------------------------------------- app shell
  function setView(view) {
    document.body.classList.remove('show-party', 'show-chat', 'show-voice');
    document.body.classList.add(`show-${view}`);
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  function startApp() {
    $('#signedOut').hidden = true;
    $('#app').hidden = false;
    $('#tabs').hidden = false;
    $('#meChip').hidden = false;
    setView('party');
    socket = io({ transports: ['websocket', 'polling'] });
    voice = new window.VoiceClient(socket, { onSpeaking, onChange: renderVoice, toast });
    socket.on('connect_error', (err) => {
      if (err.message === 'banned') {
        toast('Your account is banned.', { bad: true });
        socket.disconnect();
      } else if (err.message === 'unauthorized') {
        location.href = '/';
      }
    });
    socket.on('disconnect', () => voice.active && voice.leave(false));
    socket.on('state', onState);
    socket.on('room', onRoom);
    socket.on('chat:msg', onMsg);
    socket.on('chat:system', (m) => addSystem(m.text));
    socket.on('party:invite', ({ from, code }) =>
      toast(`🎉 ${from} invited you to their party`, {
        actions: [
          { label: 'JOIN', cls: 'yellow', fn: () => joinParty(code) },
          { label: 'NO THANKS', cls: 'ghost' },
        ],
      }),
    );
  }

  function onState(s) {
    S.me = s.me;
    S.rooms = s.rooms;
    S.history = s.history;
    S.room = s.room;
    S.quick = s.quick || [];
    if (voice.active && voice.roomId !== s.room.id) voice.leave(false);
    voice.setBlocked(S.me.blocked);
    for (const m of s.room.members) S.names.set(m.id, m.name);
    renderVerifyBar();
    renderMe();
    renderRooms();
    renderRoom();
    renderMessages();
  }

  function onRoom(room) {
    if (!S.room || room.id !== S.room.id) return;
    S.room = room;
    for (const m of room.members) S.names.set(m.id, m.name);
    renderRoom();
  }

  function renderRoom() {
    renderParty();
    renderMembers();
    renderVoice();
    const p = S.room.kind === 'party';
    const groupLabel = { teen: 'TEENS', adult: '18+' }[S.me.ageGroup] || '';
    $('#roomTitle').textContent = p ? 'PARTY CHAT' : S.room.kind === 'solo' ? 'CHAT' : `${S.room.title.toUpperCase()} · ${groupLabel}`;
    $('#roomPick').hidden = p || S.room.kind === 'solo';
    renderChatMode();
    renderKid();
  }

  // ---------------------------------------------------------------- typing vs quick chat
  let quickOpen = false;
  function renderChatMode() {
    const solo = S.room.kind === 'solo';
    const typing = S.me.canChat;
    const quick = S.me.canQuick && S.quick.length > 0 && !solo;
    $('#chatForm').hidden = !typing;
    // kids who can't type get the quick chat buttons open all the time
    const quickOnly = !typing && quick;
    $('#quickBar').hidden = !quick;
    $('#quickToggle').hidden = quickOnly;
    $('#quickGrid').hidden = !(quickOnly || quickOpen);
    const locked = $('#chatLocked');
    locked.hidden = typing || (solo && S.me.canQuick);
    if (S.me.typeNeedsEmail) {
      locked.textContent = quickOnly ? '✉️ Confirm your email to type. Quick chat works now!' : '✉️ Confirm your email to type.';
    } else {
      locked.textContent = quickOnly
        ? '⌨️ Typing is off, so use quick chat! A parent can turn typing on after verifying.'
        : '🔒 Chat is off. A parent can turn it on from the parent page.';
    }
    if (quick && !$('#quickGrid').childElementCount) {
      $('#quickGrid').replaceChildren(
        ...S.quick.map((p) =>
          h('button', {
            class: 'quick-chip',
            type: 'button',
            onclick: async () => {
              const r = await emit('chat:quick', { id: p.id });
              if (!r.ok && r.reason) toast(r.reason, { bad: true });
            },
          }, p.text),
        ),
      );
    }
  }
  $('#quickToggle').addEventListener('click', () => {
    quickOpen = !quickOpen;
    renderChatMode();
  });

  // ---------------------------------------------------------------- kids accounts
  function renderKid() {
    const kid = S.me.kid;
    $('#kidLocked').hidden = !(kid && kid.locked);
    $('#kidFriends').hidden = !kid || kid.locked;
    $('#inviteForm').hidden = Boolean(kid);
    if (kid && kid.locked) {
      $('#partyNone').hidden = true;
      $('#partyHint').hidden = true;
    } else if (kid && !S.room.party) {
      $('#partyHint').textContent = 'Create a party, then invite your friends from the list below.';
    }
    if (!kid) return;
    const inParty = Boolean(S.room.party);
    const partyIds = new Set(inParty ? S.room.party.members.map((m) => m.id) : []);
    const rows = [];
    for (const r of kid.requests.filter((x) => x.incoming && !x.accepted)) {
      rows.push(h('li', {},
        h('span', { class: 'nm' }, `👋 ${r.name}`),
        h('button', { class: 'btn yellow', onclick: () => emit('friend:respond', { requestId: r.id, accept: true }).then(() => toast(`Your parents will be asked to OK ${r.name}`)) }, 'ACCEPT'),
        h('button', { class: 'btn ghost', onclick: () => emit('friend:respond', { requestId: r.id, accept: false }) }, 'NO'),
      ));
    }
    for (const r of kid.requests.filter((x) => x.waitingParents || (!x.incoming && !x.accepted))) {
      rows.push(h('li', {},
        h('span', { class: 'nm' }, r.name),
        h('span', { class: 'st' }, r.waitingParents ? 'Waiting for parents ✋' : 'Request sent'),
      ));
    }
    for (const f of kid.friends) {
      rows.push(h('li', {},
        h('span', { class: `dot ${f.online ? 'on' : ''}`, title: f.online ? 'Online' : 'Offline' }),
        h('span', { class: 'nm' }, f.name),
        inParty && f.online && !partyIds.has(f.id)
          ? h('button', { class: 'btn yellow', onclick: () => emit('party:invite', { userId: f.id }).then((r) => toast(r.ok ? `Invite sent to ${f.name}` : r.reason || "Couldn't invite", { bad: !r.ok })) }, 'INVITE')
          : null,
      ));
    }
    if (!rows.length) rows.push(h('li', { class: 'muted' }, 'No friends yet. Add one by name!'));
    $('#friendList').replaceChildren(...rows);
  }

  $('#friendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#friendName').value.trim();
    if (!name) return;
    const r = await emit('friend:request', { name });
    if (r.ok) {
      $('#friendName').value = '';
      toast(`If ${name} has a kids account, they'll get your request 👋`);
    } else toast(r.reason || "Couldn't send", { bad: true });
  });

  $('#resendParent').addEventListener('click', async () => {
    try {
      await api('/api/kid/resend-parent');
      toast('Sent! Ask your parent to check their email (and spam).');
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });

  function renderMe() {
    const chip = $('#meChip');
    chip.replaceChildren(h('span', { class: 'avatar' }, initial(S.me.name)), h('span', { class: 'label' }, S.me.name));
  }

  function renderRooms() {
    $('#roomPick').replaceChildren(
      ...S.rooms.map((r) =>
        h('button', {
          class: r.id === S.room.id ? 'active' : '',
          title: `${r.count} here`,
          onclick: async () => {
            const res = await emit('room:join', { roomId: r.id });
            if (!res.ok && res.reason) toast(res.reason, { bad: true });
          },
        }, `${r.title.replace('Lobby ', 'L')} · ${r.count}`),
      ),
    );
  }

  function statusText(m) {
    if (m.game) return `🎮 ${m.game}`;
    if (m.inVoice) return '🎙️ In voice';
    return '🌐 Online';
  }

  // ---------------------------------------------------------------- party
  function renderParty() {
    const p = S.room.party;
    $('#partyNone').hidden = Boolean(p);
    $('#partyIn').hidden = !p;
    $('#partyCodePill').hidden = !p;
    $('#partyHint').hidden = Boolean(p);
    let members;
    if (p) {
      $('#partyCodePill').textContent = `CODE ${p.code}`;
      members = p.members;
      const meM = members.find((m) => m.id === S.me.id);
      $('#readyBtn').textContent = meM && meM.ready ? 'NOT READY' : 'READY UP';
    } else {
      const self = S.room.members.find((m) => m.id === S.me.id) || { id: S.me.id, name: S.me.name };
      members = [self];
    }
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const m = members[i];
      if (m) {
        slots.push(
          h('div', { class: 'slot', dataset: { uid: m.id }, onclick: (e) => showMenu(m, e) },
            m.leader ? h('span', { class: 'crown', title: 'Party leader' }, '👑') : null,
            m.ready ? h('span', { class: 'ready' }, 'READY') : null,
            h('div', { class: `avatar ${S.speaking.has(m.id) ? 'talk' : ''}` }, initial(m.name)),
            h('div', { class: 'nm' }, m.id === S.me.id ? `${m.name} (you)` : m.name),
            h('div', { class: 'st' }, statusText(m)),
          ),
        );
      } else {
        slots.push(h('div', { class: 'slot empty', onclick: () => p && $('#inviteName').focus() }, '+'));
      }
    }
    $('#slots').replaceChildren(...slots);
  }

  async function joinParty(code) {
    const res = await emit('party:join', { code });
    if (!res.ok) toast(res.reason || "Couldn't join", { bad: true });
  }

  $('#createParty').addEventListener('click', async () => {
    const res = await emit('party:create');
    if (res.ok) toast(`Party created! Share code ${res.code}`);
    else toast(res.reason || "Couldn't create party", { bad: true });
  });
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#joinCode').value.trim();
    if (code) joinParty(code).then(() => ($('#joinCode').value = ''));
  });
  $('#inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#inviteName').value.trim();
    if (!name) return;
    const res = await emit('party:invite', { name });
    if (res.ok) {
      toast(`Invite sent to ${name}`);
      $('#inviteName').value = '';
    } else toast(res.reason || "Couldn't invite", { bad: true });
  });
  $('#readyBtn').addEventListener('click', () => {
    const meM = S.room.party && S.room.party.members.find((m) => m.id === S.me.id);
    emit('party:ready', { ready: !(meM && meM.ready) });
  });
  $('#leaveParty').addEventListener('click', () => emit('party:leave'));
  $('#partyCodePill').addEventListener('click', () => {
    const code = S.room.party && S.room.party.code;
    if (code && navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Party code copied'));
  });

  // ---------------------------------------------------------------- chat
  function msgEl(m) {
    return h('div', { class: `msg ${m.from.id === S.me.id ? 'mine' : ''} ${m.quick ? 'quick-msg' : ''}` },
      h('span', { class: 'who', onclick: (e) => showMenu({ id: m.from.id, name: m.from.name }, e) }, m.from.name),
      h('span', {}, m.text),
      h('span', { class: 'time' }, fmtTime(m.ts)),
    );
  }

  function scrollIfNear(box, force) {
    if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }

  function renderMessages() {
    const box = $('#messages');
    box.replaceChildren(...S.history.filter((m) => !isBlocked(m.from.id)).map(msgEl));
    if (!S.history.length) box.append(h('div', { class: 'msg system' }, S.room.kind === 'party' ? 'Party chat: only your squad can see this.' : S.room.kind === 'solo' ? 'Party up with a friend to chat!' : 'Say hi to the lobby 👋'));
    scrollIfNear(box, true);
  }

  function onMsg(m) {
    if (!S.room || m.room !== S.room.id) return;
    S.history.push(m);
    S.names.set(m.from.id, m.from.name);
    if (isBlocked(m.from.id)) return;
    const box = $('#messages');
    box.append(msgEl(m));
    scrollIfNear(box, m.from.id === S.me.id);
  }

  function addSystem(text) {
    const box = $('#messages');
    box.append(h('div', { class: 'msg system' }, text));
    scrollIfNear(box, true);
  }

  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    $('#sendBtn').textContent = '…';
    const res = await emit('chat:send', { text });
    input.disabled = false;
    $('#sendBtn').textContent = 'SEND';
    if (res.ok) input.value = '';
    else if (res.reason && (!res.category || res.category === 'unavailable')) addSystem(`⚠️ ${res.reason}`);
    input.focus();
  });

  // ---------------------------------------------------------------- members + voice
  function renderMembers() {
    const list = [...S.room.members].sort((a, b) => Number(b.inVoice) - Number(a.inVoice) || a.name.localeCompare(b.name));
    $('#members').replaceChildren(
      ...list.map((m) =>
        h('li', { class: `member ${S.speaking.has(m.id) ? 'speaking' : ''}`, dataset: { uid: m.id }, onclick: (e) => showMenu(m, e) },
          h('span', { class: 'avatar' }, initial(m.name)),
          h('div', { class: 'info' },
            h('div', { class: 'nm' }, m.id === S.me.id ? `${m.name} (you)` : m.name),
            h('div', { class: 'st' }, [statusText(m), m.robloxName ? ` · Roblox: ${m.robloxName}` : ''].join('')),
          ),
          h('div', { class: 'icons' },
            m.inVoice ? h('span', { title: 'In voice' }, '🎙️') : null,
            m.muted ? h('span', { title: 'Muted by moderation' }, '🔇') : null,
            isBlocked(m.id) ? h('span', { title: 'Blocked' }, '⛔') : null,
            voice && voice.localMuted.has(m.id) ? h('span', { title: 'You muted them' }, '🔕') : null,
          ),
        ),
      ),
    );
  }

  function renderVoice() {
    if (!S.room || !voice) return;
    $('#voiceCount').textContent = `${S.room.voiceCount}/${S.room.voiceMax}`;
    const btn = $('#voiceBtn');
    btn.textContent = voice.active ? '📴 LEAVE VOICE' : '🎙️ JOIN VOICE';
    btn.className = `btn big ${voice.active ? 'danger' : 'yellow'}`;
    $('#micBtn').hidden = !voice.active;
    $('#micBtn').textContent = voice.micOn ? '🎤 MIC ON' : '🔇 MIC OFF';
    btn.disabled = !S.me.canVoice && !voice.active;
    let hint = 'Voice is checked for safety: your browser turns your speech into text and an AI moderator reads it. Audio is never recorded.';
    if (S.me.voiceNeedsEmail) hint = '✉️ Confirm your email to use voice chat. The link is in your inbox.';
    else if (!S.me.canVoice) hint = '🔒 Voice chat is off. A parent can turn it on from the parent page.';
    else if (S.me.mutedUntil) {
      const until = new Date(S.me.mutedUntil);
      const far = until - Date.now() > 20 * 3600e3;
      hint = `🔇 You're muted until ${far ? until.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    }
    else if (!window.VoiceClient.canModerate || voice.transcribeFailed) hint = "This browser can't run the voice safety check, so you can listen but not talk. Use Chrome or Safari.";
    $('#voiceHint').textContent = hint;
    renderMembers();
  }

  function onSpeaking(uid, on) {
    if (on) S.speaking.add(uid);
    else S.speaking.delete(uid);
    document.querySelectorAll(`[data-uid="${uid}"]`).forEach((el) => {
      if (el.classList.contains('member')) el.classList.toggle('speaking', on);
      const av = el.querySelector('.avatar');
      if (av) av.style.boxShadow = on ? '0 0 0 3px var(--ok), 0 0 14px var(--ok)' : '';
    });
  }

  $('#voiceBtn').addEventListener('click', async () => {
    if (voice.active) return voice.leave(true);
    try {
      // strict moderation: everyone's speech is checked, in parties too (no check = listen only)
      await voice.join({ myId: S.me.id, roomId: S.room.id, requireTranscript: true, mutedUntil: S.me.mutedUntil });
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? 'Allow microphone access to join voice' : err.message, { bad: true });
    }
  });
  $('#micBtn').addEventListener('click', () => voice.setMic(!voice.micOn));

  // ---------------------------------------------------------------- player menu
  const menu = $('#playerMenu');
  function hideMenu() {
    menu.hidden = true;
  }
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) hideMenu();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hideMenu());

  function showMenu(user, e) {
    e.stopPropagation();
    if (!S.me || user.id === S.me.id) return;
    const p = S.room.party;
    const inMyParty = p && p.members.some((m) => m.id === user.id);
    const iLead = p && p.leaderId === S.me.id;
    const items = [h('div', { class: 'title' }, user.name)];
    const add = (label, fn, bad) => items.push(h('button', { class: bad ? 'bad' : '', onclick: () => { hideMenu(); fn(); } }, label));
    if (p && !inMyParty) add('🎉 Invite to party', async () => {
      const r = await emit('party:invite', { name: user.name });
      toast(r.ok ? `Invite sent to ${user.name}` : r.reason || "Couldn't invite", { bad: !r.ok });
    });
    if (inMyParty && iLead) {
      add('👑 Make leader', () => emit('party:promote', { userId: user.id }));
      add('🚪 Kick from party', () => emit('party:kick', { userId: user.id }), true);
    }
    add(voice.localMuted.has(user.id) ? '🔔 Unmute for me' : '🔕 Mute for me', () => {
      voice.toggleLocalMute(user.id);
      renderMembers();
    });
    const blocked = isBlocked(user.id);
    add(blocked ? '✅ Unblock' : '⛔ Block', async () => {
      await emit('user:block', { userId: user.id, block: !blocked });
      toast(blocked ? `Unblocked ${user.name}` : `Blocked ${user.name}. You won't see or hear them.`);
    }, !blocked);
    add('🚩 Report', async () => {
      const reason = prompt(`Why are you reporting ${user.name}?`);
      if (reason === null) return;
      const r = await emit('user:report', { userId: user.id, reason });
      toast(r.ok ? 'Thanks. A moderator will look at it.' : "Couldn't send the report", { bad: !r.ok });
    }, true);
    menu.replaceChildren(...items);
    menu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 190);
    const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  // ---------------------------------------------------------------- profile
  $('#meChip').addEventListener('click', () => {
    renderProfile();
    $('#profile').showModal();
  });

  function renderProfile() {
    const me = S.me;
    $('#pName').textContent = me.name.toUpperCase();
    $('#pEmail').textContent = me.emailVerified ? me.email : `${me.email || ''} (not confirmed yet)`;
    const st = { matches: 0, wins: 0, kills: 0, best: null, ...me.stats };
    $('#pStats').replaceChildren(
      ...[['WINS', st.wins], ['ELIMS', st.kills], ['MATCHES', st.matches], ['BEST', st.best ? `#${st.best}` : '–']].map(([k, v]) =>
        h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, k)),
      ),
    );
    $('#robloxLinked').hidden = !me.robloxName;
    $('#robloxStart').hidden = Boolean(me.robloxName);
    if (me.robloxName) {
      $('#robloxName').textContent = me.robloxName;
      $('#robloxVerify').hidden = true;
    }
    $('#blockedList').replaceChildren(
      ...(me.blocked.length
        ? me.blocked.map((id) =>
          h('li', {}, S.names.get(id) || `Player #${id}`, h('button', { class: 'btn tiny ghost', onclick: () => emit('user:block', { userId: id, block: false }).then(renderProfile) }, 'UNBLOCK')),
        )
        : [h('li', { class: 'muted' }, 'Nobody blocked')]),
    );
    $('#adminLink').hidden = !me.isAdmin;
  }

  $('#robloxForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/roblox/start', { username: $('#robloxUser').value.trim() });
      $('#robloxCode').textContent = data.code;
      $('#robloxVerify').hidden = false;
      toast(`Found ${data.robloxName}. Add the code to your Roblox About.`);
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });
  $('#copyCode').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText($('#robloxCode').textContent).then(() => toast('Code copied')));
  $('#verifyRoblox').addEventListener('click', async () => {
    try {
      const data = await api('/api/roblox/verify');
      toast(`Linked to ${data.robloxName}! 🎮`);
      $('#robloxVerify').hidden = true;
      setTimeout(renderProfile, 400);
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });
  $('#unlinkRoblox').addEventListener('click', async () => {
    await api('/api/roblox/unlink');
    setTimeout(renderProfile, 400);
  });
  // ---------------------------------------------------------------- confirm email ("skip for now" accounts)
  function renderVerifyBar() {
    const need = S.me && !S.me.emailVerified;
    $('#verifyBar').hidden = !need;
    document.body.classList.toggle('has-verify', Boolean(need));
    if (need) $('#verifyTo').textContent = S.me.email || 'your email';
  }
  $('#resendVerify').addEventListener('click', async () => {
    try {
      const data = await api('/api/auth/resend-verify');
      toast('Sent! Check your inbox (and spam) and tap the link.', data.devLink ? { actions: [{ label: 'OPEN CONFIRM LINK (DEV)', cls: 'yellow', fn: () => (location.href = data.devLink) }] } : {});
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });

  $('#changeEmail').addEventListener('click', async () => {
    const email = prompt('Which email should we send the confirm link to?', S.me.email || '');
    if (!email || !email.trim()) return;
    try {
      const data = await api('/api/auth/change-email', { email: email.trim() });
      toast(`Sent a new confirm link to ${email.trim()}.`, data.devLink ? { actions: [{ label: 'OPEN CONFIRM LINK (DEV)', cls: 'yellow', fn: () => (location.href = data.devLink) }] } : {});
    } catch (err) {
      toast(err.message, { bad: true });
    }
  });

  $('#logout').addEventListener('click', async () => {
    // without a confirmed email, the confirm link is the only way back into this account
    if (S.me && !S.me.emailVerified && !confirm("Your email isn't confirmed yet. After signing out, you can only get back in with the confirm link we emailed you. Sign out anyway?")) return;
    if (voice && voice.active) voice.leave(true);
    await api('/api/auth/logout');
    location.href = '/';
  });

  // ---------------------------------------------------------------- boot
  (async function boot() {
    const q = new URLSearchParams(location.search);
    const err = q.get('error');
    if (err) {
      const msgs = {
        link: 'That link expired or was already used.',
        name: 'That name was taken. Pick another.',
        emailtaken: 'That email is already confirmed on another Storm Royale account. Sign in with it to use that account, or confirm a different email.',
      };
      toast(msgs[err] || 'Something went wrong.', { bad: true });
      history.replaceState(null, '', '/');
    } else if (q.get('verified') === '1') {
      toast('✅ Email confirmed! Typing and voice are unlocked.');
      history.replaceState(null, '', '/');
    }
    const res = await fetch('/api/me');
    if (res.ok) {
      startApp();
      // /?profile=1 (from the locker page): open the profile once the account has loaded
      if (q.get('profile') === '1') {
        history.replaceState(null, '', '/');
        const open = () => (S.me ? ($('#meChip').click()) : setTimeout(open, 200));
        open();
      }
    } else showSignIn();
  })();
})();
