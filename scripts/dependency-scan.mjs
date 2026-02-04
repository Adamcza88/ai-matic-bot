import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIRS = ["src", "server", "tests"];
const ENTRY_POINTS = [
  "src/main.tsx",
  "server/index.js",
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const resolveOrderFor = (filePath) => {
  const ext = path.extname(filePath);
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") {
    return [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];
  }
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
};

function isCodeFile(filePath) {
  return EXTENSIONS.includes(path.extname(filePath));
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const items = fs.readdirSync(current);
      for (const item of items) {
        if (item === "node_modules" || item.startsWith(".")) continue;
        stack.push(path.join(current, item));
      }
    } else if (stat.isFile()) {
      out.push(current);
    }
  }
  return out;
}

function resolveAlias(spec, fromDir) {
  if (spec.startsWith("@/")) {
    return path.join(ROOT, "src", spec.slice(2));
  }
  return path.resolve(fromDir, spec);
}

function resolveFile(spec, fromDir, fromFile) {
  const resolveOrder = resolveOrderFor(fromFile);
  const base = resolveAlias(spec, fromDir);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of resolveOrder) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of resolveOrder) {
      const idx = `index${ext}`;
      const candidate = path.join(base, idx);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }
  return null;
}

function collectImports(source) {
  const results = new Set();
  const patterns = [
    /import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:\*\s+from|\{[^}]*\}\s+from)\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const spec = match[1];
      if (!spec || (!spec.startsWith(".") && !spec.startsWith("@/"))) continue;
      results.add(spec);
    }
  }
  return Array.from(results);
}

function crawl(entry) {
  const entryPath = path.resolve(ROOT, entry);
  const visited = new Set();
  const stack = [entryPath];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!isCodeFile(current)) continue;
    const source = readFileSafe(current);
    const imports = collectImports(source);
    const baseDir = path.dirname(current);
    for (const spec of imports) {
      const resolved = resolveFile(spec, baseDir, current);
      if (resolved) stack.push(resolved);
    }
  }
  return visited;
}

function gatherEntries() {
  const entries = [...ENTRY_POINTS];
  const testsDir = path.join(ROOT, "tests");
  if (fs.existsSync(testsDir)) {
    const all = listFiles(testsDir);
    const tests = all
      .filter((file) => file.includes(".test."))
      .map((file) => path.relative(ROOT, file));
    entries.push(...tests);
  }
  return entries;
}

const entries = gatherEntries();
const reachable = new Set();
for (const entry of entries) {
  const visited = crawl(entry);
  for (const file of visited) reachable.add(path.resolve(file));
}

const allFiles = SRC_DIRS.flatMap((dir) =>
  listFiles(path.join(ROOT, dir)).filter((file) => isCodeFile(file))
);
const unreachable = allFiles
  .map((file) => path.resolve(file))
  .filter((file) => !reachable.has(file));

const report = {
  entries,
  reachable: Array.from(reachable).map((p) => path.relative(ROOT, p)).sort(),
  unreachable: unreachable.map((p) => path.relative(ROOT, p)).sort(),
};

console.log(JSON.stringify(report, null, 2));
