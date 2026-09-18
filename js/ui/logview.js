"use strict";

import { on, EV } from "../engine/events.js";

// Append-only log renderer: one node per line, a batched flush, a FIFO cap
// and auto-scroll only when the view is already pinned to the bottom.

const MAX_LINES = 600;
const FLUSH_MS = 100;

const BAD = /FAIL|ERROR|THREW|REBOOT|MISS|LOST|POISON|MISMATCH|WRONG|TIMEOUT|ABORTED|NOT-FOUND/i;
const WARN = /WARN|SKIP|GAP|WOULD-HAVE-WON|REFUSED|COMMITTED|DIRTY/i;
const OK = /OK|PROVEN|READY|PASS|BASELINE|ACHIEVED|RUNNING|ARMED/i;

const outEl = document.getElementById("out");
const pending = [];
let timer = null;

function lineClass(text) {
    if (BAD.test(text)) return "bad";
    if (WARN.test(text)) return "warn";
    if (OK.test(text)) return "ok";
    return "";
}

function atBottom() {
    return outEl.scrollHeight - outEl.scrollTop - outEl.clientHeight < 12;
}

function flush() {
    timer = null;
    if (pending.length === 0) return;
    const stick = atBottom();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < pending.length; ++i) {
        const line = pending[i];
        const div = document.createElement("div");
        div.textContent = line.text;
        if (line.cls) div.className = line.cls;
        frag.appendChild(div);
    }
    pending.length = 0;
    outEl.appendChild(frag);
    while (outEl.childNodes.length > MAX_LINES)
        outEl.removeChild(outEl.firstChild);
    if (stick) outEl.scrollTop = outEl.scrollHeight;
}

function flushNow() {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    flush();
}

function schedule() {
    if (timer === null) timer = setTimeout(flush, FLUSH_MS);
}

on(EV.LOG, function (e) {
    if (e.level === "quiet") return;
    const text = e.tag + (e.detail == null || e.detail === "" ? "" : "  " + e.detail);
    pending.push({ text: text, cls: lineClass(text) });
    schedule();
});

on(EV.ERROR, flushNow);
on(EV.SAFE_TO_EXIT, flushNow);
on(EV.REBOOT_REQUIRED, flushNow);
window.addEventListener("pagehide", flushNow, false);
