# Xode

Simple fiddling code editor for the web

## Multiple cursors

Edit multiple locations within the active HTML, CSS, or JS pane:

- **Alt+click** adds or removes a cursor.
- **Ctrl+Alt+↑/↓** adds a cursor on the adjacent line.
- **Ctrl+D** selects the word at the cursor, then adds the next occurrence. **Ctrl+Shift+L** selects all occurrences.
- Typing, deletion, Enter, Tab, copy, cut, paste, and undo/redo apply to all selected locations. Pasting one line per cursor distributes those lines in document order.
- **Escape** or a normal click returns to one cursor. Focusing another editor clears the previous pane's extra cursors.

## Deployment

Serve the app shell with `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. `public/_headers` configures these headers on compatible static hosts; configure the equivalent response headers directly when the host does not support that file.
