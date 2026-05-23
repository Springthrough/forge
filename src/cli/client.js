// src/cli/client.js
const { FORGE_PORT } = require('../constants');

const BASE = `http://localhost:${FORGE_PORT}`;

async function call(method, urlPath, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status });
  return data;
}

async function isDaemonRunning() {
  try { await call('GET', '/api/health'); return true; } catch { return false; }
}

const enc = encodeURIComponent;

module.exports = {
  isDaemonRunning,
  health:          ()                => call('GET',    '/api/health'),
  getProjects:     ()                => call('GET',    '/api/projects'),
  getProject:      (name)            => call('GET',    `/api/projects/${enc(name)}`),
  registerProject: (config)          => call('POST',   '/api/projects/register', config),
  removeProject:   (name)            => call('DELETE', `/api/projects/${enc(name)}`),
  syncProject:     (name, body)      => call('POST',   `/api/projects/${enc(name)}/sync`, body),
  getServices:     ()                => call('GET',    '/api/services'),
  startServices:   (name)            => call('POST',   name ? `/api/services/up/${enc(name)}` : '/api/services/up'),
  stopServices:    (name)            => call('POST',   name ? `/api/services/down/${enc(name)}` : '/api/services/down'),
  getProcesses:    (name)            => call('GET',    `/api/projects/${enc(name)}/processes`),
  upProject:       (name)            => call('POST',   `/api/projects/${enc(name)}/processes/up`),
  downProject:     (name)            => call('POST',   `/api/projects/${enc(name)}/processes/down`),
  restartProcess:  (name, proc)      => call('POST',   `/api/projects/${enc(name)}/processes/${proc}/restart`),
  getLogs:         (name, proc, n)   => call('GET',    `/api/projects/${enc(name)}/processes/${proc}/logs${n ? `?lines=${n}` : ''}`),
  listInstances:   ()                => call('GET',    '/api/services/instances'),
  addInstance:     (type, instance, { port, replicaSet } = {}) =>
    call('POST', '/api/services/instances', {
      type,
      instance,
      ...(port ? { port } : {}),
      options: { ...(replicaSet ? { replicaSet: true } : {}) },
    }),
  removeInstance:  (key)             => call('DELETE', `/api/services/instances/${enc(key)}`),
  configureInstance: (key, updates)  => call('PATCH',  `/api/services/instances/${enc(key)}`, updates),
};
