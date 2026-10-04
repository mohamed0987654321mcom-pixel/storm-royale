// Voice chat: WebRTC mesh (everyone connects to everyone in the room; the server only relays
// connection setup). For safety, the browser's speech recognition turns your own speech into
// text and sends only that text to the server, where the AI moderator checks it.
(function () {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SPEAK_LEVEL = 0.035;

  class VoiceClient {
    constructor(socket, hooks) {
      this.socket = socket;
      this.hooks = hooks; // { onSpeaking(uid, on), onChange(), toast(text, opts) }
      this.peers = new Map(); // uid -> { pc, audio, pending: [] }
      this.levels = new Map(); // uid -> { timer, speaking }
      this.localMuted = new Set(); // people you muted or blocked
      this.serverMuted = new Map(); // uid -> until (ms)
      this.active = false;
      this.micOn = true;
      this.stream = null;
      this.ctx = null;
      this.recognizer = null;
      this.transcribeFailed = false;

      socket.on('voice:peer-left', ({ userId }) => this.dropPeer(userId));
      socket.on('voice:signal', (m) => this.onSignal(m).catch((e) => console.warn('voice signal', e)));
      socket.on('voice:muted', ({ userId, until }) => this.onServerMute(userId, until));
    }

    static get canModerate() {
      return Boolean(SpeechRec);
    }

    get canTalk() {
      if (!this.active || !this.micOn) return false;
      if (this.isServerMuted(this.myId)) return false;
      if (this.requireTranscript && (!SpeechRec || this.transcribeFailed)) return false;
      return true;
    }

    isServerMuted(uid) {
      const until = this.serverMuted.get(uid);
      return Boolean(until && until > Date.now());
    }

    async join({ myId, roomId, requireTranscript, mutedUntil }) {
      if (this.active) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
        throw new Error("This browser can't do voice chat");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      await this.ctx.resume().catch(() => {});
      const res = await new Promise((resolve) => this.socket.emit('voice:join', {}, resolve));
      if (!res || !res.ok) {
        this.cleanup();
        throw new Error((res && res.reason) || 'Could not join voice');
      }
      this.active = true;
      this.myId = myId;
      this.roomId = roomId;
      this.requireTranscript = requireTranscript;
      this.transcribeFailed = false;
      this.iceServers = res.iceServers || [];
      if (mutedUntil) this.serverMuted.set(myId, new Date(mutedUntil).getTime());
      this.watchLevel(myId, this.stream);
      this.applyMic();
      for (const uid of res.peers) this.call(uid);
      this.hooks.onChange();
    }

    leave(notifyServer = true) {
      if (!this.active) return;
      if (notifyServer) this.socket.emit('voice:leave', {}, () => {});
      this.cleanup();
      this.hooks.onChange();
    }

    cleanup() {
      this.active = false;
      for (const uid of [...this.peers.keys()]) this.dropPeer(uid);
      for (const uid of [...this.levels.keys()]) this.stopLevel(uid);
      this.stopTranscribe();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = null;
    }

    setMic(on) {
      this.micOn = on;
      this.applyMic();
      this.hooks.onChange();
    }

    applyMic() {
      const can = this.canTalk;
      if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = can));
      if (can) this.startTranscribe();
      else this.stopTranscribe();
    }

    setBlocked(ids) {
      this.blocked = new Set(ids || []);
      this.refreshPeerVolumes();
    }

    toggleLocalMute(uid) {
      if (this.localMuted.has(uid)) this.localMuted.delete(uid);
      else this.localMuted.add(uid);
      this.refreshPeerVolumes();
      return this.localMuted.has(uid);
    }

    isPeerMuted(uid) {
      return this.localMuted.has(uid) || (this.blocked && this.blocked.has(uid)) || this.isServerMuted(uid);
    }

    refreshPeerVolumes() {
      for (const [uid, p] of this.peers) if (p.audio) p.audio.muted = this.isPeerMuted(uid);
    }

    onServerMute(uid, until) {
      const t = new Date(until).getTime();
      this.serverMuted.set(uid, t);
      this.refreshPeerVolumes();
      if (uid === this.myId) this.applyMic();
      setTimeout(() => {
        this.refreshPeerVolumes();
        if (uid === this.myId) this.applyMic();
        this.hooks.onChange();
      }, Math.max(0, t - Date.now()) + 500);
      this.hooks.onChange();
    }

    // ------------------------------------------------------------ peers
    send(to, data) {
      this.socket.emit('voice:signal', { to, data });
    }

    makePeer(uid) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      const peer = { pc, audio: null, pending: [] };
      this.peers.set(uid, peer);
      for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
      pc.onicecandidate = (e) => {
        if (e.candidate) this.send(uid, { candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        if (!peer.audio) {
          peer.audio = new Audio();
          peer.audio.autoplay = true;
          document.getElementById('audioSink').append(peer.audio);
        }
        peer.audio.srcObject = e.streams[0];
        peer.audio.muted = this.isPeerMuted(uid);
        peer.audio.play().catch(() => {});
        this.watchLevel(uid, e.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          this.hooks.toast("Couldn't connect voice to someone (their network may block it)", { bad: true });
        }
      };
      return peer;
    }

    async call(uid) {
      const peer = this.makePeer(uid);
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send(uid, { sdp: peer.pc.localDescription });
    }

    async onSignal({ from, data }) {
      if (!this.active || !data) return;
      let peer = this.peers.get(from);
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (peer) this.dropPeer(from);
          peer = this.makePeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          await this.flush(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.send(from, { sdp: peer.pc.localDescription });
        } else if (peer) {
          await peer.pc.setRemoteDescription(data.sdp);
          await this.flush(peer);
        }
      } else if (data.candidate && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    }

    async flush(peer) {
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    }

    dropPeer(uid) {
      const peer = this.peers.get(uid);
      if (!peer) return;
      peer.pc.close();
      if (peer.audio) {
        peer.audio.srcObject = null;
        peer.audio.remove();
      }
      this.peers.delete(uid);
      this.stopLevel(uid);
    }

    // ------------------------------------------------------------ speaking indicators
    watchLevel(uid, stream) {
      if (!this.ctx) return;
      this.stopLevel(uid);
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const state = { speaking: false, last: 0 };
      state.timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        const loud = rms > SPEAK_LEVEL && !(uid === this.myId ? !this.canTalk : this.isPeerMuted(uid));
        if (loud) state.last = now;
        const speaking = now - state.last < 350;
        if (speaking !== state.speaking) {
          state.speaking = speaking;
          this.hooks.onSpeaking(uid, speaking);
        }
      }, 100);
      this.levels.set(uid, state);
    }

    stopLevel(uid) {
      const s = this.levels.get(uid);
      if (!s) return;
      clearInterval(s.timer);
      if (s.speaking) this.hooks.onSpeaking(uid, false);
      this.levels.delete(uid);
    }

    // ------------------------------------------------------------ safety transcription
    startTranscribe() {
      if (!SpeechRec || this.recognizer || this.transcribeFailed) return;
      const r = new SpeechRec();
      r.continuous = true;
      r.interimResults = false;
      r.lang = navigator.language || 'en-US';
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            const text = res[0].transcript.trim();
            if (text) this.socket.emit('voice:transcript', { text });
          }
        }
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.transcribeFailed = true;
          if (this.requireTranscript) {
            this.hooks.toast('Voice safety check is blocked in this browser, so your mic is off in open rooms. Party voice still works.', { bad: true });
            this.applyMic();
            this.hooks.onChange();
          }
        }
      };
      r.onend = () => {
        if (this.recognizer === r) this.recognizer = null;
        if (this.canTalk) setTimeout(() => this.startTranscribe(), 250);
      };
      this.recognizer = r;
      try {
        r.start();
      } catch {
        this.recognizer = null;
      }
    }

    stopTranscribe() {
      const r = this.recognizer;
      this.recognizer = null;
      if (r) {
        r.onend = null;
        try {
          r.stop();
        } catch {}
      }
    }
  }

  window.VoiceClient = VoiceClient;
})();
