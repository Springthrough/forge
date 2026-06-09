# Console carousel mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third project-tab view mode — a horizontal carousel with one card centered and ~15vw peeks on each side — alongside the existing grid and fullscreen modes.

**Architecture:** Pure frontend change in `web/`. `ProjectTab` gains a `viewMode: 'grid' | 'carousel'` state and a new project-header toggle button. The existing `.process-list` wrapper stays mounted in all modes (preserving xterm scrollback and WebSockets); only its modifier class flips. Carousel layout uses native CSS scroll-snap for swipe/snap physics. A scroll handler in `ProjectTab` tracks which card is centered so that (a) clicking peeked cards scrolls them to center, (b) `pointer-events: none` on peek-card children prevents accidental terminal/button activation, and (c) arrow keys can step between cards. Double-click on a card header is gated to grid mode only (it remains the fullscreen trigger there, but does nothing in carousel — `⤢` still does).

**Tech Stack:** React 18 + Vite, `@dnd-kit/core` + `@dnd-kit/sortable`, native CSS `scroll-snap`, plain CSS.

**No test harness:** The `web/` package has no test runner. Verification is `npm run build` (catches syntax errors) plus manual browser checks at the end of each task.

**Spec:** `docs/superpowers/specs/2026-06-08-console-carousel-mode-design.md`

---

## File Structure

- `web/src/components/ProjectTab.jsx` — adds `viewMode` state, toggle button, class composition logic, carousel ref, centered-card scroll tracking, click-to-center handler, arrow-key effect, and decouples the header-double-click callback from the fullscreen button.
- `web/src/components/ProcessPanel.jsx` — accepts `isCentered`, `onCardClick`, and `onHeaderDoubleClick` props; renders a `data-process-name` attribute; applies a `process-panel--peek` modifier class when non-centered in carousel.
- `web/src/styles/main.css` — adds `.process-list--carousel`, `.process-panel--peek`, and supporting rules.

No new files. `Terminal.jsx` is untouched (its container-width font scaling Just Works at the new card widths).

---

## Pre-flight

- [ ] **Step 0: Dev server**

In a separate terminal (if not already running):

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run dev
```

The dashboard is at `http://localhost:2525/`. Open a project tab with **at least 3 running processes** so the carousel has neighbors to peek. (`centrumx-web` is a good test case — 4 processes.)

Keep the dashboard open across all tasks. Vite HMR reloads automatically.

---

## Task 1: Add carousel CSS (inert — no JS wired up yet)

CSS first so we can verify the layout independently of the JS state machine. After this task, no behavior changes — the rules exist but no element gets the carousel class yet.

**Files:**
- Modify: `web/src/styles/main.css`

- [ ] **Step 1: Append carousel and peek rules**

Open `web/src/styles/main.css` and find the existing fullscreen rules block:

```css
.process-list--fullscreen { display: block; }
.process-panel--hidden     { display: none; }
.process-panel--fullscreen { height: 100%; display: flex; flex-direction: column; }
.process-panel--fullscreen .process-panel__body { flex: 1; height: auto; }
```

Append the following lines **immediately after** that block:

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
.process-panel--peek > * { pointer-events: none; }
.process-panel--peek    { pointer-events: auto; cursor: pointer; opacity: 0.7; }
```

The `.process-panel--peek` rule will be applied in Task 3. Defining it now keeps CSS changes contained to one task.

- [ ] **Step 2: Build check**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Verify no behavior changed**

Reload the dashboard. The grid and fullscreen modes should look identical to before (no class composition logic added yet, so the new CSS rules don't apply to anything).

- [ ] **Step 4: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add web/src/styles/main.css && git commit -m "feat(web): add carousel CSS rules (inert until wired up)"
```

Do NOT use `git add -A` / `git add .` — there are unrelated dirty files in the tree (`README.md`, `src/daemon/services/drivers/mongo.js`, `docs/superpowers/plans/2026-06-03-linux-support.md`).

---

## Task 2: viewMode state, toggle button, class composition

