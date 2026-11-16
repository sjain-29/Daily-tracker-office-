// js/app-nav.js — tiny hash-router helpers shared by the screens.
export function navigate(hash) { location.hash = hash; }

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'today', params: parts.slice(1), query: new URLSearchParams(qs || '') };
}
