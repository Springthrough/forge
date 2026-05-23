# Forge — Plan 4: Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React dashboard served by the Forge daemon showing all registered projects, per-process status with live terminal output, and shared service health.

**Architecture:** A Vite + React app lives in `web/` and compiles to `web/dist/`. The existing Express daemon serves `web/dist/` as static files — all API calls use relative URLs so the UI works on any port. Terminals stream via the existing WebSocket server (Plan 3). No React component tests — the APIs under the UI are already covered by 155 existing tests.

**Tech Stack:** React 18, Vite 5, plain CSS with CSS variables, @dnd-kit/sortable (drag-to-reorder), @xterm/xterm + @xterm/addon-fit (terminal emulation)

---

## Series context

- **Plan 1 (done):** Daemon + registry + port allocator + CLI — 43 tests
- **Plan 2 (done):** Shared services, forge init, forge extend — 114 tests
- **Plan 3 (done):** Process management, forge up/down/open, WebSocket — 155 tests
- **Plan 4 (this):** Web UI

---

## File Map

All paths relative to `/Users/mikewilliams/Source/bh/forge/`.

**New files:**

| File | Responsibility |
|---|---|
| `web/package.json` | Vite sub-project: react, @dnd-kit, @xterm deps |
| `web/index.html` | HTML entry point |
| `web/vite.config.js` | Vite config: root, outDir, dev proxy to daemon |
| `web/src/main.jsx` | React root mount |
| `web/src/App.jsx` | Tab bar state + active tab routing |
| `web/src/components/TabBar.jsx` | Overview tab + one tab per registered project |
| `web/src/components/OverviewTab.jsx` | Two-column: project cards grid + services panel |
| `web/src/components/ProjectCard.jsx` | Single project card with live status badge |
| `web/src/components/ServicesPanel.jsx` | Shared services health list |
| `web/src/components/ProjectTab.jsx` | Project header + sortable process panel list |
| `web/src/components/ProcessPanel.jsx` | Collapsible panel: header controls + terminal body |
| `web/src/components/Terminal.jsx` | xterm.js instance + WebSocket lifecycle |
| `web/src/hooks/useProjects.js` | Polls GET /api/projects every 3 s |
| `web/src/hooks/useProjectProcesses.js` | Polls GET /api/projects/:name/processes every 3 s |
| `web/src/hooks/useServices.js` | Polls GET /api/services every 5 s |
| `web/src/styles/main.css` | CSS variables + all component styles |

**Modified files:**

| File | What changes |
|---|---|
| `package.json` | Add `build:web` and `dev:web` scripts |
| `src/daemon/server.js` | Add `path` require; serve `web/dist/` static files + catch-all |
| `.gitignore` | Add `web/dist/`, `web/node_modules/`, `.superpowers/` |

---

### Task 1: Vite + React scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/vite.config.js`
- Create: `web/src/main.jsx`
- Modify: `package.json` (root)
- Modify: `.gitignore`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "forge-web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `web/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const forgePort = process.env.FORGE_PORT ?? 2525;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': `http://localhost:${forgePort}`,
      '/ws':  { target: `ws://localhost:${forgePort}`, ws: true, rewriteWsOrigin: true },
    },
  },
});
```

- [ ] **Step 4: Create `web/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/main.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Create a minimal `web/src/App.jsx`** (placeholder — replaced in Task 2)

```jsx
export default function App() {
  return <div style={{ color: '#f0f6fc', padding: 20, fontFamily: 'monospace' }}>Forge loading...</div>;
}
```

- [ ] **Step 6: Add scripts to root `package.json`**

In the `"scripts"` block, add after `"test:watch"`:

```json
"build:web": "vite build --config web/vite.config.js",
"dev:web":   "vite --config web/vite.config.js"
```

The full `"scripts"` block becomes:

```json
"scripts": {
  "start": "node src/daemon/server.js",
  "test": "jest",
  "test:watch": "jest --watch",
  "build:web": "vite build --config web/vite.config.js",
  "dev:web":   "vite --config web/vite.config.js"
},
```

