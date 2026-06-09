# Console carousel view mode

## Problem

The project tab has two view modes for process consoles: a responsive grid (default) and per-card fullscreen. Both are useful, but neither suits the "browse through consoles one at a time with peripheral awareness" workflow — where you want one console front and center while the next/previous remain visible and reachable with a swipe.

## Goal

Add a third view mode — **carousel** — that horizontally lays out cards with one centered, neighbors peeking in on each side, navigable by trackpad swipe, click, or arrow keys, with native snap physics.

## State model

`ProjectTab` gains a `viewMode: 'grid' | 'carousel'` state that lives alongside the existing `fullscreenName: string | null`.

Effective render decision:
1. If `fullscreenName !== null` → render the maximized single card (existing behavior unchanged).
2. Otherwise render per `viewMode`: grid (default) or carousel.

Entering fullscreen from carousel does not modify `viewMode`. Exiting fullscreen (Escape or `⤡` button) therefore returns to whichever mode you were in. This gives "remember previous mode" semantics for free without a separate variable.

## UI

### Project-header toggle

A small button is added to `.project-tab__actions`, before `▶ up all` / `■ down all`. Two glyph states:
- `⊞ grid` when `viewMode === 'carousel'` (clicking flips back to grid)
- `⏵⏴ carousel` when `viewMode === 'grid'` (clicking enters carousel)

The button is present and clickable even when `fullscreenName !== null`. Its effect in that case is "which mode you'll land in when fullscreen exits."

### Carousel layout

`.process-list` gains a `process-list--carousel` modifier class when `viewMode === 'carousel' && !fullscreenName`. When `fullscreenName !== null`, the `process-list--fullscreen` modifier wins regardless of `viewMode`, so a fullscreen card always fills its area rather than appearing as a 70 vw carousel item.

Class composition rule:

```jsx
<div className={
  fullscreenName        ? 'process-list process-list--fullscreen'
  : viewMode === 'carousel' ? 'process-list process-list--carousel'
  : 'process-list'
}>
```

Same wrapper (`DndContext > SortableContext > .process-list`) as the other modes — only the modifier class changes — so xterm instances and WebSocket connections persist across mode flips. (This is the same scrollback-preservation invariant established for fullscreen.)

When exiting fullscreen back to carousel, the container's `scrollLeft` is preserved across the display-mode flip (the DOM element stays mounted; `scrollLeft` survives the CSS change because horizontal overflow returns). The verification step in the plan should confirm this: enter carousel → scroll to card 3 → fullscreen card 3 → Escape → carousel should still show card 3 centered. If the browser drops `scrollLeft`, a small fix is to save it before fullscreen entry and restore on exit via `useLayoutEffect`.

CSS (additions to `web/src/styles/main.css`):

```css
.process-list--carousel {
  display: flex;
  flex-direction: row;
  overflow-x: scroll;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  gap: 16px;
  padding: 12px 15vw;
  scrollbar-width: none;
}
.process-list--carousel::-webkit-scrollbar { display: none; }

.process-list--carousel .process-panel {
  flex: 0 0 70vw;
  scroll-snap-align: center;
  scroll-snap-stop: always;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.process-list--carousel .process-panel__body {
  flex: 1;
  height: auto;
}
.process-list--carousel .drag-handle { display: none; }
```

The `padding: 12px 15vw` gives 15vw of horizontal slack on each side of the strip so the first and last cards can sit centered. With cards at `70vw`, peeks at each side are `(100vw − 70vw) / 2 = 15vw`.

Card heights match fullscreen behavior — `100%` of the body area, with the `__body` element growing via `flex: 1; height: auto` rather than the fixed 280 px of grid mode.

Drag handles (`⠿`) are hidden in carousel because sortable drag is disabled in this mode (see below) and the handle looks misleadingly grabbable otherwise.

### Terminal font scaling

No change to `Terminal.jsx`. The existing container-width-based `fontSizeForWidth` ladder (`< 600 / 900 / 1300 / 1700`) naturally produces a larger font when the card occupies 70vw than when it's a 3-col grid cell. On a 1600 px viewport, 70vw = 1120 px → 12 px font. On a 2400 px monitor, 70vw = 1680 px → 13 px font. Wider monitors get bigger text automatically.

## Navigation

Three input methods, all of which modify the carousel's `scrollLeft`:

### 1. Trackpad / mouse-wheel horizontal scroll

Native CSS scroll-snap. Two-finger horizontal swipe on Mac trackpad, shift+wheel, and click-drag all work without any JS. Snap to nearest card on release via `scroll-snap-type: x mandatory`.

### 2. Click a peeked card to center it

