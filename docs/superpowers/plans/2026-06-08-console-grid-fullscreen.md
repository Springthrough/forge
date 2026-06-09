# Console grid view + fullscreen toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vertical stack of process consoles in a project tab with a responsive 3/2/1-column card grid, and let the user double-click a card (or click `⤢`) to maximize it with `Escape` to exit.

**Architecture:** Pure frontend change in `web/`. `.process-list` becomes a CSS Grid with breakpoint-based column counts. `ProcessPanel` loses its local collapse state; cards always show their console at a fixed 280 px body. A new `fullscreenName: string | null` state lives in `ProjectTab`, drives conditional rendering (grid vs single maximized panel), and binds a document-level `keydown` listener for `Escape`. The dnd-kit sortable strategy switches from vertical to rect so grid reorder works.

**Tech Stack:** React 18 + Vite, `@dnd-kit/core` + `@dnd-kit/sortable`, `@xterm/xterm` with `addon-fit`, plain CSS.

**No test harness:** The `web/` package has no test runner. Verification is manual — run the dev server, reload the dashboard, and observe behavior at the listed window widths.

**Spec:** `docs/superpowers/specs/2026-06-08-console-grid-fullscreen-design.md`

---

## File Structure

- `web/src/components/ProcessPanel.jsx` — drop `expanded`/chevron; add `isFullscreen` / `onToggleFullscreen` props; add header `onDoubleClick`; add `⤢` toggle button.
- `web/src/components/ProjectTab.jsx` — add `fullscreenName` state, ESC `useEffect`, conditional render, swap sort strategy.
- `web/src/styles/main.css` — `.process-list` becomes a grid; `.process-panel__body` body height bumped to 280 px; add `.process-panel--fullscreen` rule; drop `.chevron`.

Three files, modified across five tasks. No new files.

---

## Pre-flight

- [ ] **Step 0: Start the dev server (leave running for the whole plan)**

In a separate terminal:

```bash
cd web && npm run dev
```

Confirm Vite reports `Local: http://localhost:3000/` (or similar). Open the dashboard in a browser. Pick a project tab with **at least 3 running processes** so the grid is visibly different from the stack. Keep this tab open across all tasks — Vite HMR will reload it.

---

## Task 1: Remove per-card collapse, drop the chevron

Pure refactor inside `ProcessPanel`. Cards always render the terminal body. This is the smallest behavior change and isolates it from later layout work.

**Files:**
- Modify: `web/src/components/ProcessPanel.jsx`
- Modify: `web/src/styles/main.css` (remove the `.chevron` rule)

- [ ] **Step 1: Replace `ProcessPanel.jsx` with the no-collapse version**

Open `web/src/components/ProcessPanel.jsx` and replace its entire contents with:

```jsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Terminal from './Terminal.jsx';

function formatUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export default function ProcessPanel({ projectName, process, allocations }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: process.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const port = allocations?.ports?.[process.name];
  const dotColor = process.status === 'running' ? 'var(--green)'
                 : process.status === 'crashed' ? 'var(--red)'
                 :                                'var(--text-secondary)';

  const apiBase = `/api/projects/${encodeURIComponent(projectName)}/processes/${encodeURIComponent(process.name)}`;

  const handleRestart = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/restart`, { method: 'POST' });
  };
  const handleStop = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/down`, { method: 'POST' });
  };
  const handleStart = (e) => {
    e.stopPropagation();
    fetch(`${apiBase}/up`, { method: 'POST' });
  };

  return (
    <div ref={setNodeRef} style={style} className="process-panel">
      <div className="process-panel__header">
        <span
          className="drag-handle"
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
        >⠿</span>
        <span className="status-dot" style={{ color: dotColor }}>●</span>
        <span className="process-panel__name">{process.name}</span>
        <span className="process-panel__meta">
          {port ? `:${port}` : ''}
          {process.status === 'running' && process.uptime > 0
            ? `${port ? ' · ' : ''}up ${formatUptime(process.uptime)}`
            : ''}
        </span>
        <div className="process-panel__controls">
          {process.status === 'running' ? (
            <>
              <button className="btn btn--sm" onClick={handleRestart}>restart</button>
              <button className="btn btn--sm btn--danger" onClick={handleStop}>stop</button>
            </>
          ) : (
            <button className="btn btn--sm btn--success" onClick={handleStart}>start</button>
          )}
        </div>
      </div>
      <div className="process-panel__body">
        <Terminal projectName={projectName} processName={process.name} />
      </div>
    </div>
  );
}
```

