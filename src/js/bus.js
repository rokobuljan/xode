/**
 * xode – global app event bus
 * A thin, typed wrapper around EventTarget so the rest of the app
 * doesn't need to know CustomEvent's API.
 */

class Bus extends EventTarget {
    /**
     * Subscribe to an event.
     * @returns {Function} unsubscribe function
     */
    on(type, handler) {
        const listener = (e) => handler(e.detail, e);
        this.addEventListener(type, listener);
        return () => this.removeEventListener(type, listener);
    }

    /** Subscribe once, auto-unsubscribes after first fire. */
    once(type, handler) {
        const listener = (e) => handler(e.detail, e);
        this.addEventListener(type, listener, { once: true });
        return () => this.removeEventListener(type, listener);
    }

    off(type, listener) {
        this.removeEventListener(type, listener);
    }

    /** Fire an event with a payload. */
    emit(type, detail) {
        if (import.meta.env?.DEV) {
            console.debug(`[xode:bus] ${type}`, detail);
        }
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

export const bus = new Bus();