Add the state machine, the project-header toggle, and the class composition that decides which modifier class `.process-list` carries. After this task, carousel mode visually works — you can swipe/wheel-scroll horizontally and cards snap. Click-to-center, arrow keys, and the double-click gate come in later tasks.

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`
- Modify: `web/src/components/ProcessPanel.jsx`

- [ ] **Step 1: Add `viewMode` state, refs, project-change reset in `ProjectTab.jsx`**

In `web/src/components/ProjectTab.jsx`, find the React import on line 1:

```jsx
import { useState, useEffect, useCallback } from 'react';
```

Replace with:

```jsx
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
```

(`useRef` is for the carousel container and the previous-viewMode tracker added in this task; `useLayoutEffect` is used in Task 3 for synchronous scroll-position measurement before paint. Adding both here so subsequent tasks don't need to re-edit the import.)

Then find the state block at the top of the `ProjectTab` component:

```jsx
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);
  const [fullscreenName, setFullscreenName] = useState(null);
  const { catalog, enabled, busy, toggle } = useServicesSection(project);
```

Add `viewMode` state, a ref to the carousel container, and a previous-viewMode tracker:

```jsx
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);
  const [fullscreenName, setFullscreenName] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const carouselRef = useRef(null);
  const prevViewModeRef = useRef('grid');
  const { catalog, enabled, busy, toggle } = useServicesSection(project);
```

Then find the existing project-change reset effect:

```jsx
  useEffect(() => {
    setFullscreenName(null);
  }, [project?.name]);
```

Update it to also reset `viewMode`:

```jsx
  useEffect(() => {
    setFullscreenName(null);
    setViewMode('grid');
  }, [project?.name]);
```

- [ ] **Step 2: Add the project-header toggle button**

Still in `ProjectTab.jsx`, find:

```jsx
        <div className="project-tab__actions">
          <button className="btn btn--success btn--sm" onClick={handleUpAll}>▶ up all</button>
          <button className="btn btn--danger btn--sm" onClick={handleDownAll}>■ down all</button>
        </div>
```

Replace it with:

```jsx
        <div className="project-tab__actions">
          <button
            className="btn btn--sm"
            onClick={() => setViewMode(m => m === 'carousel' ? 'grid' : 'carousel')}
            title={viewMode === 'carousel' ? 'switch to grid view' : 'switch to carousel view'}
          >
            {viewMode === 'carousel' ? '⊞ grid' : '⏵⏴ carousel'}
          </button>
          <button className="btn btn--success btn--sm" onClick={handleUpAll}>▶ up all</button>
          <button className="btn btn--danger btn--sm" onClick={handleDownAll}>■ down all</button>
        </div>
```

- [ ] **Step 3: Update class composition and SortableContext `disabled`**

Still in `ProjectTab.jsx`, find the `.process-list` JSX:

```jsx
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
          disabled={!!fullscreenName}
        >
          <div className={`process-list${fullscreenName ? ' process-list--fullscreen' : ''}`}>
```

Change both lines (and wire `ref={carouselRef}` into the `.process-list` div — needed for Task 3's scroll tracking and for this task's scroll-reset effect):

```jsx
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
          disabled={viewMode === 'carousel' || !!fullscreenName}
        >
          <div
            ref={carouselRef}
            className={
              fullscreenName        ? 'process-list process-list--fullscreen'
              : viewMode === 'carousel' ? 'process-list process-list--carousel'
              : 'process-list'
            }
          >
```

(Fullscreen modifier wins regardless of `viewMode` — required so a fullscreen card fills its area rather than appearing as a 70 vw carousel item.)

- [ ] **Step 4: Add `data-process-name` to the `ProcessPanel` wrapper**

In `web/src/components/ProcessPanel.jsx`, find the outer wrapper div:

```jsx
    <div
      ref={setNodeRef}
      style={style}
      className={
        `process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}` +
        `${isHidden ? ' process-panel--hidden' : ''}`
      }
    >
