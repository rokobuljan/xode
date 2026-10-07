# Xode

Simple fiddling code editor for the web

## Source layout

`src/main.js` wires the app together. JavaScript modules in `src/js` are grouped by responsibility:

- `editor/` — code editing, selections, color tools, and rich text dialogs.
- `chat/` — AI chat, model handling, response parsing, and conversation storage.
- `projects/` — project storage, GitHub Gists, synchronization, and sharing.
- `preview/` — preview document generation and sandbox settings.
- `console/` — console output and developer console warning.
- `ui/` — reusable dialogs, icons, pane controls, and notifications.
- `shared/` — utilities, event bus, and reactive state.

Keep tests beside the modules they exercise. Put feature-specific code in its feature folder; use `ui/` and `shared/` for code reused across features. Dialog markup lives in `index.html`, with styles in `src/css`.

## Multiple cursors

Edit multiple locations within the active HTML, CSS, or JS pane:

- **Alt+click** adds or removes a cursor.
- **Ctrl+Alt+↑/↓** adds a cursor on the adjacent line.
- **Ctrl+D** selects the word at the cursor, then adds the next occurrence. **Ctrl+Shift+L** selects all occurrences.
- Typing, deletion, Enter, Tab, copy, cut, paste, and undo/redo apply to all selected locations. Pasting one line per cursor distributes those lines in document order.
- **Escape** or a normal click returns to one cursor. Focusing another editor clears the previous pane's extra cursors.

## Deployment

Serve the app shell with `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. `public/_headers` configures these headers on compatible static hosts; configure the equivalent response headers directly when the host does not support that file.