- [ ] **Step 7: Update `.gitignore`**

Append to `.gitignore`:

```
web/dist/
web/node_modules/
.superpowers/
```

- [ ] **Step 8: Install web dependencies**

```bash
cd /Users/mikewilliams/Source/bh/forge/web && npm install
```

Expected: `node_modules/` created under `web/`, no errors.

- [ ] **Step 9: Verify dev server starts**

```bash
cd /Users/mikewilliams/Source/bh/forge && npm run dev:web 2>&1 | head -10
```

Expected: Vite prints something like `VITE v5.x.x  ready in ...ms` and `➜  Local: http://localhost:5173/`. Stop with Ctrl-C.

- [ ] **Step 10: Verify build works**

```bash
cd /Users/mikewilliams/Source/bh/forge && npm run build:web 2>&1 | tail -5
```

Expected: `✓ built in ...ms`, `web/dist/` directory created containing `index.html` and `assets/`.

- [ ] **Step 11: Verify daemon tests still pass**

```bash
cd /Users/mikewilliams/Source/bh/forge && npx jest --no-coverage 2>&1 | tail -5
```

Expected: 155 tests passing.

- [ ] **Step 12: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/package.json web/index.html web/vite.config.js web/src/main.jsx web/src/App.jsx package.json .gitignore
git commit -m "feat: scaffold Vite + React web app"
```

---

### Task 2: CSS variables + App shell + TabBar

**Files:**
- Create: `web/src/styles/main.css`
- Create: `web/src/components/TabBar.jsx`
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Create `web/src/styles/main.css`**

```css
:root {
  --bg-base:       #0d1117;
  --bg-surface:    #161b22;
  --bg-overlay:    #21262d;
  --border:        #30363d;
  --text-primary:  #f0f6fc;
  --text-secondary:#8b949e;
  --accent:        #58a6ff;
  --green:         #3fb950;
  --red:           #f85149;
  --yellow:        #d29922;
  --font-mono:     'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  height: 100vh;
  overflow: hidden;
}

/* ── App shell ─────────────────────────────────────────── */
.app { display: flex; flex-direction: column; height: 100vh; }
.tab-content { flex: 1; overflow: auto; }

/* ── Tab bar ────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  padding: 0 12px;
  gap: 2px;
  flex-shrink: 0;
}
.tab {
  padding: 8px 16px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  background: none;
  border: 1px solid transparent;
  border-bottom: none;
  border-top: 2px solid transparent;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
}
.tab:hover { color: var(--text-primary); }
.tab--active {
  color: var(--text-primary);
  background: var(--bg-base);
  border-color: var(--border);
  border-top-color: var(--accent);
  border-bottom-color: var(--bg-base);
  margin-bottom: -1px;
}

/* ── Section label ──────────────────────────────────────── */
.section-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

/* ── Buttons ────────────────────────────────────────────── */
.btn {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: none;
  color: var(--text-secondary);
  white-space: nowrap;
}
.btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
.btn--sm { font-size: 9px; padding: 2px 8px; }
.btn--success { color: var(--green); }
.btn--success:hover { border-color: var(--green); }
.btn--danger { color: var(--red); }
.btn--danger:hover { border-color: var(--red); }
.btn--outline { color: var(--accent); }
.btn--outline:hover { border-color: var(--accent); }

