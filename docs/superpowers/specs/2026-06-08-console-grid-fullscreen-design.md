# Project console grid view with fullscreen toggle

## Problem

The project tab currently renders every process console as a full-width panel stacked vertically in `.process-list`. With 4–5 processes (a common case), each xterm body is squeezed to 220 px tall and the page becomes a long vertical scroll. Reading any single console requires hunting through the stack.

## Goal

Replace the vertical stack with a responsive card grid and add a per-card fullscreen toggle so the user can focus on one console without losing the overall layout.

## Requirements

### Grid layout

- `.process-list` becomes a CSS Grid:
  - viewport `≥ 1400 px` → 3 columns
  - viewport `≥ 900 px` → 2 columns
  - viewport `< 900 px` → 1 column (matches current behavior)
- Each card has a fixed terminal body of **280 px** (was 220 px). Slightly taller to compensate for narrower cards.
- Card grid lives inside the existing scroll container — pages with many processes scroll vertically.
- Cards always display their console. The current collapse/expand chevron and `expanded` state are removed entirely.
- The card header structurally unchanged: drag handle, status dot, name, port/uptime meta, restart/stop controls. Header click no longer toggles anything.

### Drag-to-reorder

- Behavior preserved.
- dnd-kit sortable strategy switches from `verticalListSortingStrategy` to `rectSortingStrategy`.
- `localStorage` key (`forge:panel-order:<project>`) and value format unchanged.
- Drag still initiates only from the `⠿` handle on the header — the rest of the card is not a drag source.

### Fullscreen mode

- State `fullscreenName: string | null` lives in `ProjectTab` (lifted from per-panel).
- Entry triggers:
  - Double-click on the card header (not the terminal body — xterm uses double-click for word-select).
  - Click on a new `⤢` toggle button placed on the right side of the card header.
- Exit triggers:
  - Press `Escape`.
  - Click the same `⤢` button (which swaps glyph when active — e.g. `⤡`).
  - Auto-exit: if the fullscreened process is no longer in `processes` on a later render (e.g. removed from config or never came back), `ProjectTab` resets `fullscreenName` to `null` so the grid reappears.
- When `fullscreenName !== null`:
  - `ProjectTab` renders only the matching `ProcessPanel`, sized to fill the remaining body area (`flex: 1`, no fixed 280 px).
  - The grid and the `Shared Services` section are not rendered.
  - The top tab bar and the project header row (title/path/up-all/down-all) remain visible — the user can still switch tabs.
- xterm refits automatically via its existing `ResizeObserver` on `.terminal-wrap`.
- `Escape` handler: `document.addEventListener('keydown', ...)` registered inside a `useEffect` that runs only while `fullscreenName !== null`. The effect's cleanup removes the listener.

### Known tradeoff: Escape inside an interactive TUI

A user typing `Escape` inside a TUI (e.g. vim) running in a fullscreen card will both:
- Feed `Escape` to the terminal (xterm receives the key event as normal).
- Exit fullscreen.

This is acceptable because forge processes are overwhelmingly long-running dev servers, not interactive TUIs. Users running interactive TUIs can simply avoid the fullscreen mode for that card. The `⤢` toggle exists as an always-available alternative.

## Files touched

- `web/src/components/ProjectTab.jsx`
  - Add `fullscreenName` state.
  - Add a `useEffect` that registers/cleans up the `Escape` keydown listener while a card is fullscreen.
  - Conditional render: grid + Shared Services in normal mode, single panel in fullscreen mode.
  - Swap dnd-kit strategy from `verticalListSortingStrategy` to `rectSortingStrategy`.
  - Pass `isFullscreen`, `onToggleFullscreen` props to `ProcessPanel`.

- `web/src/components/ProcessPanel.jsx`
  - Remove `expanded` state, remove chevron rendering, remove header click-to-toggle.
  - Add `onDoubleClick` on the header that calls `onToggleFullscreen`. Add `onDoubleClick={e => e.stopPropagation()}` to the drag handle and each control button so double-clicking those zones does not toggle fullscreen. (Today's `onClick={e => e.stopPropagation()}` only stops single clicks; double-click is a separate event and needs its own stopper.)
  - Add the `⤢` button to `.process-panel__controls` that calls `onToggleFullscreen`.
  - Accept `isFullscreen` prop; when true, apply a `process-panel--fullscreen` class and render the body without the fixed 280 px height.

- `web/src/styles/main.css`
  - Replace `.process-list` flex-column with grid + media queries at 900 px and 1400 px.
  - Add `.process-panel--fullscreen` with `flex: 1` body and full-area sizing.
  - Drop `.chevron` style (no longer used).
  - Bump `.process-panel__body` height from 220 px to 280 px in non-fullscreen mode.

## Non-goals

- Cards do not become resizable.
- Auto-fit columns based on min card width — explicit breakpoints only.
- Persisting which card was last fullscreened — fullscreen state is ephemeral.
- Per-card font size, scrollback, or terminal-theme controls.
- Fullscreen for the entire browser window (the existing browser fullscreen API).