```

Add `data-process-name`:

```jsx
    <div
      ref={setNodeRef}
      data-process-name={process.name}
      style={style}
      className={
        `process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}` +
        `${isHidden ? ' process-panel--hidden' : ''}`
      }
    >
```

(This attribute is used in Task 3's scroll handler to identify which card is centered.)

- [ ] **Step 5: Add scroll-reset effect for grid → carousel transitions**

In `web/src/components/ProjectTab.jsx`, just after the existing project-change reset effect (the one that calls `setFullscreenName(null); setViewMode('grid');`), add:

```jsx
  // Spec: entering carousel from a non-carousel state resets to the first card
  // (`scrollLeft = 0`). Fullscreen ↔ carousel transitions preserve scrollLeft —
  // we guard with `prevViewModeRef.current !== 'carousel'` so this only fires
  // on grid → carousel, not on fullscreen → carousel (where viewMode never
  // changed and the previous value is already 'carousel').
  useEffect(() => {
    if (viewMode === 'carousel' && prevViewModeRef.current !== 'carousel' && !fullscreenName) {
      const el = carouselRef.current;
      if (el) el.scrollLeft = 0;
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, fullscreenName]);
```

- [ ] **Step 6: Build check**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

- [ ] **Step 7: Verify in browser**

Reload the dashboard. In a project tab:
- A new `⏵⏴ carousel` button appears in the project header before `▶ up all`.
- Click it. The cards reflow horizontally — one card roughly centered, neighbors visible at the edges.
- Two-finger swipe on Mac trackpad (or shift+mouse-wheel) scrolls the strip; releasing snaps the nearest card to center.
- Click `⊞ grid` to return to the grid layout.
- Switch to a different project tab; switch back. View should be back to grid (project-change reset).
- Drag handle on the centered card is hidden (CSS rule from Task 1).
- The `⤢` button on the centered card still works and fullscreens. Pressing Escape exits fullscreen — and you return to **carousel**, not grid, because `viewMode` was preserved.
- **Scroll-reset check:** in carousel, swipe / wheel-scroll to a later card. Click `⊞ grid` then `⏵⏴ carousel` to come back. The first card should be centered (not the one you'd scrolled to). The `prevViewModeRef` guard ensures this.

- [ ] **Step 8: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add web/src/components/ProjectTab.jsx web/src/components/ProcessPanel.jsx && git commit -m "feat(web): add carousel viewMode with project-header toggle"
```

---

## Task 3: Track centered card; click peeks to center them

Add a scroll handler that figures out which card is closest to the carousel center, and a click handler that scrolls peeked cards to center on click. Apply the `process-panel--peek` class to non-centered cards so their children become `pointer-events: none` (peek body clicks center the card; they don't focus the terminal or fire buttons).

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`
- Modify: `web/src/components/ProcessPanel.jsx`

**Note on `useRef` / `useLayoutEffect`:** both were imported in Task 2 Step 1. The `carouselRef` was declared and wired into the JSX in Task 2. This task only adds `centeredName` state plus the scroll-tracking layout effect.

- [ ] **Step 1: Add `centeredName` state in `ProjectTab.jsx`**

In the `ProjectTab` component body, just after the `prevViewModeRef` declaration you added in Task 2 Step 1, add:

```jsx
  const [centeredName, setCenteredName] = useState(null);
```

- [ ] **Step 2: Add the scroll-tracking layout effect**

After the existing effects in `ProjectTab` (after the Escape effect and the scroll-reset effect you added in Task 2 Step 5, before the `useEffect` that loads `order` from localStorage), add:

```jsx
  // Track which card is closest to the carousel center. useLayoutEffect (not
  // useEffect) so the very first paint after entering carousel already has
  // `centeredName` set — avoids a one-frame flash where every card looks
  // centered (no peek class applied yet).
  useLayoutEffect(() => {
    if (viewMode !== 'carousel' || fullscreenName) {
      setCenteredName(null);
      return;
    }
    const el = carouselRef.current;
    if (!el) return;
    function update() {
      const containerCenter = el.scrollLeft + el.clientWidth / 2;
      let best = null, bestDist = Infinity;
      for (const child of el.children) {
        const c = child.offsetLeft + child.offsetWidth / 2;
        const d = Math.abs(c - containerCenter);
        if (d < bestDist) { bestDist = d; best = child; }
      }
      if (best) setCenteredName(best.dataset.processName ?? null);
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [viewMode, fullscreenName, orderedProcesses.length]);
```

(The `orderedProcesses.length` dep makes the effect re-attach if processes are added/removed — the scroll element's children change. `useLayoutEffect` runs synchronously after DOM mutations but before paint, so `setCenteredName` triggers a synchronous re-render and the first visible frame already has the correct peek classes applied.)

- [ ] **Step 3: Add a `centerCard` callback and pass `isCentered` + `onCardClick` to each `ProcessPanel`**

In `ProjectTab`'s function body — alongside the other handler functions like `handleDragEnd`, `handleUpAll`, `handleDownAll`, **before** the `if (!project) return ...` early return — add:

```jsx
  const centerCard = useCallback((name) => {
    const el = carouselRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-process-name="${CSS.escape(name)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, []);
```

`CSS` is a browser global (the same object that has `CSS.escape`). No import needed.

Then find the `ProcessPanel` instantiation inside the map:

```jsx
            {orderedProcesses.map(proc => {
              const isFs = proc.name === fullscreenName;
              return (
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                />
              );
            })}
```

Add `isCentered` and `onCardClick` props:

```jsx
            {orderedProcesses.map(proc => {
              const isFs = proc.name === fullscreenName;
              const isCarousel = viewMode === 'carousel' && !fullscreenName;
              const isCentered = isCarousel && proc.name === centeredName;
              return (
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  isCarousel={isCarousel}
                  isCentered={isCentered}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                  onCardClick={isCarousel && !isCentered ? () => centerCard(proc.name) : undefined}
                />
              );
            })}
          </div>
```

- [ ] **Step 4: Wire `isCarousel`, `isCentered`, and `onCardClick` into `ProcessPanel.jsx`**

In `web/src/components/ProcessPanel.jsx`, change the function signature:

```jsx
export default function ProcessPanel({
  projectName,
  process,
  allocations,
  isFullscreen = false,
  isHidden = false,
  onToggleFullscreen,
}) {
```

to:

```jsx
export default function ProcessPanel({
  projectName,
  process,
  allocations,
  isFullscreen = false,
  isHidden = false,
  isCarousel = false,
  isCentered = false,
  onToggleFullscreen,
  onCardClick,
}) {
```

Then find the wrapper `<div>` (which after Task 2 Step 4 looks like this):

```jsx
    <div
      ref={setNodeRef}
      data-process-name={process.name}
      style={style}
      className={
        `process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}` +
        `${isHidden ? ' process-panel--hidden' : ''}`
      }
    >
```

Replace with:

```jsx
    <div
      ref={setNodeRef}
      data-process-name={process.name}
      style={style}
      onClick={onCardClick}
      className={
        `process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}` +
        `${isHidden ? ' process-panel--hidden' : ''}` +
        `${isCarousel && !isCentered ? ' process-panel--peek' : ''}`
      }
    >
```

(`onClick={onCardClick}` is `undefined` outside carousel and on the centered card, so it's effectively inert except when clicking peeks.)

- [ ] **Step 5: Build check**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

- [ ] **Step 6: Verify in browser**

Reload. Enter carousel mode (`⏵⏴ carousel` button):
- The two side peeks are faintly dimmed (`opacity: 0.7`) and have a `cursor: pointer`.
- **No flash on entry:** the very first frame after clicking the toggle should already show the first card centered and side cards dimmed — there should NOT be a one-frame state where all cards look equally centered. (`useLayoutEffect` from Step 2 ensures this.)
- Click the right peek. The carousel smoothly scrolls to center that card. Now the previous-right card is in the center, fully opaque; the previous-center is now a left peek.
- Click anywhere on the peek (header, terminal area, buttons) — they all center the card (because peek children are `pointer-events: none`). Buttons on peeks do **not** fire restart/stop accidentally.
- Click on the centered card's terminal — xterm receives the click (focuses the terminal). The centered card is fully interactive.
- Click the centered card's `restart` button. It fires (the centered card is not a peek; no pointer-events override).

- [ ] **Step 7: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add web/src/components/ProjectTab.jsx web/src/components/ProcessPanel.jsx && git commit -m "feat(web): click a peeked carousel card to center it"
```

---

## Task 4: Arrow-key navigation

A document-level `keydown` effect, mounted only while `viewMode === 'carousel' && !fullscreenName`. ArrowLeft/ArrowRight step to the previous/next card and scroll it to center. Skipped when focus is inside a terminal (so vim users typing arrows aren't kidnapped by the carousel).

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`

- [ ] **Step 1: Add the arrow-key effect**

In `ProjectTab.jsx`, just after the scroll-tracking effect from Task 3 Step 2, add:

```jsx
  // Arrow-key navigation in carousel mode. Skips when focus is inside a
  // terminal so a user typing in xterm isn't swiped accidentally.
  useEffect(() => {
    if (viewMode !== 'carousel' || fullscreenName) return;
    function onKeyDown(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (document.activeElement?.closest?.('.xterm')) return;
      const el = carouselRef.current;
      if (!el) return;
      const cards = Array.from(el.children);
      const idx = cards.findIndex(c => c.dataset.processName === centeredName);
      if (idx < 0) return;
      const nextIdx = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
      const target = cards[nextIdx];
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewMode, fullscreenName, centeredName]);
```

- [ ] **Step 2: Build check**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

- [ ] **Step 3: Verify in browser**

Reload, enter carousel:
- Click somewhere outside any terminal (e.g. the project-header area) to clear xterm focus.
- Press `ArrowRight` — carousel advances by one card. Press `ArrowLeft` — back. At the last card, ArrowRight is a no-op (no next card). Same for first card + ArrowLeft.
- Click into a centered terminal (e.g. type something — xterm should receive it). Press `ArrowRight` — nothing happens (the `.xterm` focus gate is preventing the handler). The shell in the terminal might receive an arrow-key escape sequence if it cares, which is correct passthrough.

- [ ] **Step 4: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add web/src/components/ProjectTab.jsx && git commit -m "feat(web): arrow keys navigate the console carousel"
```

---

## Task 5: Gate double-click-to-fullscreen so it only fires in grid mode

Decouple the header double-click from the fullscreen toggle. The `⤢` button keeps its current wiring (fullscreen toggle from any mode). The header double-click becomes a parent-controlled callback that's set in grid and `undefined` in carousel — so dragging your finger across the carousel can't accidentally trigger fullscreen.

**Files:**
- Modify: `web/src/components/ProcessPanel.jsx`
- Modify: `web/src/components/ProjectTab.jsx`

- [ ] **Step 1: Add `onHeaderDoubleClick` prop to `ProcessPanel`**

In `web/src/components/ProcessPanel.jsx`, extend the function signature to accept `onHeaderDoubleClick`:

```jsx
export default function ProcessPanel({
  projectName,
  process,
  allocations,
  isFullscreen = false,
  isHidden = false,
  isCarousel = false,
  isCentered = false,
  onToggleFullscreen,
  onCardClick,
  onHeaderDoubleClick,
}) {
```

Find the existing `handleToggleFullscreen` helper:

```jsx
  const handleToggleFullscreen = (e) => {
    e.stopPropagation();
    onToggleFullscreen?.();
  };
```

Add a separate handler for the header's double-click below it:

```jsx
  const handleHeaderDoubleClick = (e) => {
    e.stopPropagation();
    onHeaderDoubleClick?.();
  };
```

Now find the header div:

```jsx
      <div className="process-panel__header" onDoubleClick={handleToggleFullscreen}>
```

Change it to use the new handler:

```jsx
      <div className="process-panel__header" onDoubleClick={handleHeaderDoubleClick}>
```

The `⤢` button is unchanged — it still calls `handleToggleFullscreen` via `onClick`.

- [ ] **Step 2: Pass `onHeaderDoubleClick` from `ProjectTab.jsx`**

In `web/src/components/ProjectTab.jsx`, find the `ProcessPanel` instantiation:

```jsx
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  isCarousel={isCarousel}
                  isCentered={isCentered}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                  onCardClick={isCarousel && !isCentered ? () => centerCard(proc.name) : undefined}
                />
```

Add `onHeaderDoubleClick`:

```jsx
                <ProcessPanel
                  key={proc.name}
                  projectName={project.name}
                  process={proc}
                  allocations={project.allocations}
                  isFullscreen={isFs}
                  isHidden={!!fullscreenName && !isFs}
                  isCarousel={isCarousel}
                  isCentered={isCentered}
                  onToggleFullscreen={() =>
                    setFullscreenName(prev => prev === proc.name ? null : proc.name)
                  }
                  onHeaderDoubleClick={
                    viewMode === 'grid'
                      ? () => setFullscreenName(prev => prev === proc.name ? null : proc.name)
                      : undefined
                  }
                  onCardClick={isCarousel && !isCentered ? () => centerCard(proc.name) : undefined}
                />
```

- [ ] **Step 3: Build check**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

- [ ] **Step 4: Verify in browser**

Reload:
- **Grid mode (default):** double-click a card header → enters fullscreen. Same as before this task.
- **Carousel mode:** double-click the centered card's header → nothing happens. Double-click a peeked card's header → it centers (the wrapper's `onClick` fires; double-click is two clicks; second click is on the now-centered card and is inert).
- The `⤢` button in carousel still enters fullscreen for the centered card.
- Escape exits fullscreen → returns to grid or carousel depending on which mode you were in.

- [ ] **Step 5: Commit**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge && git add web/src/components/ProcessPanel.jsx web/src/components/ProjectTab.jsx && git commit -m "feat(web): only allow header double-click to fullscreen in grid mode"
```

---

## Final verification

- [ ] **Step 1: Production build**

```bash
cd /Users/mikewilliams/Source/brutalsystems/forge/web && npm run build
```

Expected: clean build, no errors.

- [ ] **Step 2: End-to-end walkthrough**

Reload the dashboard. With a project tab open (≥3 processes):

- Default mode is grid (the standard 3/2/1-column layout). Cards behave as before.
- Click `⏵⏴ carousel`. Layout reflows. Trackpad swipe / shift-wheel / click-drag work.
- Click a peeked card — it centers smoothly. The card's drag handle is hidden in carousel.
- Click anywhere on a peek (header / terminal area / buttons) — it centers; nothing else fires.
- Click into the centered terminal — xterm focuses; clicks/keystrokes go to the shell.
- With xterm focused, press `ArrowLeft`/`ArrowRight` — nothing happens to the carousel (terminal gate works).
- Click somewhere outside the terminal, press `ArrowLeft`/`ArrowRight` — carousel steps.
- **scrollLeft preservation across fullscreen↔carousel:** enter carousel, scroll/click to center the 3rd or later card, click `⤢` to fullscreen, press Escape. The carousel should reappear with **the same card still centered** — the DOM element stayed mounted across the class flip, so `scrollLeft` is preserved. If you see card 1 instead, the browser is dropping `scrollLeft` when overflow temporarily goes away; flag it and we'll add a `useLayoutEffect` save/restore.
- Click `⤢` on the centered card — fullscreens it. Press Escape — returns to carousel (not grid).
- Click `⊞ grid` — returns to grid; carousel scroll position resets next time.
- Switch tabs; switch back. View resets to grid (project-change reset).
- Drag a card by `⠿` in grid mode → reorders. Switch to carousel — order matches.

- [ ] **Step 3: Final status check**

```bash
git status
```

Should show only the unrelated pre-existing dirty files (`README.md`, `mongo.js`, untracked plan doc). Anything else in the diff that wasn't committed is leftover and should be staged + committed with an appropriate message, or reverted.
