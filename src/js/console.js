import { el, elNew } from "./utils.js";

const paneConsole = {
    originalConsole: {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        dir: console.dir
    },
    // Command history
    history: [],
    historyIndex: 0,
    tempInput: '',
    init() {
        this.el = el(`[data-view="console"] .console`);
        this.elBtnClear = el(`[data-view="console"] .console-clear`);
        this.elBtnClear.addEventListener("click", () => this.clear());
        this.el.onkeydown = (evt) => {
            if ((evt.ctrlKey || evt.metaKey) && evt.key === "k") {
                evt.preventDefault();
                this.clear();
            }
        };
        // Create initial user-input line
        this.createInputLine();
        this.interceptConsole();
    },
    createInputLine() {
        // Remove old input line if exists
        if (this.inputLine) {
            this.inputLine.remove();
        }

        // Create new input line
        this.inputLine = elNew('div', { className: 'input-line' });

        // Prompt
        const prompt = elNew('span', { className: 'console-prompt', textContent: ">" });
        this.inputLine.append(prompt);

        // Input
        this.inputElement = elNew("textarea", {
            className: "console-input",
            placeholder: "",
            spellcheck: false,
            // autofocus: true
        });

        // Event listeners
        this.inputElement.addEventListener('keydown', (e) => {
            if (!e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                this.evaluateInput();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory(1);
            }
        });

        this.inputLine.append(this.inputElement);

        // Add to output
        this.el.append(this.inputLine);

        // Scroll to bottom
        // this.scrollToBottom();
    },
    print({ type, args, line }) {
        const logType = type.split(":")[1] || "log";
        const elBlock = elNew("code", {
            className: `log ${logType}`,
            textContent: args.join("\n").trimStart(),
        });
        const elLine = elNew("span", {
            className: "log-line",
            textContent: line,
        });
        elBlock.append(elLine);
        this.inputLine.before(elBlock);
    },
    focusInput() {
        if (this.inputElement) {
            this.inputElement.focus();
        }
    },
    formatValue(value, deep = false) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (typeof value === 'function') {
            return `ƒ ${value.name || 'anonymous'}()`;
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            const items = value.map(v => this.formatValue(v));
            return `[${items.join(', ')}]`;
        }
        if (typeof value === 'object') {
            if (deep) {
                return this.formatObject(value);
            }
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return value.toString();
            }
        }
        return String(value);
    },
    interceptConsole() {
        // Override console.log
        console.log = (...args) => {
            this.originalConsole.log.apply(console, args);
            const formatted = args.map(arg => this.formatValue(arg)).join(' ');
            this.print({ type: "console:log", args: [formatted] });
        };
        // Override console.error
        console.error = (...args) => {
            this.originalConsole.error.apply(console, args);
            const formatted = args.map(arg => this.formatValue(arg)).join(' ');
            this.print({ type: "console:error", args: ['❌ ' + formatted] });
        };
        // Override console.warn
        console.warn = (...args) => {
            this.originalConsole.warn.apply(console, args);
            const formatted = args.map(arg => this.formatValue(arg)).join(' ');
            this.print({ type: "console:warn", args: ['⚠️ ' + formatted] });
        };
        // Override console.info
        console.info = (...args) => {
            this.originalConsole.info.apply(console, args);
            const formatted = args.map(arg => this.formatValue(arg)).join(' ');
            this.print({ type: "console:info", args: ['ℹ️ ' + formatted] });
        };
        // Override console.dir
        console.dir = (obj) => {
            this.originalConsole.dir.apply(console, obj);
            this.print({ type: "console:dir", args: [this.formatValue(obj, true)] });
        };
    },
    evaluateInput() {
        const input = this.inputElement.value;
        if (!input.trim()) {
            this.focusInput();
            return;
        }

        // Add to history
        this.history.push(input);
        this.historyIndex = this.history.length;

        // Display input with prompt
        this.print({ type: "console:input", args: [input] });

        // Evaluate
        try {
            // Try Function constructor first (safer)
            try {
                const result = new Function(`"use strict"; return (${input})`)();
                if (result !== undefined) {
                    this.print({ type: "console:result", args: [this.formatValue(result)] });
                }
            } catch (_err) {
                // If that fails, try direct eval
                const result = eval(input);
                if (result !== undefined) {
                    this.print({ type: "console:result", args: [this.formatValue(result)] });
                }
            }
        } catch (error) {
            // Handle any evaluation errors
            if (error instanceof SyntaxError) {
                this.print({ type: "console:error", args: [error.message] });
            } else {
                this.print({ type: "console:error", args: [error.message || error] });
            }
        }

        // Clear input value
        this.inputElement.value = '';
    },
    navigateHistory(direction) {
        if (this.history.length === 0) return;

        const newIndex = this.historyIndex + direction;

        if (newIndex < 0) {
            this.historyIndex = -1;
            this.inputElement.value = this.tempInput || '';
            return;
        }

        if (newIndex >= this.history.length) {
            this.historyIndex = this.history.length;
            this.inputElement.value = '';
            return;
        }

        // Save current input when starting navigation
        if (this.historyIndex === this.history.length) {
            this.tempInput = this.inputElement.value;
        }

        this.historyIndex = newIndex;
        this.inputElement.value = this.history[this.historyIndex] || '';

        // Set cursor at end
        this.inputElement.setSelectionRange(
            this.inputElement.value.length,
            this.inputElement.value.length
        );
    },
    clear() {
        this.el.innerHTML = "";
        this.createInputLine();
    }
};

export default paneConsole;