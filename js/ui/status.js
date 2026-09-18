"use strict";

import { on, EV } from "../engine/events.js";

// Status line: follows the engine's explicit status text and the stage
// lifecycle. A ui-status event always wins over a generic stage label.

const stateEl = document.getElementById("state");

function set(text, cls) {
    stateEl.textContent = text;
    stateEl.className = cls || "";
}

on(EV.INIT, function (e) {
    set("firmware " + (e.fw || "?") + " / " + (e.bug || "?"), "warn");
});
on(EV.STAGE_START, function (e) {
    set("stage " + e.stage + ": " + e.name + "...", "warn");
});
on(EV.STAGE_SUCCESS, function (e) {
    set("stage " + e.stage + " done", "ok");
});
on(EV.STATUS, function (e) {
    set(e.text, e.cls);
});
