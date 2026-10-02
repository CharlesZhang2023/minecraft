// Development only: a connection between two tabs of this browser (BroadcastChannel), using the same wire
// encoding as WebRTC. Lets tests run two players side by side without a network.
import { Conn, Msg, encodeMsg, decodeMsg } from './conn';

export function bcConn(name: string, side: 'host' | 'guest'): Conn {
  const ch = new BroadcastChannel('mcw-test-' + name);
  const other = side === 'host' ? 'guest' : 'host';
  let inbox: Msg[] = [];
  const conn: Conn = {
    kind: 'rtc',
    closed: false,
    closeReason: '',
    send(m) { if (!conn.closed) ch.postMessage({ from: side, d: encodeMsg(m) }); },
    poll() { const r = inbox; inbox = []; return r; },
    backlog() { return 0; },
    close(reason = 'closed') {
      if (conn.closed) return;
      ch.postMessage({ from: side, bye: reason });
      conn.closed = true;
      conn.closeReason = reason;
      ch.close();
    },
  };
  ch.onmessage = (e) => {
    const m = e.data as { from: string; d?: string | Uint8Array; bye?: string };
    if (m.from !== other) return;
    if (m.bye !== undefined) { conn.closed = true; conn.closeReason = m.bye; ch.close(); return; }
    inbox.push(decodeMsg(m.d!));
  };
  return conn;
}
