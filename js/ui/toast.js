"use strict";

import { on, EV } from "../engine/events.js";

// Non-blocking toasts for failures and terminal outcomes. The container is
// created here so the HTML shells stay presentation-free.

const host = document.createElement("div");
host.id = "toasts";
document.body.appendChild(host);

function show(text, cls) {
    const t = document.createElement("div");
    t.className = "toast " + (cls || "");
    t.textContent = text;
    host.appendChild(t);
    setTimeout(function () { t.classList.add("toast-out"); }, 4000);
    setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
    }, 4400);
}

on(EV.ERROR, function (e) {
    show("error: " + (e.name || e.tag || "failure"), "toast-bad");
});
on(EV.SAFE_TO_EXIT, function (e) {
    show("finished: " + (e.summary || "safe to exit"), "toast-ok");
});
on(EV.REBOOT_REQUIRED, function (e) {
    show("reboot required: " + (e.reason || "dirty state"), "toast-bad");
});
