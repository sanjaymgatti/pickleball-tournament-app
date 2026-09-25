async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function requireLogin() {
  try {
    const data = await api('/auth/me');
    return data.user;
  } catch (e) {
    window.location.href = '/index.html';
    return null;
  }
}
