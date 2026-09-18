#!/usr/bin/env node
// Recomputes the per-entry SHA-256 digests pinned in cache.appcache.
//
//   node tools/appcache-manifest.mjs           update the manifest in place
//   node tools/appcache-manifest.mjs --check   verify only; exit non-zero on
//                                              drift, a missing file, or an
//                                              unlisted runtime file
//
// Zero dependencies. Dev-only: this file is never a manifest entry.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = resolve(ROOT, "cache.appcache");
const CHECK = process.argv.includes("--check");

const ENTRY_LINE = /^(\S+)(?:\s+#([0-9a-fA-F]{64}))?\s*$/;
const RUNTIME_EXT = new Set([".html", ".js", ".css", ".png", ".bin"]);
const RUNTIME_ROOTS = ["js", "assets", "patches"];

function sha256(file) {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fsPathFor(entry) {
    return resolve(ROOT, entry.replace(/\?.*$/, ""));
}

function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full, out); continue; }
        if (RUNTIME_EXT.has(name.slice(name.lastIndexOf("."))))
            out.push(relative(ROOT, full).split(sep).join("/"));
    }
}

function listRuntimeFiles() {
    const found = [];
    for (const name of readdirSync(ROOT)) {
        const full = join(ROOT, name);
        if (!statSync(full).isFile()) continue;
        if (name === "cache.appcache") continue;
        if (RUNTIME_EXT.has(name.slice(name.lastIndexOf("."))))
            found.push(name);
    }
    for (const rootName of RUNTIME_ROOTS) {
        const root = join(ROOT, rootName);
        if (existsSync(root))
            walk(root, found);
    }
    return found;
}

const lines = readFileSync(MANIFEST_PATH, "utf8").split("\n");
const listed = new Set();
const issues = [];
const updated = [];
let section = "cache";

for (let i = 0; i < lines.length; ++i) {
    const trimmed = lines[i].trim();
    if (/^[A-Z]+:\s*$/.test(trimmed)) {
        section = trimmed.slice(0, -1).toLowerCase();
        continue;
    }
    if (section !== "cache") continue;
    if (trimmed === "" || trimmed === "CACHE MANIFEST" || trimmed.startsWith("#"))
        continue;

    const m = ENTRY_LINE.exec(trimmed);
    if (!m) {
        issues.push("UNPARSED " + trimmed);
        continue;
    }
    const entry = m[1];
    listed.add(entry);

    const file = fsPathFor(entry);
    if (!existsSync(file)) {
        issues.push("MISSING " + entry);
        continue;
    }
    const digest = sha256(file);
    const pinned = m[2] ? m[2].toLowerCase() : null;
    if (pinned === digest)
        continue;
    if (CHECK) {
        issues.push((pinned ? "DRIFT   " : "NO-HASH ") + entry
            + "  manifest=" + (pinned || "(none)") + " file=" + digest);
    } else {
        lines[i] = entry + " #" + digest;
        updated.push(entry);
    }
}

for (const file of listRuntimeFiles()) {
    if (!listed.has(file))
        issues.push("UNLISTED " + file);
}

if (CHECK) {
    if (issues.length) {
        for (const issue of issues)
            console.error(issue);
        console.error("appcache-manifest: " + issues.length
            + " issue(s); cache.appcache is stale");
        process.exit(1);
    }
    console.log("appcache-manifest: OK (" + listed.size + " entries)");
    process.exit(0);
}

if (updated.length) {
    writeFileSync(MANIFEST_PATH, lines.join("\n"));
    for (const entry of updated)
        console.log("updated " + entry);
}
if (issues.length) {
    for (const issue of issues)
        console.error(issue);
    console.error("appcache-manifest: " + issues.length
        + " issue(s) remain (entries are never added automatically)");
    process.exit(1);
}
console.log("appcache-manifest: " + updated.length + " entr(y/ies) updated");
