// The remote (spec: implementation.md, "The remote"): a phone driving an editor that is showing somewhere else, both signed in
// as the same person. One room per person, a Durable Object holding WebSockets with hibernation, so a room nobody is talking in
// costs nothing. The room is a relay: it knows who is in it and which screen each remote has picked, and nothing of what they
// say. A screen's messages go verbatim to the remotes that picked it; a remote's go verbatim to the screen it picked.
//
//   screen  an editor with "remote control" on. It names itself (`screen`, an id the device keeps, and `label`), so a reload
//           comes back as the same screen and a remote that picked it before keeps it. A second socket under the same id
//           replaces the first.
//   remote  the phone's page (/arboretum/remote). It is told the screens in the room (`{ t: 'screens', screens }`) on
//           arrival and whenever one comes or goes, and picks one with `{ t: 'pick', screen }`.
//
// What the room says itself: to a remote `screens`; to a screen `{ t: 'remotes', n }` (how many remotes have picked it) and
// `{ t: 'want' }` when one has just picked it, which the screen answers with its whole board.
import { DurableObject } from 'cloudflare:workers';

export type Role = 'screen' | 'remote';
type Seat = { role: Role; screen: string | null; label: string; since: number };

// A screen's board (the whole panel's rows and values) is tens of KB; a remote's command is a line.
export const MAX_SCREEN_MESSAGE = 512 * 1024;
export const MAX_REMOTE_MESSAGE = 8 * 1024;
export const SCREEN_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_LABEL = 60;

export class RemoteRoom extends DurableObject<Cloudflare.Env> {
  // The Worker has already said who this is (src/api/remote.ts); the room only takes what it was handed.
  async fetch(req: Request): Promise<Response> {
    const role = req.headers.get('X-Remote-Role') as Role;
    const screen = req.headers.get('X-Remote-Screen');
    const seat: Seat = { role, screen: role === 'screen' ? screen : null, label: req.headers.get('X-Remote-Label') ?? '', since: Date.now() };
    if (role === 'screen') {
      for (const ws of this.seated('screen')) if (this.seat(ws).screen === screen) ws.close(4000, 'replaced by a newer connection of this screen');
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(seat);
    if (role === 'remote') server.send(JSON.stringify(this.screens()));
    else {
      this.tellRemotes();
      this.tellCount(screen!);
      if (this.pickedBy(screen!).length) server.send('{"t":"want"}');   // a reload: the remotes that had it are still here and want its board
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    const seat = this.seat(ws);
    if (seat.role === 'screen') {
      if (message.length > MAX_SCREEN_MESSAGE) return;
      for (const r of this.pickedBy(seat.screen!)) r.send(message);
      return;
    }
    if (message.length > MAX_REMOTE_MESSAGE) return;
    let msg: { t?: unknown; screen?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg?.t === 'pick') {
      const was = seat.screen;
      seat.screen = typeof msg.screen === 'string' && SCREEN_ID.test(msg.screen) ? msg.screen : null;
      ws.serializeAttachment(seat);
      if (was && was !== seat.screen) this.tellCount(was);
      const to = seat.screen ? this.screenSocket(seat.screen) : null;
      if (to) {
        this.tellCount(seat.screen!);
        to.send('{"t":"want"}');
      }
      return;
    }
    if (seat.screen) this.screenSocket(seat.screen)?.send(message);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.leave(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
    } catch {}
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private leave(ws: WebSocket) {
    const seat = this.seat(ws);
    if (seat.role === 'screen') this.tellRemotes(ws);
    else if (seat.screen) this.tellCount(seat.screen, ws);
  }

  private seat(ws: WebSocket): Seat {
    return ws.deserializeAttachment() as Seat;
  }

  // The sockets of a role still open; `gone` is one closing right now, which the runtime may still list.
  private seated(role: Role, gone?: WebSocket) {
    return this.ctx.getWebSockets(role).filter((ws) => ws !== gone && ws.readyState === WebSocket.OPEN);
  }

  private screenSocket(screen: string, gone?: WebSocket) {
    return this.seated('screen', gone).find((ws) => this.seat(ws).screen === screen) ?? null;
  }

  private pickedBy(screen: string, gone?: WebSocket) {
    return this.seated('remote', gone).filter((ws) => this.seat(ws).screen === screen);
  }

  private screens(gone?: WebSocket) {
    const screens = this.seated('screen', gone).map((ws) => {
      const s = this.seat(ws);
      return { id: s.screen, label: s.label, since: s.since };
    });
    return { t: 'screens', screens };
  }

  private tellRemotes(gone?: WebSocket) {
    const text = JSON.stringify(this.screens(gone));
    for (const r of this.seated('remote', gone)) r.send(text);
  }

  private tellCount(screen: string, gone?: WebSocket) {
    this.screenSocket(screen, gone)?.send(JSON.stringify({ t: 'remotes', n: this.pickedBy(screen, gone).length }));
  }
}
