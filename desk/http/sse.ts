export type SseClient = ReadableStreamDefaultController<Uint8Array>;

const enc = new TextEncoder();

export class SseHub {
  private clients = new Set<SseClient>();

  get size() {
    return this.clients.size;
  }

  add(c: SseClient) {
    this.clients.add(c);
  }

  remove(c: SseClient) {
    this.clients.delete(c);
  }

  send(c: SseClient, type: string, data: unknown) {
    try {
      c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      this.clients.delete(c);
    }
  }

  broadcast(type: string, data: unknown) {
    for (const c of this.clients) this.send(c, type, data);
  }

  startPing(ms = 15_000) {
    return setInterval(() => this.broadcast("ping", { t: Date.now() }), ms);
  }
}
