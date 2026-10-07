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

Serve the app shell with `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. Allow framing only for the dedicated `embed.html` document (and `/embed` if your host removes `.html`). `public/_headers` uses [Cloudflare Pages header detachment](https://developers.cloudflare.com/pages/configuration/headers/#detach-a-header) for these exceptions. On other hosts, configure equivalent response headers directly; a global frame denial also blocks embeds. Preserve denial for all app-shell routes, including SPA fallbacks. Vite development and preview servers apply the exception automatically.

## Embedding projects

Publish a project to GitHub Gist, open **Share**, choose the panes, and click **Copy embed code**. Paste the iframe into a website; adjust its `height` as needed. The viewer includes the Xode logo, the selected tabs, and **Open in Xode**. All selected panes are visible initially, in a resizable layout. Click a tab to toggle its pane; Ctrl/Cmd+click isolates it. HTML, CSS, and JS are read-only; Console displays output without command input. Code-only embeds do not execute the project.

Embeds load the latest pushed Gist anonymously, without local projects, GitHub tokens, AI chat, settings, or editing controls. Unsaved local changes do not appear until pushed. Gists must be accessible without authentication, and GitHub API availability and anonymous rate limits apply. Selected tabs control visibility, not source confidentiality: published code remains accessible through the Gist.

Project code runs in a nested opaque-origin sandbox with scripts enabled. Forms, popups, modals, top navigation, and same-origin storage access are disabled. External resources and network requests are still possible. The iframe snippet grants the trusted viewer the permissions needed to load and open the app; the project preview receives only `allow-scripts`.
