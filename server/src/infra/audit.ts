import fs from "node:fs";
import path from "node:path";

export class AuditLog {
  private dir: string;

  constructor(dir = path.join(process.cwd(), "audit")) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  write(topic: string, payload: unknown) {
    const line = JSON.stringify({ ts: Date.now(), topic, payload });
    fs.appendFileSync(path.join(this.dir, `${topic}.jsonl`), line + "\n");
  }
}