A click handler on the `.process-panel` wrapper. The handler:
1. Skips if the card is currently centered (detected by comparing `card.getBoundingClientRect().left + card.offsetWidth / 2` against the carousel container's center within a small tolerance, e.g. ±20 px).
2. Skips if the click originated inside the `⠿` handle, a control button, or the terminal body (those have their own handlers and we don't want to steal their clicks).
3. Calls `card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })`.

### 3. ArrowLeft / ArrowRight

A document-level `keydown` listener registered via `useEffect`, only mounted while `viewMode === 'carousel' && !fullscreenName`.

```jsx
useEffect(() => {
  if (viewMode !== 'carousel' || fullscreenName) return;
  function onKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // Don't steal arrow keys from a focused terminal.
    if (document.activeElement?.closest?.('.xterm')) return;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    // Find currently centered card, scroll the neighbor into view.
    // (Implementation detail in the plan.)
  }
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, [viewMode, fullscreenName, ...]);
```

The `.xterm` focus gate prevents a user typing in a TUI (e.g. vim in a centered console) from accidentally swiping the carousel.

## Interaction with other modes

### Drag-to-reorder

`SortableContext`'s `disabled` prop already disables drag while `fullscreenName !== null`. Extend it to also disable in carousel:

```jsx
<SortableContext
  items={order}
  strategy={rectSortingStrategy}
  disabled={viewMode === 'carousel' || !!fullscreenName}
>
```

Order set by drag in grid mode is preserved when entering carousel — both modes iterate the same `orderedProcesses` array.

### Fullscreen

- The `⤢` button on a card still works in carousel. Clicking it enters fullscreen for that card; `viewMode` stays `'carousel'`.
- Escape exits fullscreen as today; because `viewMode` is preserved, Escape returns you to carousel (not grid) if that's where you came from.

### Double-click on card header

In grid mode, header double-click toggles fullscreen for that card (existing behavior).

In carousel mode, header double-click is a no-op. Click-to-center is the dominant interaction; we don't want a stray double-click on a peeked card to yank it into fullscreen.

Implementation: `ProcessPanel` gains a new prop `onHeaderDoubleClick` decoupled from `onToggleFullscreen`. The parent passes:
- In grid: `onHeaderDoubleClick={onToggleFullscreen}` — same as today.
- In carousel: `onHeaderDoubleClick={undefined}` (a no-op).

The `⤢` button's `onClick` continues to wire to `onToggleFullscreen` regardless of mode.

### Escape key

The existing Escape effect already early-returns when `!fullscreenName`, so it composes correctly with carousel mode. Escape does not exit carousel — only the project-header toggle does.

## Files touched

- `web/src/components/ProjectTab.jsx`
  - Add `const [viewMode, setViewMode] = useState('grid');`.
  - Add the toggle button to `.project-tab__actions`.
  - Apply `process-list--carousel` modifier class conditionally.
  - Pass `onHeaderDoubleClick` separately from `onToggleFullscreen` to each `ProcessPanel`.
  - Extend `SortableContext disabled` to include carousel.
  - Add the ArrowLeft/ArrowRight `useEffect`.

- `web/src/components/ProcessPanel.jsx`
  - Replace the existing `onDoubleClick={handleToggleFullscreen}` on `.process-panel__header` with `onDoubleClick={onHeaderDoubleClick}`.
  - Accept and wire `onHeaderDoubleClick` prop (default no-op).
  - Add a wrapper-level `onClick` for "click peek to center," gated on (a) the click target not being inside a child with its own handler (drag handle, controls, terminal body) and (b) the card not currently centered. The gate is implemented in `ProjectTab` (parent owns scroll behavior) by passing an `onCardClick` callback; `ProcessPanel` calls it and the parent decides whether to scroll.

- `web/src/styles/main.css`
  - Add the `.process-list--carousel` rules from the Carousel layout section above.

No new dependencies. `Terminal.jsx` is untouched.

## Non-goals

- No persistence of which card was centered on last carousel exit — entering always starts at the first card. Add later if it's annoying.
- No pagination dots, prev/next buttons, or auto-advance.
- No loop / wrap-around scrolling.
- No CSS Container Queries refactor — keep the existing JS `fontSizeForWidth` approach. (Container queries would be a separate Terminal-side refactor.)
- No animation other than what `scroll-behavior: smooth` provides for free.
- No special handling for 0 or 1 processes — with 1 process, the carousel shows that one card centered with no peeks (correct).

## Known limitations / acknowledged tradeoffs

- **Trackpad horizontal scroll requires a trackpad that supports it.** Users on a vertical-only mouse-wheel must hold Shift, click-drag, or use arrow keys. Documented in the implementation plan's verification steps.
- **15vw padding on very narrow viewports.** At 600 px viewport width, padding becomes 90 px on each side, leaving 420 px (70vw) for the centered card. Still readable. Below ~500 px the layout starts to feel cramped, but that's also when 1-col grid is the better choice — users on phones won't naturally reach for carousel.
