/* Anydrop — no build step. PeerJS supplies signaling; WebRTC carries files directly. */
(() => {
  "use strict";
  const MAX_TOTAL = 100 * 1024 * 1024;
  const CHUNK = 32 * 1024;
  const WINDOW = 8;
  const els = {
    app: document.getElementById("app"),
    status: document.getElementById("connection-status"),
    indicator: document.getElementById("status-indicator"),
    footer: document.getElementById("footer-description"),
    disconnect: document.getElementById("disconnect-button"),
    input: document.getElementById("file-input"),
    canvas: document.getElementById("scan-canvas"),
    toast: document.getElementById("toast"),
    sound: document.getElementById("sound-toggle")
  };
  const state = {
    phase: "loading", peer: null, peerId: null, conn: null, remoteId: null,
    selected: [], offer: null, incoming: null, received: [],
    sentBytes: 0, receivedBytes: 0, total: 0,
    recvParts: [], recvSizes: [], recvChunks: 0,
    aborted: false, pendingAck: null, camera: null, scannerFrame: 0,
    muted: localStorage.getItem("anydrop-muted") === "1", error: ""
  };
  const svg = {
    share: '<path d="M12 16V3m0 0-4 4m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    camera: '<path d="M14 4h-4l-2 3H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="13" r="4"/>',
    upload: '<path d="M12 16V3m0 0-4 4m4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 3v13m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (svg[name] || svg.check) + "</svg>"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function formatBytes(n) { if (!n) return "0 B"; const units = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return (n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + " " + units[i]; }
  function action(label, event, kind = "primary", glyph = "") { return '<button class="button ' + kind + '" type="button" data-action="' + event + '">' + (glyph ? icon(glyph) : "") + esc(label) + "</button>"; }
  function actions(...contents) { return '<div class="actions">' + contents.join("") + "</div>"; }
  function symbol(glyph, modifier = "") { return '<div class="symbol ' + modifier + '">' + icon(glyph) + "</div>"; }
  function title(h, p) { return "<h1>" + esc(h) + "</h1><p>" + esc(p) + "</p>"; }
  function fileList(files) {
    if (!files.length) return "";
    const rows = files.slice(0, 4).map(f => '<div class="file-row"><span class="file-icon">' + icon("download") + '</span><span class="file-detail"><span class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="file-meta">' + formatBytes(f.size) + "</span></span></div>").join("");
    return '<div class="files">' + rows + (files.length > 4 ? '<div class="files-more">+' + (files.length - 4) + " more files</div>" : "") + "</div>";
  }
  function progress() {
    const amount = state.phase === "sending" || state.phase === "delivered" ? state.sentBytes : state.receivedBytes;
    const percent = state.total ? Math.min(100, Math.floor(amount / state.total * 100)) : 100;
    return '<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" aria-label="Transfer progress"><div class="progress-fill" style="width:' + percent + '%"></div></div><div class="progress-label"><strong>' + percent + '%</strong><span>' + formatBytes(amount) + ' / ' + formatBytes(state.total) + "</span></div>";
  }
  function flash(s) {
    els.toast.textContent = s;
    els.toast.classList.add("visible");
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => els.toast.classList.remove("visible"), 3800);
  }
  function tone(kind) {
    if (state.muted) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC(), now = ctx.currentTime;
      const seq = {
        connected: [[523, 0, .09], [784, .11, .16]],
        request: [[659, 0, .11], [880, .14, .12]],
        success: [[523, 0, .09], [659, .12, .09], [784, .24, .17]],
        error: [[360, 0, .13], [280, .17, .18]]
      }[kind] || [];
      seq.forEach(([frequency, start, length]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(.045, now + start + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, now + start + length);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + start); osc.stop(now + start + length + .01);
      });
      setTimeout(() => ctx.close(), 900);
    } catch (_) {}
  }
  function setPhase(phase, error = "") { if (state.phase === "scan" && phase !== "scan") stopCamera(); state.phase = phase; state.error = error; render(); }
  function connected() { return Boolean(state.conn && state.conn.open); }
  function inviteUrl() { const url = new URL(location.pathname, location.origin); url.searchParams.set("peer", state.peerId); return url.href; }
  function validPeer(raw) { return typeof raw === "string" && /^ad-[a-z0-9-]{16,80}$/i.test(raw); }
  function parseInvite(input) {
    try {
      const url = new URL(input.trim(), location.href);
      if (url.origin !== location.origin || url.pathname.replace(/index\.html$/, "") !== location.pathname.replace(/index\.html$/, "")) return null;
      const id = url.searchParams.get("peer");
      return validPeer(id) ? id : null;
    } catch (_) { return null; }
  }
  function cleanAddress() { history.replaceState(null, "", location.pathname + location.hash); }
  function render() {
    els.status.textContent = {
      loading: "Preparing connection", home: "Ready to connect", scan: "Scanning for a device",
      connecting: "Connecting devices", connected: "Connected to another device",
      selected: "Connected", awaiting: "Waiting for acceptance", incoming: "Incoming transfer request",
      sending: "Sending files", receiving: "Receiving files", delivered: "Files delivered",
      received: "Files received", saving: "Preparing download", done: "Connected",
      error: "Connection error", disconnected: "Disconnected"
    }[state.phase] || "Connected";
    els.indicator.className = "status-indicator" + (connected() ? " online" : state.phase === "error" ? " error" : ["loading", "connecting"].includes(state.phase) ? " warning" : "");
    els.disconnect.classList.toggle("hidden", !connected());
    els.footer.textContent = connected() ? "Private peer-to-peer session" : "No account or app required";
    els.sound.querySelector(".sound-label").textContent = state.muted ? "Sound off" : "Sound on";
    els.sound.setAttribute("aria-label", state.muted ? "Turn sounds on" : "Turn sounds off");

    let html = "";
    switch (state.phase) {
      case "loading":
        html = '<div class="spinner" aria-hidden="true"></div>' + title("Getting ready…", "Preparing your connection link.");
        break;
      case "home":
        html = title("Share files between devices", "Anyone can send or receive. No account, no app.") +
          '<div class="qr-card"><div id="qr" aria-label="QR code containing your pairing link"></div></div>' +
          actions(action("Share link", "share", "primary", "share"), action("Scan QR code", "scan", "secondary", "camera")) +
          '<p class="helper">Have another device scan your code, or share a link.</p>';
        break;
      case "scan":
        html = title("Scan QR code", "Point your camera at the code on the other device.") +
          '<video class="scan-video" id="scan-video" autoplay muted playsinline aria-label="Camera preview"></video>' +
          actions(action("Cancel scanning", "home", "secondary", "close")) +
          '<form class="join-form" id="join-form"><label class="join-label" for="join-link">Or paste a pairing link</label><input id="join-link" type="url" inputmode="url" autocomplete="off" placeholder="https://…/anydrop/?peer=…"><button class="button secondary" type="submit">Connect with link</button></form>';
        break;
      case "connecting":
        html = '<div class="spinner" aria-hidden="true"></div>' + title("Connecting…", "Establishing a secure connection with the other device.") +
          actions(action("Cancel", "cancel-connect", "secondary", "close"));
        break;
      case "connected":
        html = symbol("check", "success") + '<span class="connected-pill">Connected</span>' +
          title("Ready to share", "Choose files to send. You can receive files at any time.") +
          actions(action("Choose files", "choose", "primary", "upload")) +
          '<p class="helper">Or drag files anywhere onto this page.</p>';
        break;
      case "selected":
        html = symbol("upload") + title("Ready to send", "Review the files before requesting a transfer.") +
          fileList(state.selected) + '<span class="summary">' + state.selected.length + ' file' + (state.selected.length === 1 ? "" : "s") + ' · ' + formatBytes(state.total) + "</span>" +
          actions(action("Send " + (state.selected.length === 1 ? "file" : "files"), "offer", "primary", "upload"), action("Choose different files", "choose", "secondary"));
        break;
      case "awaiting":
        html = symbol("upload") + title("Waiting for acceptance", "The other device must accept before files are transferred.") + fileList(state.selected) +
          actions(action("Cancel request", "cancel", "secondary", "close"));
        break;
      case "incoming":
        html = symbol("download") + title("Incoming files", "The other device would like to send you these files.") +
          fileList(state.incoming.files) + '<span class="summary">' + formatBytes(state.incoming.total) + " total</span>" +
          actions(action("Accept files", "accept", "primary", "download"), action("Decline", "decline", "secondary", "close"));
        break;
      case "sending":
        html = symbol("upload") + title("Sending files…", "Keep this page open while the transfer completes.") +
          progress() + actions(action("Cancel transfer", "cancel", "secondary", "close"));
        break;
      case "receiving":
        html = symbol("download") + title("Receiving files…", "Keep this page open until all files arrive.") +
          progress() + actions(action("Cancel transfer", "cancel", "secondary", "close"));
        break;
      case "delivered":
        html = symbol("check", "success") + title("Files received", "The other device has the complete files. Waiting for its download to start.") +
          fileList(state.selected) + actions(action("Send more files", "choose", "primary", "upload"));
        break;
      case "received":
        html = symbol("check", "success") + title("Files received", "All files are here. Save them to your device.") +
          fileList(state.incoming.files) +
          actions(action(state.received.length > 1 ? "Download ZIP" : "Save file", "save", "primary", "download"));
        break;
      case "saving":
        html = '<div class="spinner" aria-hidden="true"></div>' + title("Preparing download…", "Your browser will handle the save destination.");
        break;
      case "done":
        html = symbol("check", "success") + title("Download started", "The files have been handed to your browser for saving.") +
          actions(action("Send files", "choose", "primary", "upload")) +
          '<p class="helper">Still connected · Ready to receive more files.</p>';
        break;
      case "disconnected":
        html = symbol("link") + title("Device disconnected", "The other browser has left the session.") +
          actions(action("Start a new session", "home", "primary", "share"));
        break;
      case "error":
        html = symbol("close", "problem") + title("Couldn't connect", state.error || "The session could not be established.") +
          actions(action("Try again", "retry", "primary", "link"), action("Start a new session", "home", "secondary"));
        break;
    }
    els.app.innerHTML = html;
    if (state.phase === "home") {
      if (typeof QRCode === "function" && state.peerId) {
        new QRCode(document.getElementById("qr"), { text: inviteUrl(), width: 154, height: 154, colorDark: "#18243a", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.M });
      } else {
        document.getElementById("qr").textContent = "QR unavailable";
      }
    }
  }
  function clearTransfer() {
    state.selected = []; state.offer = null; state.incoming = null; state.received = [];
    state.recvParts = []; state.recvSizes = []; state.recvChunks = 0;
    state.sentBytes = 0; state.receivedBytes = 0; state.total = 0; state.aborted = false;
    if (state.pendingAck) { clearTimeout(state.pendingAck.timer); state.pendingAck.resolve(false); state.pendingAck = null; }
  }
  function send(msg) { if (!connected()) throw new Error("Connection lost"); state.conn.send(msg); }
  function localId() { return "ad-" + crypto.randomUUID(); }
  function setupPeer() {
    if (typeof Peer !== "function") { setPhase("error", "The connection service could not load. Check your connection and reload."); return; }
    state.peer = new Peer(localId(), { debug: 0 });
    state.peer.on("open", id => {
      state.peerId = id;
      const incomingId = new URLSearchParams(location.search).get("peer");
      if (validPeer(incomingId) && incomingId !== id) connectTo(incomingId);
      else { cleanAddress(); setPhase("home"); }
    });
    state.peer.on("connection", c => {
      if (connected() || (state.conn && state.conn !== c)) { c.on("open", () => c.close()); return; }
      bindConnection(c);
    });
    state.peer.on("error", err => {
      if (state.phase === "error") return;
      console.warn("Peer connection:", err.type || err.message);
      setPhase("error", err.type === "peer-unavailable" ? "The other device is no longer available. Ask for a fresh link." : "A connection error occurred. Please retry.");
      tone("error");
    });
    state.peer.on("disconnected", () => {
      if (state.peer && !state.peer.destroyed && !state.peer.open) {
        try { state.peer.reconnect(); } catch (_) {}
      }
    });
  }
  function bindConnection(c) {
    state.conn = c;
    state.remoteId = c.peer;
    setPhase("connecting");
    c.on("open", () => {
      if (state.conn !== c) return;
      cleanAddress();
      clearTransfer();
      setPhase("connected");
      tone("connected");
      send({ t: "hello", version: 1 });
    });
    c.on("data", data => { if (state.conn === c) handleMessage(data); });
    c.on("close", () => {
      if (state.conn !== c) return;
      state.aborted = true;
      if (state.pendingAck) { clearTimeout(state.pendingAck.timer); state.pendingAck.resolve(false); state.pendingAck = null; }
      state.conn = null; state.remoteId = null; clearTransfer();
      setPhase("disconnected");
      tone("error");
    });
    c.on("error", err => { console.warn("Data channel:", err); if (state.conn === c) setPhase("error", "The connection was interrupted."); });
  }
  function connectTo(id) {
    if (!validPeer(id) || id === state.peerId) { flash("That doesn't look like a valid pairing link."); return; }
    stopCamera();
    if (connected()) { flash("Disconnect first to join another device."); return; }
    setPhase("connecting");
    try { bindConnection(state.peer.connect(id, { reliable: true, serialization: "binary" })); }
    catch (_) { setPhase("error", "Could not start the connection."); }
  }
  function handleMessage(d) {
    if (!d || typeof d !== "object") return;
    switch (d.t) {
      case "hello": break;
      case "offer": {
        if (["incoming", "receiving", "sending", "awaiting", "received", "saving"].includes(state.phase)) {
          send({ t: "busy", oid: d.oid }); return;
        }
        if (!Array.isArray(d.files) || !d.files.length || d.files.length > 100 ||
          d.files.some(f => typeof f.name !== "string" || f.name.length > 255 || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_TOTAL) ||
          d.files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL || typeof d.oid !== "string") {
          send({ t: "decline", oid: d.oid }); return;
        }
        clearTransfer();
        state.incoming = { oid: d.oid, files: d.files, total: d.files.reduce((sum, f) => sum + f.size, 0) };
        state.total = state.incoming.total;
        setPhase("incoming"); tone("request"); break;
      }
      case "accept":
        if (state.phase === "awaiting" && state.offer?.oid === d.oid) { setPhase("sending"); transferFiles(d.oid); }
        break;
      case "decline":
        if (state.offer?.oid === d.oid && state.phase === "awaiting") { clearTransfer(); setPhase("connected"); flash("The other device declined the transfer."); tone("error"); }
        break;
      case "busy":
        if (state.offer?.oid === d.oid && state.phase === "awaiting") { clearTransfer(); setPhase("connected"); flash("The other device is busy. Try again in a moment."); }
        break;
      case "cancel":
        if ((state.incoming?.oid === d.oid) || (state.offer?.oid === d.oid)) {
          state.aborted = true; clearTransfer(); setPhase("connected"); flash("Transfer cancelled by the other device.");
        }
        break;
      case "chunk":
        receiveChunk(d);
        break;
      case "flush":
        if (state.phase === "receiving" && state.incoming?.oid === d.oid) send({ t: "ack", oid: d.oid, received: state.receivedBytes });
        break;
      case "ack":
        if (state.offer?.oid === d.oid && state.pendingAck) {
          state.sentBytes = Math.min(state.total, Number(d.received) || 0);
          const pending = state.pendingAck; state.pendingAck = null; clearTimeout(pending.timer); pending.resolve(true); render();
        }
        break;
      case "done":
        if (state.phase === "receiving" && state.incoming?.oid === d.oid) finishReceive(d.oid);
        break;
      case "complete":
        if (state.phase === "sending" && state.offer?.oid === d.oid) { state.sentBytes = state.total; setPhase("delivered"); tone("success"); }
        break;
      case "saved":
        if (state.offer?.oid === d.oid && state.phase === "delivered") { setPhase("connected"); flash("The receiving device started its download."); }
        break;
      case "fail":
        if (state.offer?.oid === d.oid || state.incoming?.oid === d.oid) { state.aborted = true; clearTransfer(); setPhase("connected"); flash("Transfer failed. Please try again."); tone("error"); }
        break;
    }
  }
  function receiveChunk(d) {
    if (state.phase !== "receiving" || state.incoming?.oid !== d.oid) return;
    const file = state.incoming.files[d.i];
    if (!file || !Number.isInteger(d.i) || d.i < 0) return;
    const part = d.bytes instanceof Uint8Array ? d.bytes :
      d.bytes instanceof ArrayBuffer ? new Uint8Array(d.bytes) :
      ArrayBuffer.isView(d.bytes) ? new Uint8Array(d.bytes.buffer, d.bytes.byteOffset, d.bytes.byteLength) : null;
    if (!part || part.byteLength > CHUNK || state.recvSizes[d.i] + part.byteLength > file.size || state.receivedBytes + part.byteLength > state.total) {
      send({ t: "fail", oid: d.oid }); cancelTransfer(false); return;
    }
    state.recvParts[d.i].push(part);
    state.recvSizes[d.i] += part.byteLength;
    state.receivedBytes += part.byteLength;
    state.recvChunks++;
    if (state.recvChunks % 8 === 0) render();
  }
  function finishReceive(oid) {
    if (state.recvSizes.some((size, i) => size !== state.incoming.files[i].size)) {
      send({ t: "fail", oid }); cancelTransfer(false); flash("The received files were incomplete."); return;
    }
    state.received = state.incoming.files.map((f, i) => ({
      name: f.name, size: f.size, type: f.type,
      blob: new Blob(state.recvParts[i], { type: f.type || "application/octet-stream" })
    }));
    state.recvParts = [];
    state.receivedBytes = state.total;
    send({ t: "complete", oid });
    setPhase("received"); tone("success");
  }
  function ackPromise() {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        state.pendingAck = null; resolve(false);
      }, 30000);
      state.pendingAck = { resolve, timer };
    });
  }
  async function transferFiles(oid) {
    try {
      for (let i = 0; i < state.selected.length; i++) {
        const f = state.selected[i];
        for (let pos = 0; pos < f.size || (f.size === 0 && pos === 0); ) {
          if (state.aborted || state.offer?.oid !== oid || !connected()) return;
          const promise = ackPromise();
          let count = 0;
          while (count < WINDOW && pos < f.size) {
            const end = Math.min(pos + CHUNK, f.size);
            const bytes = new Uint8Array(await f.slice(pos, end).arrayBuffer());
            if (state.aborted || state.offer?.oid !== oid || !connected()) return;
            send({ t: "chunk", oid, i, bytes });
            pos = end; count++;
          }
          send({ t: "flush", oid });
          if (!(await promise)) throw new Error("Transfer acknowledgment timed out");
          if (f.size === 0) break;
        }
      }
      if (!state.aborted && state.offer?.oid === oid) send({ t: "done", oid });
    } catch (err) {
      console.warn("Transfer error:", err);
      try { send({ t: "fail", oid }); } catch (_) {}
      if (state.offer?.oid === oid) { clearTransfer(); setPhase("connected"); flash("Transfer interrupted. Please try again."); tone("error"); }
    }
  }
  function cancelTransfer(notify = true) {
    const oid = state.offer?.oid || state.incoming?.oid;
    if (notify && oid && connected()) { try { send({ t: "cancel", oid }); } catch (_) {} }
    state.aborted = true;
    clearTransfer(); setPhase(connected() ? "connected" : "home");
  }
  function chooseFiles(files) {
    if (!connected()) { flash("Connect to another device first."); return; }
    const picked = Array.from(files || []);
    if (!picked.length) return;
    const total = picked.reduce((sum, f) => sum + f.size, 0);
    if (picked.length > 100 || total > MAX_TOTAL) { flash("For this version, choose up to 100 files totaling 100 MB."); return; }
    if (state.phase === "receiving" || state.phase === "incoming" || state.phase === "sending" || state.phase === "awaiting" || state.phase === "saving") { flash("Finish the current transfer first."); return; }
    clearTransfer();
    state.selected = picked; state.total = total;
    setPhase("selected");
  }
  function startOffer() {
    if (state.phase !== "selected" || !state.selected.length) return;
    const oid = crypto.randomUUID();
    state.offer = { oid };
    const files = state.selected.map(f => ({ name: f.name, size: f.size, type: f.type || "" }));
    try { send({ t: "offer", oid, files }); setPhase("awaiting"); }
    catch (_) { setPhase("error", "The other device is no longer connected."); }
  }
  function acceptOffer() {
    if (state.phase !== "incoming") return;
    state.recvParts = state.incoming.files.map(() => []);
    state.recvSizes = state.incoming.files.map(() => 0);
    state.receivedBytes = 0;
    state.recvChunks = 0;
    state.aborted = false;
    setPhase("receiving");
    send({ t: "accept", oid: state.incoming.oid });
  }
  function safeName(name) { return name.replace(/[\\/\u0000-\u001f]/g, "_").replace(/^\.+$/, "file") || "file"; }
  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = objectUrl; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  async function saveFiles() {
    if (state.phase !== "received" || !state.received.length) return;
    const saved = state.received;
    setPhase("saving");
    try {
      if (saved.length === 1) downloadBlob(saved[0].blob, safeName(saved[0].name));
      else {
        if (typeof JSZip !== "function") throw new Error("ZIP support could not load");
        const zip = new JSZip();
        saved.forEach((f, i) => zip.file(String(i + 1).padStart(2, "0") + "-" + safeName(f.name), f.blob));
        const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
        downloadBlob(blob, "anydrop-files.zip");
      }
      if (connected()) send({ t: "saved", oid: state.incoming.oid });
      setPhase("done");
      flash("Download started. Check your browser's download destination.");
    } catch (err) {
      console.warn("Download:", err);
      setPhase("received");
      flash("Couldn't prepare the download. Please try again.");
    }
  }
  async function shareLink() {
    if (!state.peerId) return;
    const url = inviteUrl();
    try {
      if (navigator.share) await navigator.share({ title: "Connect with me on Anydrop", text: "Open this link to share files with me.", url });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); flash("Pairing link copied."); }
      else { flash("Copy this URL from the address bar: " + url); }
    } catch (err) { if (err.name !== "AbortError") flash("Sharing failed. Try copying the link instead."); }
  }
  function stopCamera() {
    cancelAnimationFrame(state.scannerFrame);
    state.scannerFrame = 0;
    if (state.camera) { state.camera.getTracks().forEach(track => track.stop()); state.camera = null; }
  }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia || typeof jsQR !== "function") { flash("Camera scanning isn't supported here. Paste the pairing link instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      if (state.phase !== "scan") { stream.getTracks().forEach(t => t.stop()); return; }
      state.camera = stream;
      const video = document.getElementById("scan-video");
      if (!video) { stopCamera(); return; }
      video.srcObject = stream; await video.play();
      const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
      const loop = () => {
        if (state.phase !== "scan" || !state.camera) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const width = Math.min(640, video.videoWidth);
          els.canvas.width = width; els.canvas.height = Math.round(width * video.videoHeight / video.videoWidth);
          ctx.drawImage(video, 0, 0, els.canvas.width, els.canvas.height);
          const img = ctx.getImageData(0, 0, els.canvas.width, els.canvas.height);
          const result = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (result?.data) {
            const id = parseInvite(result.data);
            if (id) { stopCamera(); connectTo(id); return; }
          }
        }
        state.scannerFrame = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) { flash("Camera unavailable. You can paste a pairing link instead."); }
  }
  function restartHome() {
    cleanAddress();
    if (connected()) state.conn.close();
    state.conn = null; state.remoteId = null; clearTransfer();
    setPhase("home");
  }
  els.app.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    switch (button.dataset.action) {
      case "share": await shareLink(); break;
      case "scan": setPhase("scan"); startCamera(); break;
      case "home": restartHome(); break;
      case "cancel-connect": if (state.conn) state.conn.close(); restartHome(); break;
      case "choose": els.input.click(); break;
      case "offer": startOffer(); break;
      case "accept": acceptOffer(); break;
      case "decline": cancelTransfer(); break;
      case "cancel": cancelTransfer(); break;
      case "save": await saveFiles(); break;
      case "retry": restartHome(); break;
    }
  });
  els.app.addEventListener("submit", event => {
    if (event.target.id !== "join-form") return;
    event.preventDefault();
    const id = parseInvite(document.getElementById("join-link").value);
    if (!id) { flash("Paste a valid Anydrop pairing link."); return; }
    connectTo(id);
  });
  els.disconnect.addEventListener("click", () => {
    if (!confirm("Disconnect from this device?")) return;
    restartHome();
  });
  els.input.addEventListener("change", event => { chooseFiles(event.target.files); event.target.value = ""; });
  document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); els.app.classList.add("dropzone"); } });
  document.addEventListener("dragleave", event => { if (!event.relatedTarget) els.app.classList.remove("dropzone"); });
  document.addEventListener("drop", event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault(); els.app.classList.remove("dropzone"); chooseFiles(event.dataTransfer.files);
  });
  els.sound.addEventListener("click", () => {
    state.muted = !state.muted;
    localStorage.setItem("anydrop-muted", state.muted ? "1" : "0");
    render();
  });
  window.addEventListener("beforeunload", () => stopCamera());
  render(); setupPeer();
})();
