# Anydrop

A lightweight, cross-platform file-sharing website inspired by AirDrop. No accounts or installation: open the website on two devices, connect using a QR code or pairing link, then send files in either direction.

**Live site (after GitHub Pages is enabled):** https://ryanfeeley.github.io/anydrop/

## Features

- **Role-neutral:** either connected device can send or receive without switching roles.
- **Share link** is the primary homepage action when the OS share sheet is available. Otherwise, **Copy link** is shown (including Firefox on macOS).
- **QR pairing:** show a QR code, scan with the phone camera, or paste the pairing link.
- **Real browser-to-browser file transfer** using a WebRTC data channel (PeerJS); files are not uploaded to GitHub or the signaling service.
- **Incoming-file modal** shows the file details with explicit Accept/Decline controls and keeps the sender waiting for consent. Escape declines.
- **Arrival alert** plays a three-note chime and requests vibration on compatible devices. Browsers can block unsolicited audio, so the connected screen offers an Enable sound alerts control when needed.
- **Explicit acceptance** before transferring file contents.
- Multiple files, drag-and-drop, live progress, cancellation, and bidirectional sessions.
- Single files download directly. Multiple files download as a ZIP.
- Optional, restrained sounds for connection, incoming requests, success, and errors.
- Mobile-friendly responsive design; reduced-motion support.

## Publish with GitHub Pages

1. In **Settings → Pages**, select **Deploy from a branch**.
2. Set the branch to **main** and folder to **/(root)**.
3. Save. Your site should be served at **https://ryanfeeley.github.io/anydrop/**.

There is no build step: `index.html`, `styles.css`, and `app.js` are served as static files.

## How to use

1. Open the Anydrop site on the first device.
2. Tap **Share link** and send the link to another device. Alternatively, scan the displayed QR with the other device's normal camera, or tap **Scan QR code** in Anydrop.
3. Wait for **Connected** on both screens.
4. Either device taps **Choose files** or drags files onto the page.
5. Tap **Send files**. The other person reviews and accepts the request.
6. Wait for the full transfer. The receiver taps **Save file** or **Download ZIP**.
7. Both devices remain connected, so either person can send more files.

## How it works

- **Hosting:** GitHub Pages (HTTPS).
- **Signaling:** PeerJS uses its public PeerServer by default. The server coordinates connections but does not carry file payloads.
- **File transport:** WebRTC data channels use encrypted DTLS transport. Wherever NAT traversal succeeds, bytes travel directly between browsers.
- **Progress:** chunks are sent in 32 KiB pieces with a bounded acknowledgement window. File receipt is confirmed before either UI claims delivery.
- **Downloads:** the recipient creates a Blob locally. ZIPs use JSZip for multiple-file transfers.
- **Pairing tokens:** browsers generate cryptographically random, hard-to-guess Peer IDs. A shared invite link includes the peer ID.

The frontend references PeerJS, qrcodejs, jsQR and JSZip from public CDNs, so an internet connection is required.

## Current limitations

This is an MVP, not a production file-transfer service:

- **100 MB total** and at most **100 files** per transfer (the receiver buffers data in memory).
- Some NATs, firewalls, and cellular networks may not support direct WebRTC without **TURN relay infrastructure**, which this version does not configure. Pairing may fail on those networks.
- Both tabs must remain open and awake during transmission; there is no transfer resume after disconnection.
- Files are accepted into browser memory before the download begins; the app cannot independently verify that the operating system finished writing a download.
- The public PeerJS signaling service is third-party infrastructure; availability and limits are outside this project's control.
- Simultaneous transfer requests are not queued. Finish one transfer before initiating another.
- URLs are bearer invitations: anybody with a live pairing link could connect, though file content still requires explicit acceptance. There is no out-of-band identity verification.
- There are no accounts, audit logs, virus scanning, expiry enforcement, rate limits, or formal security review.

## Local development

Serve this directory with any static HTTP server (for example `python3 -m http.server 8000`). Camera scanning requires a secure context (HTTPS or localhost). Test using two browser windows or separate devices.

## License

MIT.
