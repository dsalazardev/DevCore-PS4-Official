"use strict";

import { on, EV } from "./events.js";

// The diagnostic beacon, exactly as the chains posted it before the event
// layer: one XHR per telemetry event to the relative path "t", same prefix
// and the same tag/detail encoding. Telemetry is not a presentation
// concern, so it keeps working with no UI loaded.

let installed = false;

export function installTelemetry(options) {
    if (installed)
        return;
    const opts = options || {};
    const prefix = opts.prefix || "PS4";
    const path = opts.path || "t";
    installed = true;
    on(EV.TELEMETRY, function (e) {
        try {
            const x = new XMLHttpRequest();
            x.open("POST", path, true);
            x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            x.send(prefix + "&tag=" + encodeURIComponent(e.tag)
                 + "&detail=" + encodeURIComponent(String(e.detail == null ? "" : e.detail)));
        } catch (err) { }
    });
}
