// End-to-end check of the multiplayer plumbing: two headless browser tabs (host + guest) meet through the
// signaling service, open a WebRTC data channel and trade messages, then the room's error cases are tried.
//
//   node test/e2e.mjs <signal base> [origin] [all|relay]
//   node test/e2e.mjs ws://127.0.0.1:8787                                  (wrangler dev)
//   node test/e2e.mjs wss://mc.iloveust.com/signal https://mc.iloveust.com relay
// "relay" forces the connection through TURN, which proves coturn works end to end.
import { chromium } from 'playwright';

const [base = 'ws://127.0.0.1:8787', origin = 'http://localhost:9999', policy = 'all'] = process.argv.slice(2);
// raw host candidates instead of mDNS names, which headless tabs can't always resolve
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const ctx = await browser.newContext();
// serve a blank page at `origin` so the WebSockets carry that Origin header
await ctx.route(`${origin}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>e2e</title>' }));
const open = async () => { const p = await ctx.newPage(); p.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text())); await p.goto(`${origin}/__e2e`); return p; };
const host = await open(), guest = await open();
const code = Math.random().toString(36).slice(2, 8).toUpperCase();

// Shared in-page helpers: connect, then wire up one RTCPeerConnection per remote peer.
const lib = `
window.connect = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url), q = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hello') res({ ws, hello: m, q }); else q.push(m); window.onSignal?.(m); };
  ws.onclose = (e) => { window.lastClose = { code: e.code, reason: e.reason }; rej(new Error('closed ' + e.code + ' ' + e.reason)); };
});
window.peer = (ws, ice, policy, remote) => {
  const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: policy });
  pc.onicecandidate = (e) => e.candidate && ws.send(JSON.stringify({ t: 'signal', to: remote, data: { cand: e.candidate } }));
  return pc;
};
window.pairInfo = async (pc) => {
  const s = await pc.getStats(); let pair;
  s.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = s.get(r.selectedCandidatePairId); });
  if (!pair) s.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
  if (!pair) return 'no pair';
  const l = s.get(pair.localCandidateId), r = s.get(pair.remoteCandidateId);
  return l.candidateType + '/' + (l.relayProtocol || l.protocol) + ' -> ' + r.candidateType + '/' + r.protocol + ', rtt ' + Math.round((pair.currentRoundTripTime ?? 0) * 1000) + 'ms';
};`;
await host.addScriptTag({ content: lib });
await guest.addScriptTag({ content: lib });

const url = (role, extra = '') => `${base}/room/${code}?role=${role}${extra}`;
const key = 'k' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const results = {};

// host opens the room and answers every guest that joins
results.hostHello = await host.evaluate(async ([u, policy]) => {
  const { ws, hello } = await connect(u);
  window.hostWs = ws;
  window.chans = [];
  const pcs = {};
  window.onSignal = async (m) => {
    if (m.t === 'join') {
      const pc = (pcs[m.id] = peer(ws, hello.ice, policy, m.id));
      const ch = pc.createDataChannel('game');
      ch.onmessage = (e) => ch.send('host got: ' + e.data);
      window.chans.push(ch);
      window.hostPc = pc;
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ t: 'signal', to: m.id, data: { sdp: pc.localDescription } }));
    } else if (m.t === 'signal') {
      const pc = pcs[m.from];
      if (m.data.sdp) await pc.setRemoteDescription(m.data.sdp);
      else if (m.data.cand) await pc.addIceCandidate(m.data.cand);
    }
  };
  return { id: hello.id, ice: hello.ice.map((s) => s.urls.join(' ') + (s.username ? ' (with TURN credential)' : '')) };
}, [url('host', `&key=${key}`), policy]);

// guest joins, answers the offer and round-trips a message over the data channel
results.guest = await guest.evaluate(async ([u, policy]) => {
  const t0 = performance.now();
  const { ws, hello, q } = await connect(u);
  let pc;
  const got = new Promise((res, rej) => {
    setTimeout(() => rej(new Error('data channel timed out; pc state ' + pc?.connectionState + ', ice ' + pc?.iceConnectionState)), 20000);
    const handle = async (m) => {
      if (m.t !== 'signal') return;
      if (m.data.sdp) {
        pc = peer(ws, hello.ice, policy, 'host');
        pc.ondatachannel = (e) => {
          const ch = e.channel;
          ch.onopen = () => ch.send('hello from guest');
          ch.onmessage = (ev) => res({ reply: ev.data, ms: Math.round(performance.now() - t0) });
        };
        await pc.setRemoteDescription(m.data.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        ws.send(JSON.stringify({ t: 'signal', to: 'host', data: { sdp: pc.localDescription } }));
      } else if (m.data.cand) await pc.addIceCandidate(m.data.cand);
    };
    window.onSignal = handle;
    q.forEach(handle);
  });
  const r = await got;
  ws.onclose = (e) => (window.guestClosed = { code: e.code, reason: e.reason });
  return { id: hello.id, ...r, path: await pairInfo(pc) };
}, [url('guest'), policy]).catch((e) => ({ error: e.message }));

// error cases
const expectClose = (page, u) => page.evaluate((u) => connect(u).then(() => 'connected?!', () => window.lastClose), u);
results.wrongRoom = await expectClose(guest, `${base}/room/NOPE${code}?role=guest`);
results.secondHost = await expectClose(guest, url('host', '&key=someone-else-entirely'));
results.hostReconnect = await host.evaluate(async (u) => { const { hello } = await connect(u); return { id: hello.id, peers: hello.peers }; }, url('host', `&key=${key}`)).catch((e) => ({ error: e.message }));
// the P2P link must survive the host's signaling socket being replaced
results.channelAfterReconnect = await host.evaluate(() => window.chans.map((c) => c.readyState));
await host.close();
// the guest should hear the host left (the round trip can take seconds through a slow proxy)
results.guestAfterHostLeft = await guest.evaluate(() => new Promise((res) => {
  const t0 = Date.now(), poll = () => (window.guestClosed ? res({ ...window.guestClosed, ms: Date.now() - t0 }) : Date.now() - t0 > 10000 ? res('still open') : setTimeout(poll, 50));
  poll();
}));

console.log(JSON.stringify(results, null, 2));
await browser.close();
const ok = results.guest.reply === 'host got: hello from guest' && results.wrongRoom?.code === 4004 && results.secondHost?.code === 4001 && results.guestAfterHostLeft?.code === 4010;
console.log(ok ? 'E2E OK' : 'E2E FAILED');
process.exit(ok ? 0 : 1);