Differences from the previous version: no `useState` import, no `expanded` state, no `onClick` on the header div, no `chevron` span, body is unconditionally rendered.

- [ ] **Step 2: Drop the `.chevron` CSS rule**

Open `web/src/styles/main.css`, find the line:

```css
.chevron { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
```

Delete that one line. Leave surrounding rules untouched.

- [ ] **Step 3: Verify in browser**

Reload the dashboard tab. Confirm:
- Every process card still shows its terminal — no chevrons in the header.
- Clicking the header does nothing (no collapse).
- Drag handle (`⠿`) still drags. Restart/stop/start buttons still work.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ProcessPanel.jsx web/src/styles/main.css
git commit -m "refactor(web): drop per-card collapse, cards always show console"
```

---

## Task 2: Convert `.process-list` to a responsive grid

Switch the stack to a CSS Grid with explicit breakpoints. Bump the terminal body height from 220 px → 280 px to make narrower cards usable.

**Files:**
- Modify: `web/src/styles/main.css`

- [ ] **Step 1: Replace the `.process-list` rule and the `.process-panel__body` rule**

In `web/src/styles/main.css`, find:

```css
.process-list {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

Replace it with:

```css
.process-list {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  align-content: start;
}
@media (min-width: 900px)  { .process-list { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1400px) { .process-list { grid-template-columns: repeat(3, 1fr); } }
```

Then find:

```css
.process-panel__body {
  border-top: 1px solid var(--bg-overlay);
  height: 220px;
  background: var(--bg-base);
}
```

Replace it with:

```css
.process-panel__body {
  border-top: 1px solid var(--bg-overlay);
  height: 280px;
  background: var(--bg-base);
}
```

(`align-content: start` keeps cards anchored at the top of the scroll area instead of stretching when there are only one or two of them.)

- [ ] **Step 2: Verify breakpoints**

Reload the dashboard. Resize the browser window in steps and confirm:
- Window ≥ 1400 px wide: 3 columns.
- 900–1399 px wide: 2 columns.
- < 900 px wide: 1 column.
- Terminals in each card render their content correctly (xterm `FitAddon`'s `ResizeObserver` should refit automatically; if the terminal looks misaligned, click into it once — that's a known xterm idiosyncrasy on first paint, not a bug introduced here).

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/main.css
git commit -m "feat(web): responsive 3/2/1-column grid for process consoles"
```

---

## Task 3: Switch dnd-kit sortable strategy from vertical to rect

The default vertical list strategy doesn't compute drop targets correctly in a 2D grid. dnd-kit ships a `rectSortingStrategy` for exactly this case.

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`

- [ ] **Step 1: Swap the import and the `strategy` prop**

In `web/src/components/ProjectTab.jsx`, find:

```jsx
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
```

Change `verticalListSortingStrategy` → `rectSortingStrategy`:

```jsx
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
```

Then find the JSX:

```jsx
<SortableContext items={order} strategy={verticalListSortingStrategy}>
```

Change to:

```jsx
<SortableContext items={order} strategy={rectSortingStrategy}>
```

- [ ] **Step 2: Verify drag-to-reorder in the grid**

Reload the dashboard. At a window width that gives 2 or 3 columns:
- Grab a card by its `⠿` handle.
- Drag it to a different grid cell. Other cards should reflow to make space.
- Drop it. Reload the page. The new order persists (it's saved to `localStorage` under `forge:panel-order:<project>`).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ProjectTab.jsx
git commit -m "fix(web): use dnd-kit rect strategy so grid reorder works"
```

---

## Task 4: Add fullscreen state, `⤢` toggle, double-click trigger

This is the substantive task. `ProjectTab` owns a `fullscreenName` state. `ProcessPanel` learns to receive `isFullscreen` and `onToggleFullscreen`. Header double-click and a new `⤢` header button both call `onToggleFullscreen`. When `fullscreenName !== null`, `ProjectTab` renders only the matching panel (filling the body area) and hides the grid and the Shared Services section.

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`
- Modify: `web/src/components/ProcessPanel.jsx`
- Modify: `web/src/styles/main.css`

- [ ] **Step 1: Add `fullscreenName` state and conditional render in `ProjectTab.jsx`**

In `web/src/components/ProjectTab.jsx`, find the line that adds local state at the top of the `ProjectTab` component:

```jsx
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);
  const { catalog, enabled, busy, toggle } = useServicesSection(project);
```

Add a `fullscreenName` state and an auto-exit effect right after that block:

```jsx
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);
  const [fullscreenName, setFullscreenName] = useState(null);
  const { catalog, enabled, busy, toggle } = useServicesSection(project);

  useEffect(() => {
    if (fullscreenName && !processes.some(p => p.name === fullscreenName)) {
      setFullscreenName(null);
    }
  }, [fullscreenName, processes]);
```

(The auto-exit effect handles the edge case from the spec: if the fullscreened process disappears from the list, drop back to the grid.)

Then find the JSX that renders the grid + Shared Services:

```jsx
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="process-list">
            {orderedProcesses.map(proc => (
              <ProcessPanel
                key={proc.name}
                projectName={project.name}
                process={proc}
                allocations={project.allocations}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {catalog.length > 0 && (
        <div className="services-section">
          ...unchanged...
        </div>
      )}
```

Wrap the conditional. Replace from `<DndContext ...>` through the closing `)}` after the services section with:

```jsx
      {fullscreenName ? (
        (() => {
          const proc = processes.find(p => p.name === fullscreenName);
          if (!proc) return null;
          return (
            <div className="process-list process-list--fullscreen">
              <ProcessPanel
                key={proc.name}
                projectName={project.name}
                process={proc}
                allocations={project.allocations}
                isFullscreen={true}
                onToggleFullscreen={() => setFullscreenName(null)}
              />
            </div>
          );
        })()
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <div className="process-list">
                {orderedProcesses.map(proc => (
                  <ProcessPanel
                    key={proc.name}
                    projectName={project.name}
                    process={proc}
                    allocations={project.allocations}
                    isFullscreen={false}
                    onToggleFullscreen={() => setFullscreenName(proc.name)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {catalog.length > 0 && (
            <div className="services-section">
              <div className="section-label">Shared Services</div>
              <div className="services-toggle-list">
                {catalog.map(svc => {
                  const isEnabled = !!enabled[svc];
                  const isBusy = busy === svc;
                  const envVar = enabled[svc]?.env;
                  return (
                    <div key={svc} className="services-toggle-row">
                      <span className="services-toggle-name">{svc}</span>
                      {isEnabled && envVar && (
                        <span className="services-toggle-env">{envVar}</span>
                      )}
                      <button
                        className={`btn btn--sm ${isEnabled ? 'btn--danger' : 'btn--outline'}`}
                        onClick={() => toggle(svc)}
                        disabled={isBusy}
                      >
                        {isBusy ? '…' : isEnabled ? 'disable' : 'enable'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 2: Wire `isFullscreen` + `onToggleFullscreen` into `ProcessPanel.jsx`**

In `web/src/components/ProcessPanel.jsx`, change the function signature:

```jsx
export default function ProcessPanel({ projectName, process, allocations }) {
```

to:

```jsx
export default function ProcessPanel({
  projectName,
  process,
  allocations,
  isFullscreen = false,
  onToggleFullscreen,
}) {
```

Add the toggle handler near the other handlers:

```jsx
  const handleToggleFullscreen = (e) => {
    e.stopPropagation();
    onToggleFullscreen?.();
  };
```

Update the wrapper `<div>` to apply the fullscreen class:

```jsx
    <div
      ref={setNodeRef}
      style={style}
      className={`process-panel${isFullscreen ? ' process-panel--fullscreen' : ''}`}
    >
```

Add `onDoubleClick` to the header div, plus `stopPropagation` on the drag handle and controls:

```jsx
      <div className="process-panel__header" onDoubleClick={handleToggleFullscreen}>
        <span
          className="drag-handle"
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >⠿</span>
        <span className="status-dot" style={{ color: dotColor }}>●</span>
        <span className="process-panel__name">{process.name}</span>
        <span className="process-panel__meta">
          {port ? `:${port}` : ''}
          {process.status === 'running' && process.uptime > 0
            ? `${port ? ' · ' : ''}up ${formatUptime(process.uptime)}`
            : ''}
        </span>
        <div className="process-panel__controls" onDoubleClick={e => e.stopPropagation()}>
          {process.status === 'running' ? (
            <>
              <button className="btn btn--sm" onClick={handleRestart}>restart</button>
              <button className="btn btn--sm btn--danger" onClick={handleStop}>stop</button>
            </>
          ) : (
            <button className="btn btn--sm btn--success" onClick={handleStart}>start</button>
          )}
          <button
            className="btn btn--sm"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'exit fullscreen (Esc)' : 'fullscreen'}
          >
            {isFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
```

- [ ] **Step 3: Add `.process-panel--fullscreen` + `.process-list--fullscreen` CSS**

In `web/src/styles/main.css`, immediately after the `.process-panel__body` rule, add:

```css
.process-list--fullscreen { display: block; padding: 12px 16px; height: 100%; }
.process-panel--fullscreen { height: 100%; display: flex; flex-direction: column; }
.process-panel--fullscreen .process-panel__body { flex: 1; height: auto; }
```

The `.process-list--fullscreen` rule overrides the grid so the single panel can stretch to fill the height. The `.process-panel--fullscreen` rules let the body grow instead of using the fixed 280 px.

- [ ] **Step 4: Verify fullscreen behavior**

Reload the dashboard. In a project tab:
- Double-click the header of any card (the bar with the name, not the terminal area). The grid disappears, that one card fills the body area below the project header, and its terminal expands to fit. The Shared Services section is gone.
- Click the `⤡` button in the maximized card's header. You're back at the grid; Shared Services is back.
- Double-click again, then click the `⤢` glyph (now `⤡`) — same exit.
- Double-click a drag handle, a restart button, or a stop button — fullscreen should **not** toggle. The button's own action (or none, for the handle) is what happens.
- Double-click *inside* the terminal area — fullscreen should **not** toggle. (The terminal will word-select instead, which is expected xterm behavior.)
- While in fullscreen, click the project's `▶ up all` / `■ down all` buttons — they still work. Click another tab in the tab bar — the tab switch works; when you come back, the original tab is back in grid mode (fullscreen state is per-tab-component-instance; this is fine).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProjectTab.jsx web/src/components/ProcessPanel.jsx web/src/styles/main.css
git commit -m "feat(web): double-click a console card to fullscreen it"
```

---

## Task 5: Exit fullscreen with `Escape`

A `document`-level `keydown` listener registered only while `fullscreenName !== null`. Cleanup removes the listener.

**Files:**
- Modify: `web/src/components/ProjectTab.jsx`

- [ ] **Step 1: Add the keydown effect**

In `web/src/components/ProjectTab.jsx`, just after the auto-exit `useEffect` you added in Task 4 (the one that resets `fullscreenName` if the process disappears), add another effect:

```jsx
  useEffect(() => {
    if (!fullscreenName) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setFullscreenName(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreenName]);
```

(Effect only runs when `fullscreenName` is non-null. Listener is removed when the effect re-runs or when `ProjectTab` unmounts. Listener is attached at the document level so it fires even when xterm has focus.)

- [ ] **Step 2: Verify**

Reload the dashboard. In a project tab:
- Double-click a card header to fullscreen.
- Press `Escape` — you should immediately be back at the grid.
- Fullscreen again, then click into the terminal so xterm has focus. Press `Escape` — you should still exit fullscreen. (xterm will also receive the Escape and may interpret it; this is the acknowledged tradeoff from the spec.)
- Exit fullscreen (any way). Press `Escape` again — nothing happens. (Listener is only bound while fullscreen.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ProjectTab.jsx
git commit -m "feat(web): press Escape to exit fullscreen console"
```

---

## Final verification

- [ ] **Step 1: Run a production build to catch syntax errors that HMR may have papered over**

```bash
cd web && npm run build
```

Expected: completes without errors and produces `web/dist/`. (Warnings about chunk size are OK.)

- [ ] **Step 2: Walk through the whole flow one more time**

Reload the dev dashboard. With a project tab open:
- 3-column grid at wide window, 2 at medium, 1 at narrow.
- Drag a card to reorder; refresh — order persists.
- Double-click header → fullscreen. Escape → grid. `⤢`/`⤡` button → toggles either way.
- Shared Services visible in grid mode, hidden in fullscreen mode.
- Restart / stop / start buttons still work in both modes.

- [ ] **Step 3: Final commit (if any leftover changes)**

```bash
git status
```

If clean, you're done. If anything outstanding, commit it with an appropriate message.
