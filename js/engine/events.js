"use strict";

// Engine-wide event emitter. It has no DOM and no network access: the
// exploit engine emits here and any presentation or telemetry layer
// subscribes. Handlers are isolated so a faulty consumer can never abort,
// delay or alter the chain that emitted the event.

export const EV = {
    INIT: "init",
    STAGE_START: "stage_start",
    STAGE_SUCCESS: "stage_success",
    LOG: "log",
    ERROR: "error",
    SAFE_TO_EXIT: "safe_to_exit",
    REBOOT_REQUIRED: "reboot_required",
    STATUS: "status",
    PROGRESS: "progress",
    TELEMETRY: "telemetry"
};

const handlers = new Map();

export function on(type, handler) {
    if (typeof handler !== "function")
        throw new TypeError("events.on: handler must be a function");
    let list = handlers.get(type);
    if (!list) {
        list = [];
        handlers.set(type, list);
    }
    list.push(handler);
    return function off() {
        const at = list.indexOf(handler);
        if (at >= 0)
            list.splice(at, 1);
    };
}

export function emit(type, payload) {
    const list = handlers.get(type);
    if (!list || list.length === 0)
        return;
    const event = { type: type, ts: Date.now() };
    if (payload) {
        const keys = Object.keys(payload);
        for (let i = 0; i < keys.length; ++i)
            event[keys[i]] = payload[keys[i]];
    }
    for (let i = 0; i < list.length; ++i) {
        try {
            list[i](event);
        } catch (e) {
            // a faulty consumer must not affect the engine or its peers
        }
    }
}