/* ── Badge ──────────────────────────────────────────────── */
.badge {
  font-size: 9px;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
}
.badge--green  { background: #1f6329; color: var(--green); }
.badge--red    { background: #6e1a1a; color: var(--red); }
.badge--yellow { background: #3d2a00; color: var(--yellow); }
.badge--grey   { background: var(--bg-overlay); color: var(--text-secondary); }

/* ── Overview ───────────────────────────────────────────── */
.overview {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 20px;
  padding: 20px;
  height: 100%;
  overflow: auto;
  align-content: start;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

/* ── Project card ───────────────────────────────────────── */
.project-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.project-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.project-card__name  { font-size: 13px; font-weight: 600; }
.project-card__path  { font-size: 10px; color: var(--text-secondary); }
.project-card__procs { display: flex; flex-wrap: wrap; gap: 8px; font-size: 10px; }
.process-dot         { display: flex; align-items: center; gap: 3px; color: var(--text-secondary); }

/* ── Services panel ─────────────────────────────────────── */
.services-list {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.service-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  font-size: 11px;
  border-bottom: 1px solid var(--bg-overlay);
}
.service-row:last-child { border-bottom: none; }

/* ── Project tab ────────────────────────────────────────── */
.project-tab { display: flex; flex-direction: column; height: 100%; }
.project-tab__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.project-tab__title { display: flex; align-items: baseline; gap: 10px; }
.project-tab__name  { font-size: 14px; font-weight: 600; }
.project-tab__path  { font-size: 10px; color: var(--text-secondary); }
.project-tab__actions { display: flex; gap: 8px; }
.process-list {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Process panel ──────────────────────────────────────── */
.process-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.process-panel__header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.process-panel__header:hover { background: var(--bg-overlay); }
.drag-handle {
  color: var(--border);
  font-size: 16px;
  cursor: grab;
  line-height: 1;
  padding: 0 2px;
}
.drag-handle:active { cursor: grabbing; }
.status-dot { font-size: 10px; flex-shrink: 0; }
.process-panel__name { font-size: 12px; font-weight: 600; flex: 1; }
.process-panel__meta { font-size: 10px; color: var(--text-secondary); white-space: nowrap; }
.process-panel__controls { display: flex; gap: 6px; margin-left: auto; }
.chevron { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.process-panel__body {
  border-top: 1px solid var(--bg-overlay);
  height: 220px;
  background: var(--bg-base);
}

/* ── Terminal ────────────────────────────────────────────── */
.terminal-wrap { width: 100%; height: 100%; padding: 4px; }
/* xterm.js injects its own stylesheet; we just size the container */
.terminal-wrap .xterm { height: 100%; }

/* ── Empty state ─────────────────────────────────────────── */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 12px;
}
```

- [ ] **Step 2: Create `web/src/components/TabBar.jsx`**

```jsx
export default function TabBar({ projects, activeTab, onTabChange }) {
  return (
    <nav className="tab-bar">
      <button
        className={`tab${activeTab === 'overview' ? ' tab--active' : ''}`}
        onClick={() => onTabChange('overview')}
      >
        Overview
      </button>
      {projects.map(p => (
        <button
          key={p.name}
          className={`tab${activeTab === p.name ? ' tab--active' : ''}`}
          onClick={() => onTabChange(p.name)}
        >
          {p.name}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Replace `web/src/App.jsx`** with the real shell

```jsx
import { useState } from 'react';
import TabBar from './components/TabBar.jsx';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  // projects wired in Task 3 — hardcode one for now to verify tabs render
  const projects = [];

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        <div className="empty-state">
          Active tab: {activeTab}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test in browser**

Start the dev server (daemon must be running on port 2525 for API calls, but it's not needed yet):

```bash
cd /Users/mikewilliams/Source/bh/forge && npm run dev:web
```

Open `http://localhost:5173`. Verify: dark background, "Overview" tab is active, clicking tabs switches the "Active tab:" text. Stop dev server.

- [ ] **Step 5: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/src/styles/main.css web/src/components/TabBar.jsx web/src/App.jsx
git commit -m "feat: CSS variables, app shell, tab bar"
```

---

### Task 3: Data hooks

**Files:**
- Create: `web/src/hooks/useProjects.js`
- Create: `web/src/hooks/useProjectProcesses.js`
- Create: `web/src/hooks/useServices.js`
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Create `web/src/hooks/useProjects.js`**

```js
import { useState, useEffect } from 'react';

export function useProjects() {
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    let alive = true;
    function poll() {
      fetch('/api/projects')
        .then(r => r.json())
        .then(data => { if (alive) setProjects(data); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return projects;
}
```

- [ ] **Step 2: Create `web/src/hooks/useProjectProcesses.js`**

```js
import { useState, useEffect } from 'react';

export function useProjectProcesses(projectName) {
  const [processes, setProcesses] = useState([]);
  useEffect(() => {
    if (!projectName) return;
    let alive = true;
    function poll() {
      fetch(`/api/projects/${encodeURIComponent(projectName)}/processes`)
        .then(r => r.json())
        .then(data => { if (alive) setProcesses(data.processes ?? []); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [projectName]);
  return processes;
}
```

- [ ] **Step 3: Create `web/src/hooks/useServices.js`**

```js
import { useState, useEffect } from 'react';

export function useServices() {
  const [services, setServices] = useState({});
  useEffect(() => {
    let alive = true;
    function poll() {
      fetch('/api/services')
        .then(r => r.json())
        .then(data => { if (alive) setServices(data); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return services;
}
```

- [ ] **Step 4: Wire `useProjects` into `App.jsx`**

```jsx
import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        <div className="empty-state">
          Active tab: {activeTab} — {projects.length} project(s) loaded
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test with live daemon**

Start the Forge daemon in one terminal:

```bash
cd /Users/mikewilliams/Source/bh/forge && node src/daemon/server.js
```

Start dev server in another:

```bash
cd /Users/mikewilliams/Source/bh/forge && npm run dev:web
```

Open `http://localhost:5173`. The tab bar should show one tab per registered project (or none if none are registered — that's fine). Check the browser Network panel to confirm `/api/projects` is being called. Stop both servers.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/src/hooks/useProjects.js web/src/hooks/useProjectProcesses.js web/src/hooks/useServices.js web/src/App.jsx
git commit -m "feat: data hooks — useProjects, useProjectProcesses, useServices"
```

---

### Task 4: Overview tab

**Files:**
- Create: `web/src/components/OverviewTab.jsx`
- Create: `web/src/components/ProjectCard.jsx`
- Create: `web/src/components/ServicesPanel.jsx`
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Create `web/src/components/ServicesPanel.jsx`**

```jsx
export default function ServicesPanel({ services }) {
  const entries = Object.entries(services);
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="section-label">Shared Services</div>
      <div className="services-list">
        {entries.map(([name, info]) => {
          const healthy = info?.status === 'healthy';
          return (
            <div key={name} className="service-row">
              <span>{name}</span>
              <span style={{ color: healthy ? 'var(--green)' : 'var(--text-secondary)' }}>
                ● {info?.status ?? 'unknown'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ProjectCard.jsx`**

```jsx
import { useProjectProcesses } from '../hooks/useProjectProcesses.js';

export default function ProjectCard({ project, onOpen }) {
  const processes = useProjectProcesses(project.name);
  const configProcs = project.config?.processes ?? [];
  const total   = configProcs.length;
  const running = processes.filter(p => p.status === 'running').length;

  const badgeClass = total === 0        ? 'badge--grey'
                   : running === total  ? 'badge--green'
                   : running === 0      ? 'badge--red'
                   :                      'badge--yellow';

  return (
    <div className="project-card">
      <div className="project-card__header">
        <span className="project-card__name">{project.name}</span>
        {total > 0 && (
          <span className={`badge ${badgeClass}`}>{running}/{total} up</span>
        )}
      </div>
      <div className="project-card__path">{project.path}</div>
      <div className="project-card__procs">
        {configProcs.map(proc => {
          const ps   = processes.find(p => p.name === proc.name);
          const port = project.allocations?.ports?.[proc.name];
          const dotColor = ps?.status === 'running' ? 'var(--green)'
                         : ps?.status === 'crashed' ? 'var(--red)'
                         :                            'var(--text-secondary)';
          return (
            <span key={proc.name} className="process-dot">
              <span style={{ color: dotColor }}>●</span>
              {proc.name}{port ? ` :${port}` : ''}
            </span>
          );
        })}
      </div>
      <button className="btn btn--outline btn--sm" onClick={() => onOpen(project.name)}>
        Open ↗
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/components/OverviewTab.jsx`**

```jsx
import { useServices } from '../hooks/useServices.js';
import ProjectCard from './ProjectCard.jsx';
import ServicesPanel from './ServicesPanel.jsx';

export default function OverviewTab({ projects, onOpenProject }) {
  const services = useServices();

  return (
    <div className="overview">
      <div>
        <div className="section-label">Projects</div>
        {projects.length === 0 ? (
          <div className="empty-state" style={{ height: 'auto', padding: '20px 0' }}>
            No projects registered. Run: forge add
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(p => (
              <ProjectCard key={p.name} project={p} onOpen={onOpenProject} />
            ))}
          </div>
        )}
      </div>
      <ServicesPanel services={services} />
    </div>
  );
}
```

- [ ] **Step 4: Wire OverviewTab into `App.jsx`**

```jsx
import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        {activeTab === 'overview' ? (
          <OverviewTab projects={projects} onOpenProject={setActiveTab} />
        ) : (
          <div className="empty-state">Project tab — Task 5</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test with live daemon**

With daemon running and at least one project registered (`forge add`), open `http://localhost:5173`. Verify:
- Overview shows project cards with name, path, badge, process dots
- Services panel appears if services are configured
- "Open ↗" on a card switches to the empty placeholder tab

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/src/components/OverviewTab.jsx web/src/components/ProjectCard.jsx \
        web/src/components/ServicesPanel.jsx web/src/App.jsx
git commit -m "feat: overview tab — project cards and services panel"
```

---

### Task 5: Project tab + Process panels (no terminal yet)

**Files:**
- Create: `web/src/components/ProcessPanel.jsx`
- Create: `web/src/components/ProjectTab.jsx`
- Modify: `web/src/App.jsx`

`@dnd-kit/sortable` is already in `web/package.json` from Task 1 and is installed.

- [ ] **Step 1: Create `web/src/components/ProcessPanel.jsx`**

```jsx
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function formatUptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export default function ProcessPanel({ projectName, process, allocations }) {
  const [expanded, setExpanded] = useState(true);

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
      <div className="process-panel__header" onClick={() => setExpanded(v => !v)}>
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
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="process-panel__body">
          <div className="empty-state" style={{ fontSize: 10 }}>
            Terminal — Task 6
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ProjectTab.jsx`**

```jsx
import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useProjectProcesses } from '../hooks/useProjectProcesses.js';
import ProcessPanel from './ProcessPanel.jsx';

function storageKey(name) { return `forge:panel-order:${name}`; }

function mergeOrder(stored, processes) {
  const names = processes.map(p => p.name);
  const valid = stored.filter(n => names.includes(n));
  names.forEach(n => { if (!valid.includes(n)) valid.push(n); });
  return valid;
}

export default function ProjectTab({ project }) {
  const processes    = useProjectProcesses(project?.name);
  const [order, setOrder] = useState([]);

  useEffect(() => {
    if (!project || processes.length === 0) return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey(project.name)) ?? '[]');
      setOrder(mergeOrder(stored, processes));
    } catch {
      setOrder(processes.map(p => p.name));
    }
  }, [project?.name]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    setOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id));
      localStorage.setItem(storageKey(project.name), JSON.stringify(next));
      return next;
    });
  }

  const handleUpAll = () =>
    fetch(`/api/projects/${encodeURIComponent(project.name)}/processes/up`, { method: 'POST' });
  const handleDownAll = () =>
    fetch(`/api/projects/${encodeURIComponent(project.name)}/processes/down`, { method: 'POST' });

  if (!project) return <div className="empty-state">Project not found.</div>;

  const orderedProcesses = order
    .map(name => processes.find(p => p.name === name))
    .filter(Boolean);

  return (
    <div className="project-tab">
      <div className="project-tab__header">
        <div className="project-tab__title">
          <span className="project-tab__name">{project.name}</span>
          <span className="project-tab__path">{project.path}</span>
        </div>
        <div className="project-tab__actions">
          <button className="btn btn--success btn--sm" onClick={handleUpAll}>▶ up all</button>
          <button className="btn btn--danger btn--sm" onClick={handleDownAll}>■ down all</button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
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
    </div>
  );
}
```

- [ ] **Step 3: Wire ProjectTab into `App.jsx`**

```jsx
import { useState } from 'react';
import { useProjects } from './hooks/useProjects.js';
import TabBar from './components/TabBar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import ProjectTab from './components/ProjectTab.jsx';

export default function App() {
  const projects = useProjects();
  const [activeTab, setActiveTab] = useState('overview');

  const activeProject = projects.find(p => p.name === activeTab);

  return (
    <div className="app">
      <TabBar projects={projects} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="tab-content">
        {activeTab === 'overview' ? (
          <OverviewTab projects={projects} onOpenProject={setActiveTab} />
        ) : (
          <ProjectTab project={activeProject} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test**

With daemon running and a project registered with at least one process:
1. Navigate to a project tab — process panels appear with name, status dot, controls
2. Clicking a panel header collapses/expands the terminal placeholder
3. Drag ⠿ handle to reorder panels — order persists after page refresh
4. "▶ up all" and "■ down all" buttons send requests (check Network tab)
5. "restart" / "stop" / "start" buttons send requests (check Network tab or WS frames)

- [ ] **Step 5: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/src/components/ProcessPanel.jsx web/src/components/ProjectTab.jsx web/src/App.jsx
git commit -m "feat: project tab with collapsible process panels and drag-to-reorder"
```

---

### Task 6: Terminal component (xterm.js + WebSocket)

**Files:**
- Create: `web/src/components/Terminal.jsx`
- Modify: `web/src/components/ProcessPanel.jsx`

`@xterm/xterm` and `@xterm/addon-fit` are already in `web/package.json` from Task 1.

- [ ] **Step 1: Create `web/src/components/Terminal.jsx`**

```jsx
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function Terminal({ projectName, processName }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor:     '#f0f6fc',
        selection:  'rgba(248,241,227,0.2)',
      },
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 1000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const ws = new WebSocket(
      `ws://${window.location.host}/ws?project=${encodeURIComponent(projectName)}&process=${encodeURIComponent(processName)}`
    );

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        if (msg.type === 'error')  term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      } catch {}
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const observer = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [projectName, processName]);

  return <div ref={containerRef} className="terminal-wrap" />;
}
```

- [ ] **Step 2: Replace the terminal placeholder in `ProcessPanel.jsx`**

Replace the `{expanded && ...}` block at the bottom of `ProcessPanel`:

```jsx
      {expanded && (
        <div className="process-panel__body">
          <Terminal projectName={projectName} processName={process.name} />
        </div>
      )}
```

Add the import at the top of `ProcessPanel.jsx`:

```jsx
import Terminal from './Terminal.jsx';
```

The full updated `ProcessPanel.jsx` (show the import block and the expanded section — only these two parts change):

```jsx
import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Terminal from './Terminal.jsx';

// ... (formatUptime and sendWsOnce helpers unchanged) ...

export default function ProcessPanel({ projectName, process, allocations }) {
  // ... (all existing code unchanged until the last return block) ...

      {expanded && (
        <div className="process-panel__body">
          <Terminal projectName={projectName} processName={process.name} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test terminal with a live process**

1. Register a project and run `forge up <project>` from the CLI to start processes.
2. Open `http://localhost:5173`, navigate to the project tab.
3. Expand a running process panel — the xterm.js terminal should appear showing buffered output.
4. Click the terminal and type a character — verify it sends an input WS message (check DevTools WS frames).
5. Resize the browser window — verify the terminal resizes to fit.
6. Collapse the panel — verify the WebSocket closes (check DevTools Network → WS connection closes).

- [ ] **Step 4: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add web/src/components/Terminal.jsx web/src/components/ProcessPanel.jsx
git commit -m "feat: Terminal component — xterm.js with WebSocket lifecycle"
```

---

### Task 7: Daemon serves the UI

**Files:**
- Modify: `src/daemon/api/processes.js`
- Modify: `src/daemon/server.js`

- [ ] **Step 1: Add individual up/down REST routes to `src/daemon/api/processes.js`**

Add these two routes after the existing `router.post('/down', ...)` block and before `router.post('/:processName/restart', ...)`:

```js
  router.post('/:processName/up', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.startProcess(
      req.params.name, req.params.processName,
      project.config?.processes ?? [], project.allocations ?? {}, project.path
    );
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });

  router.post('/:processName/down', (req, res) => {
    const project = registry.get(req.params.name);
    if (!project) return res.status(404).json({ error: `"${req.params.name}" not found` });
    processManager.stopProcess(req.params.name, req.params.processName);
    res.json({ ok: true, project: req.params.name, process: req.params.processName });
  });
```

These power the start/stop buttons in `ProcessPanel` (REST instead of fire-and-forget WebSocket).

- [ ] **Step 2: Add `path` and `fs` requires + static middleware to `src/daemon/server.js`**

Add after the existing `require` block at the top of the file (after line 12, before `function createServer`):

```js
const path = require('path');
const fs   = require('fs');
```

Add at the end of `createServer`, just before the `return` statement:

```js
  const webDist = path.join(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
```

The `fs.existsSync` guard prevents the catch-all from running when `web/dist/` doesn't exist (e.g. during tests), which would otherwise intercept unmatched GET routes.

The full modified area of `server.js` (the `createServer` function ending and `require.main` block — only the `return` line changes, everything else is identical):

```js
  const webDist = path.join(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return { app, server, wss, registry: reg, portAllocator: alloc, serviceManager: svcMgr, processManager: pm };
}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd /Users/mikewilliams/Source/bh/forge && npx jest --no-coverage 2>&1 | tail -5
```

Expected: 155 tests passing. (The catch-all is guarded by `fs.existsSync` so it won't affect tests.)

- [ ] **Step 4: Build the UI**

```bash
cd /Users/mikewilliams/Source/bh/forge && npm run build:web 2>&1 | tail -5
```

Expected: `✓ built in ...ms`, `web/dist/index.html` exists.

- [ ] **Step 5: Smoke-test the daemon serving the UI**

Start the daemon:

```bash
cd /Users/mikewilliams/Source/bh/forge && node src/daemon/server.js
```

Open `http://localhost:2525` in a browser. Verify the Forge dashboard loads (tab bar, overview). Test that API calls work (project cards load if projects are registered). Test `forge open` from the CLI — it should open `http://localhost:2525`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mikewilliams/Source/bh/forge
git add src/daemon/api/processes.js src/daemon/server.js
git commit -m "feat: daemon serves web/dist/ as static files; add per-process up/down REST routes"
```

---

## Self-review checklist

After writing this plan, verify against the spec:

- ✅ `web/` file structure matches spec exactly
- ✅ Tab bar: Overview + one tab per project from `GET /api/projects`
- ✅ Overview: project cards with X/Y badge (via `useProjectProcesses`), Open ↗ navigates to project tab
- ✅ Services panel: lists each service with health dot
- ✅ Per-project tab: project header with up all/down all, stacked process panels
- ✅ ProcessPanel: drag handle (⠿), status dot, name, port, uptime, controls, collapse/expand
- ✅ `localStorage` key `forge:panel-order:<name>` for panel order persistence
- ✅ Controls: running → restart (REST) + stop (WS); stopped/crashed → start (WS)
- ✅ Terminal: xterm.js + FitAddon, WS connects on expand / disconnects on collapse
- ✅ WS URL: `ws://${window.location.host}?project=...&process=...`
- ✅ Resize → `{ type: 'resize', cols, rows }` WS message
- ✅ Input → `{ type: 'input', data }` WS message
- ✅ Root `package.json` scripts: `build:web`, `dev:web`
- ✅ `web/vite.config.js`: `FORGE_PORT` env var for dev proxy
- ✅ Daemon serves `web/dist/` with `fs.existsSync` guard on catch-all
- ✅ `.gitignore`: `web/dist/`, `web/node_modules/`, `.superpowers/`
- ✅ No React unit tests (as spec states)
