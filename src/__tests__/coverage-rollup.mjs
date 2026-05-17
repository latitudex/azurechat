#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL(import.meta.url).pathname, "../..");
const SUMMARY = path.join(REPO_ROOT, "coverage", "coverage-summary.json");
const FINAL = path.join(REPO_ROOT, "coverage", "coverage-final.json");

if (!fs.existsSync(SUMMARY)) {
  console.error(`No coverage-summary.json at ${SUMMARY}. Run \`npm run test:coverage\` first.`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));

const FEATURES = [
  "features/auth-page",
  "features/chat-home-page",
  "features/chat-page/chat-services",
  "features/chat-page/components",
  "features/chat-page",
  "features/common",
  "features/extensions-page",
  "features/main-menu",
  "features/persona-page",
  "features/prompt-page",
  "features/reporting-page",
  "features/theme",
  "app/api",
  "proxy.ts",
];

function bucketFor(file) {
  const rel = file.replace(REPO_ROOT + "/", "");
  for (const f of FEATURES) {
    if (rel.startsWith(f)) return f;
  }
  return "other";
}

const buckets = new Map();
for (const [file, metrics] of Object.entries(summary)) {
  if (file === "total") continue;
  const b = bucketFor(file);
  const cur = buckets.get(b) ?? {
    files: 0,
    statements: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    lines: { total: 0, covered: 0 },
    uncoveredFiles: [],
  };
  cur.files += 1;
  for (const k of ["statements", "branches", "functions", "lines"]) {
    cur[k].total += metrics[k].total;
    cur[k].covered += metrics[k].covered;
  }
  if (metrics.statements.pct < 100 || metrics.branches.pct < 100 || metrics.functions.pct < 100) {
    cur.uncoveredFiles.push({ file: file.replace(REPO_ROOT + "/", ""), ...metrics });
  }
  buckets.set(b, cur);
}

const pct = (c, t) => (t === 0 ? 100 : (c / t) * 100);
const fmt = (n) => `${n.toFixed(2).padStart(6, " ")}%`;

console.log("\n=== Coverage by feature area ===\n");
console.log(
  "Feature".padEnd(40),
  "Files".padStart(6),
  " Stmts".padStart(8),
  "Branch".padStart(8),
  "Funcs".padStart(8),
  "Lines".padStart(8),
);
console.log("-".repeat(82));
const rows = [...buckets.entries()].sort();
let total = { s: [0, 0], b: [0, 0], f: [0, 0], l: [0, 0], files: 0 };
for (const [name, m] of rows) {
  const sp = pct(m.statements.covered, m.statements.total);
  const bp = pct(m.branches.covered, m.branches.total);
  const fp = pct(m.functions.covered, m.functions.total);
  const lp = pct(m.lines.covered, m.lines.total);
  console.log(
    name.padEnd(40),
    String(m.files).padStart(6),
    fmt(sp),
    fmt(bp),
    fmt(fp),
    fmt(lp),
  );
  total.files += m.files;
  total.s[0] += m.statements.covered;
  total.s[1] += m.statements.total;
  total.b[0] += m.branches.covered;
  total.b[1] += m.branches.total;
  total.f[0] += m.functions.covered;
  total.f[1] += m.functions.total;
  total.l[0] += m.lines.covered;
  total.l[1] += m.lines.total;
}
console.log("-".repeat(82));
console.log(
  "TOTAL".padEnd(40),
  String(total.files).padStart(6),
  fmt(pct(total.s[0], total.s[1])),
  fmt(pct(total.b[0], total.b[1])),
  fmt(pct(total.f[0], total.f[1])),
  fmt(pct(total.l[0], total.l[1])),
);

// Default to informational rollup (no gate). Set COVERAGE_GATE in the
// workflow env when you want to fail the build below a threshold.
const GATE = Number(process.env.COVERAGE_GATE ?? 0);
const failures = [];
for (const [name, m] of rows) {
  const sp = pct(m.statements.covered, m.statements.total);
  const bp = pct(m.branches.covered, m.branches.total);
  const fp = pct(m.functions.covered, m.functions.total);
  if (sp < GATE || bp < GATE || fp < GATE) failures.push({ name, sp, bp, fp });
}

if (failures.length) {
  console.log(`\n=== Below ${GATE}% gate ===\n`);
  for (const f of failures) {
    console.log(`- ${f.name}: stmts ${f.sp.toFixed(2)}%, branch ${f.bp.toFixed(2)}%, funcs ${f.fp.toFixed(2)}%`);
  }
  console.log("\nDetailed uncovered files:");
  for (const [name, m] of rows) {
    if (!m.uncoveredFiles.length) continue;
    console.log(`\n[${name}]`);
    for (const u of m.uncoveredFiles.slice(0, 25)) {
      console.log(`  ${u.file}  s=${u.statements.pct}% b=${u.branches.pct}% f=${u.functions.pct}%`);
    }
    if (m.uncoveredFiles.length > 25) console.log(`  …and ${m.uncoveredFiles.length - 25} more`);
  }
  process.exit(2);
}

console.log(`\nAll feature areas meet ${GATE}% gate.`);
