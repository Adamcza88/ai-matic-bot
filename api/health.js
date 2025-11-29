export default function handler(req, res) {
    res.json({ ok: true, ts: new Date().toISOString() });
}
