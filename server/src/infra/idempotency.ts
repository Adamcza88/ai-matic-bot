type Entry = { key: string; ts: number; result: unknown };

export class IdempotencyStore {
  private map = new Map<string, Entry>();
  constructor(private ttlMs: number) {}

  get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return e.result;
  }

  set(key: string, result: unknown) {
    this.map.set(key, { key, ts: Date.now(), result });
  }

  sweep() {
    const now = Date.now();
    for (const [k, e] of this.map.entries()) {
      if (now - e.ts > this.ttlMs) this.map.delete(k);
    }
  }
}
