<template>
  <div class="admin-soft-shell">
    <!-- ============ Administrator login (ADR-0005) ============ -->
    <div v-if="authState === 'checking'" class="gate-stage">
      <div class="soft-card gate-card">
        <p class="eyebrow">WhiteVue Pilot</p>
        <div class="spinner-well"><div class="spinner"></div></div>
        <p class="muted">Sprawdzanie sesji…</p>
      </div>
    </div>

    <div v-else-if="authState === 'anonymous'" class="gate-stage">
      <form class="soft-card gate-card" @submit.prevent="login">
        <p class="eyebrow">WhiteVue Pilot</p>
        <h1 class="gate-title">Panel administratora</h1>
        <p class="muted gate-sub">Wprowadź wspólne hasło, aby zarządzać dostępami.</p>

        <label class="field-label" for="admin-passphrase">Hasło administratora</label>
        <input
          id="admin-passphrase"
          ref="passphraseInput"
          v-model="passphrase"
          type="password"
          class="soft-input"
          autocomplete="current-password"
          placeholder="••••••••••••"
          :disabled="loginPending"
        />

        <div v-if="loginError" class="soft-alert" role="alert">{{ loginError }}</div>

        <button type="submit" class="soft-btn accent full" :disabled="loginPending || !passphrase">
          {{ loginPending ? 'Sprawdzanie…' : 'Odblokuj panel' }}
        </button>
        <p class="fineprint">Sesja wygasa po 12 godzinach. Hasło nie jest zapisywane w przeglądarce.</p>
      </form>
    </div>

    <!-- ============ Panel ============ -->
    <template v-else>
      <header class="panel-head">
        <div>
          <p class="eyebrow">WhiteVue Pilot</p>
          <h1 class="panel-title">Nauczyciele i linki dostępu</h1>
          <p class="muted">Wyświetlanie listy nie zmienia żadnego linku. Regeneracja jest zawsze świadomą decyzją.</p>
        </div>
        <button class="soft-btn quiet" @click="logout" title="Zakończ sesję administratora">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Wyloguj
        </button>
      </header>

      <div class="panel-grid">
        <!-- Add teacher -->
        <aside class="rail">
          <section class="soft-card">
            <h2 class="card-title">Dodaj nauczyciela</h2>
            <p class="muted small">Etykieta wewnętrzna służy tylko obsłudze biura — uczniowie jej nie widzą.</p>

            <label class="field-label" for="new-email">Adres email</label>
            <input id="new-email" v-model="manual.email" type="email" class="soft-input" placeholder="nauczyciel@szkola.pl" :disabled="addPending" />

            <label class="field-label" for="new-label">Etykieta wewnętrzna (opcjonalnie)</label>
            <input id="new-label" v-model="manual.internalLabel" type="text" class="soft-input" placeholder="np. Kowalski — fizyka" :disabled="addPending" />

            <button class="soft-btn accent full" :disabled="addPending || !manual.email" @click="addTeacher">
              {{ addPending ? 'Dodawanie…' : 'Dodaj i wygeneruj link' }}
            </button>

            <div v-if="addError" class="soft-alert" role="alert">{{ addError }}</div>

            <!-- Signature: the keyway — a recessed channel that holds the credential. -->
            <div v-if="freshLink" class="keyway fresh">
              <div class="keyway-top">
                <span class="keyway-label">Nowy link dostępu nauczyciela</span>
                <button class="soft-btn mini" :class="{ copied: copiedKeyway }" @click="copy(freshLink, 'keyway')">
                  {{ copiedKeyway ? 'Skopiowano' : 'Kopiuj' }}
                </button>
              </div>
              <div class="keyway-channel">{{ freshLink }}</div>
            </div>
          </section>

          <section class="soft-card hint-card">
            <h2 class="card-title">Jak działają linki</h2>
            <ul class="hint-list">
              <li>Jeden aktywny link na nauczyciela — kopiujesz go z listy, nic nie musisz generować.</li>
              <li>Regeneracja unieważnia wyłącznie stary link. Tablice zostają bez zmian.</li>
              <li>Wyłączenie nauczyciela odbiera dostęp natychmiast — wszystkim linkom i sesjom.</li>
            </ul>
          </section>
        </aside>

        <!-- Teacher list -->
        <main class="soft-card list-card">
          <div class="list-head">
            <h2 class="card-title">Baza nauczycieli</h2>
            <div class="list-tools">
              <span class="muted mono">{{ teachers.length }} {{ teachers.length === 1 ? 'nauczyciel' : 'nauczycieli' }}</span>
              <button class="soft-btn quiet icon" :disabled="loading" title="Odśwież listę" @click="loadTeachers">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
              </button>
            </div>
          </div>

          <!-- Load failure is an ERROR state, never an empty list (QA P1-1). -->
          <div v-if="loadError" class="list-state">
            <p class="soft-alert wide" role="alert">{{ loadError }}</p>
            <button class="soft-btn quiet" @click="loadTeachers">Spróbuj ponownie</button>
          </div>

          <div v-else-if="loading" class="list-state">
            <div class="spinner-well"><div class="spinner"></div></div>
            <p class="muted">Ładowanie listy…</p>
          </div>

          <div v-else-if="!teachers.length" class="list-state">
            <p class="muted">Nie dodano jeszcze żadnego nauczyciela.</p>
            <p class="muted small">Zacznij od formularza po lewej — link dostępu utworzy się sam.</p>
          </div>

          <ul v-else class="teacher-rows">
            <li v-for="t in teachers" :key="t.teacherId" class="teacher-row" :class="{ off: !t.isActive }">
              <div class="row-main">
                <div class="row-id">
                  <span class="status-pip" :class="t.isActive ? 'on' : 'off'"></span>
                  <div>
                    <p class="row-name">{{ t.internalLabel || t.email }}</p>
                    <p class="row-email mono">{{ t.email }}</p>
                  </div>
                </div>
                <div class="row-meta mono">
                  <span :title="formatDate(t.lastLoginAt)">ostatnie logowanie: {{ t.lastLoginAt ? formatDate(t.lastLoginAt) : '—' }}</span>
                </div>
              </div>

              <!-- The keyway: current retrievable link, copy-only. -->
              <div class="keyway">
                <div class="keyway-top">
                  <span class="keyway-label">{{ t.isActive ? 'Aktualny link dostępu' : 'Dostęp wyłączony' }}</span>
                  <button
                    v-if="t.accessLink"
                    class="soft-btn mini"
                    :class="{ copied: copiedRow === t.teacherId }"
                    @click="copy(t.accessLink, t.teacherId)"
                  >
                    {{ copiedRow === t.teacherId ? 'Skopiowano' : 'Kopiuj' }}
                  </button>
                </div>
                <div class="keyway-channel">{{ t.accessLink || 'Brak aktywnego linku.' }}</div>
              </div>

              <div class="row-actions" v-if="t.isActive">
                <button class="soft-btn quiet warn" @click="beginAction(t, 'regenerate')">Regeneruj link</button>
                <button class="soft-btn quiet danger" @click="beginAction(t, 'deactivate')">Wyłącz nauczyciela</button>
              </div>

              <!-- Inline destructive confirmation — never a surprise mutation. -->
              <div v-if="pending && pending.teacherId === t.teacherId" class="confirm-well" role="alertdialog" aria-live="assertive">
                <p class="confirm-text">
                  {{
                    pending.kind === 'regenerate'
                      ? 'Regenerować link? Dotychczasowy link natychmiast przestanie działać. Tablice pozostaną bez zmian.'
                      : 'Wyłączyć tego nauczyciela? Cały dostęp zostanie natychmiast odebrany.'
                  }}
                </p>
                <div class="confirm-row">
                  <button class="soft-btn accent" :disabled="actionPending" @click="confirmAction">
                    {{ actionPending ? 'Wykonywanie…' : 'Potwierdzam' }}
                  </button>
                  <button class="soft-btn quiet" :disabled="actionPending" @click="cancelAction">Anuluj</button>
                </div>
                <p v-if="actionError" class="soft-alert wide">{{ actionError }}</p>
              </div>
            </li>
          </ul>
        </main>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

/**
 * Administrator surface (VVE-101, ADR-0005 + ADR-0008).
 *
 * - Login exchanges the shared passphrase (JSON body ONLY) for the signed
 *   twelve-hour HttpOnly session cookie; no secret ever travels in a URL,
 *   header, or build-time env.
 * - The teacher list is a pure GET: viewing NEVER creates or rotates links.
 *   Copying the displayed link is enough — there is no per-teacher POST.
 * - Regeneration and deactivation are explicit, confirmed actions.
 * - Every fetch handles res.ok and surfaces a Polish error state; failures
 *   are never masked as an empty list (QA P1-1).
 */
const apiBase = resolveBackendBaseUrl();

const authState = ref('checking'); // 'checking' | 'anonymous' | 'authenticated'
const passphrase = ref('');
const loginPending = ref(false);
const loginError = ref('');
const passphraseInput = ref(null);

const teachers = ref([]);
const loading = ref(false);
const loadError = ref('');

const manual = reactive({ email: '', internalLabel: '' });
const addPending = ref(false);
const addError = ref('');
const freshLink = ref('');

const pending = ref(null); // { teacherId, kind: 'regenerate' | 'deactivate' }
const actionPending = ref(false);
const actionError = ref('');

const copiedRow = ref(null);
const copiedKeyway = ref(false);
let copiedTimer = null;

const jsonHeaders = { 'Content-Type': 'application/json' };

/** Session-expiry-aware fetch: a 401 returns to the login gate. */
const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${apiBase}${path}`, { credentials: 'include', ...options });
  if (res.status === 401 && authState.value === 'authenticated') {
    authState.value = 'anonymous';
    loginError.value = 'Sesja wygasła. Zaloguj się ponownie.';
  }
  return res;
};

const readError = async (res, fallback) => {
  try {
    const body = await res.json();
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
};

onMounted(async () => {
  try {
    const res = await fetch(`${apiBase}/api/admin/session`, { credentials: 'include' });
    if (res.ok) {
      authState.value = 'authenticated';
      await loadTeachers();
      return;
    }
  } catch {
    /* network failure = anonymous gate with its own error surface */
  }
  authState.value = 'anonymous';
});

const login = async () => {
  loginPending.value = true;
  loginError.value = '';
  try {
    const res = await fetch(`${apiBase}/api/admin/session`, {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify({ passphrase: passphrase.value })
    });
    if (res.ok) {
      passphrase.value = '';
      authState.value = 'authenticated';
      await loadTeachers();
      return;
    }
    loginError.value = await readError(res, 'Nie udało się zalogować. Spróbuj ponownie.');
  } catch {
    loginError.value = 'Brak połączenia z serwerem. Sprawdź połączenie i spróbuj ponownie.';
  } finally {
    loginPending.value = false;
  }
};

const logout = async () => {
  try {
    await apiFetch('/api/admin/session', { method: 'DELETE' });
  } catch {
    /* clearing the local view regardless */
  }
  teachers.value = [];
  freshLink.value = '';
  pending.value = null;
  authState.value = 'anonymous';
};

const loadTeachers = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await apiFetch('/api/admin/teachers');
    if (!res.ok) {
      loadError.value = await readError(res, 'Nie udało się pobrać listy nauczycieli.');
      if (res.status !== 401) teachers.value = [];
      return;
    }
    const data = await res.json();
    teachers.value = Array.isArray(data.teachers) ? data.teachers : [];
  } catch {
    loadError.value = 'Brak połączenia z serwerem. Nie udało się pobrać listy nauczycieli.';
  } finally {
    loading.value = false;
  }
};

const addTeacher = async () => {
  addPending.value = true;
  addError.value = '';
  try {
    const res = await apiFetch('/api/admin/teachers', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify({ email: manual.email.trim(), internalLabel: manual.internalLabel.trim() || null })
    });
    if (!res.ok) {
      addError.value = await readError(res, 'Nie udało się dodać nauczyciela.');
      return;
    }
    const data = await res.json();
    freshLink.value = data.accessLink || '';
    manual.email = '';
    manual.internalLabel = '';
    await loadTeachers();
  } catch {
    addError.value = 'Brak połączenia z serwerem. Nie udało się dodać nauczyciela.';
  } finally {
    addPending.value = false;
  }
};

const beginAction = (teacher, kind) => {
  actionError.value = '';
  pending.value = { teacherId: teacher.teacherId, kind };
};

const cancelAction = () => {
  pending.value = null;
  actionError.value = '';
};

const confirmAction = async () => {
  if (!pending.value) return;
  const { teacherId, kind } = pending.value;
  actionPending.value = true;
  actionError.value = '';
  try {
    const res = await apiFetch(`/api/admin/teachers/${teacherId}/${kind === 'regenerate' ? 'regenerate-link' : 'deactivate'}`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) {
      actionError.value = await readError(
        res,
        kind === 'regenerate' ? 'Nie udało się wygenerować nowego linku.' : 'Nie udało się wyłączyć nauczyciela.'
      );
      return;
    }
    const data = await res.json();
    pending.value = null;
    await loadTeachers();
    if (kind === 'regenerate' && data.accessLink) {
      freshLink.value = data.accessLink;
    }
  } catch {
    actionError.value = 'Brak połączenia z serwerem. Spróbuj ponownie.';
  } finally {
    actionPending.value = false;
  }
};

const copy = async (text, rowKey) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard may be blocked; the full link stays selectable in the channel */
  }
  if (rowKey === 'keyway') {
    copiedKeyway.value = true;
    setTimeout(() => (copiedKeyway.value = false), 2000);
  } else {
    copiedRow.value = rowKey;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedRow.value = null), 2000);
  }
};

const formatDate = (value) => {
  try {
    return value ? new Date(value).toLocaleDateString('pl-PL') : '—';
  } catch {
    return '—';
  }
};
</script>

<style scoped>
/* ---------------------------------------------------------------------------
   Structured Soft UI (house neumorphic language, leaning A: an information-
   dense administrative console). One material, one virtual light from the
   top-left. Depth carries hierarchy: raised cards hold actions, recessed
   channels hold credentials (the keyway signature), quiet buttons sit flush.
--------------------------------------------------------------------------- */
.admin-soft-shell {
  --soft-bg: #e4e9f2;
  --soft-surface: #e4e9f2;
  --soft-light: rgba(255, 255, 255, 0.92);
  --soft-dark: rgba(159, 173, 198, 0.58);
  --soft-ink: #1c2739;
  --soft-ink-2: #5a6b84;
  --soft-ink-3: #93a3ba;
  --soft-accent: #2f6fed;
  --soft-accent-ink: #f4f8ff;
  --soft-danger: #c23b4e;
  --soft-warn: #a8691c;
  --soft-ok: #1f8a5b;
  --raise: 7px 7px 15px var(--soft-dark), -7px -7px 15px var(--soft-light);
  --raise-sm: 4px 4px 9px var(--soft-dark), -4px -4px 9px var(--soft-light);
  --press: inset 4px 4px 8px rgba(159, 173, 198, 0.5), inset -4px -4px 8px rgba(255, 255, 255, 0.85);
  --press-deep: inset 5px 5px 10px rgba(150, 165, 192, 0.55), inset -3px -3px 7px rgba(255, 255, 255, 0.7);

  min-height: 100vh;
  background: var(--soft-bg);
  color: var(--soft-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  padding: 48px 32px 96px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--soft-ink-3);
  margin: 0 0 6px;
}
.muted { color: var(--soft-ink-2); font-size: 14px; margin: 0; }
.muted.small { font-size: 12.5px; }
.mono { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 12px; }
.fineprint { color: var(--soft-ink-3); font-size: 11.5px; text-align: center; margin: 14px 0 0; }

/* ---- Cards ------------------------------------------------------------- */
.soft-card {
  background: var(--soft-surface);
  border-radius: 20px;
  box-shadow: var(--raise);
  padding: 26px 28px;
}
.card-title { font-size: 15.5px; font-weight: 700; margin: 0 0 6px; }

/* ---- Login gate --------------------------------------------------------- */
.gate-stage { min-height: 76vh; display: flex; align-items: center; justify-content: center; }
.gate-card { width: 100%; max-width: 380px; padding: 38px 36px; }
.gate-title { font-size: 24px; font-weight: 800; margin: 0 0 8px; }
.gate-sub { margin-bottom: 26px; }

.field-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--soft-ink-2);
  margin: 18px 0 8px;
}

/* ---- Inputs: recessed --------------------------------------------------- */
.soft-input {
  width: 100%;
  border: none;
  outline: none;
  border-radius: 12px;
  background: var(--soft-surface);
  box-shadow: var(--press);
  padding: 13px 16px;
  font-size: 14.5px;
  color: var(--soft-ink);
  transition: box-shadow 0.18s ease;
}
.soft-input:focus { box-shadow: var(--press), 0 0 0 2px rgba(47, 111, 237, 0.35); }
.soft-input::placeholder { color: var(--soft-ink-3); }

/* ---- Buttons: raised tactile pills -------------------------------------- */
.soft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--soft-ink-2);
  background: var(--soft-surface);
  box-shadow: var(--raise-sm);
  transition: box-shadow 0.15s ease, transform 0.15s ease, color 0.15s ease;
  font-family: inherit;
}
.soft-btn:hover:not(:disabled) { color: var(--soft-ink); }
.soft-btn:active:not(:disabled) { box-shadow: var(--press); transform: translateY(1px); }
.soft-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.soft-btn:focus-visible { outline: 2px solid rgba(47, 111, 237, 0.6); outline-offset: 2px; }
.soft-btn.accent {
  background: linear-gradient(145deg, #3d78f2, #2a63d8);
  color: var(--soft-accent-ink);
  box-shadow: 6px 6px 13px rgba(140, 160, 195, 0.55), -6px -6px 13px var(--soft-light);
}
.soft-btn.accent:active:not(:disabled) { box-shadow: inset 4px 4px 9px rgba(20, 45, 100, 0.45); }
.soft-btn.quiet { padding: 9px 14px; font-size: 12.5px; }
.soft-btn.warn { color: var(--soft-warn); }
.soft-btn.danger { color: var(--soft-danger); }
.soft-btn.icon { padding: 9px; }
.soft-btn.mini { padding: 6px 12px; font-size: 11.5px; }
.soft-btn.mini.copied { color: var(--soft-ok); }
.soft-btn.full { width: 100%; margin-top: 22px; }

/* ---- Alerts -------------------------------------------------------------- */
.soft-alert {
  margin-top: 16px;
  border-radius: 12px;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--soft-danger);
  box-shadow: var(--press-deep);
}
.soft-alert.wide { margin-top: 0; }

/* ---- Panel layout -------------------------------------------------------- */
.panel-head {
  max-width: 1180px;
  margin: 0 auto 34px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}
.panel-title { font-size: 27px; font-weight: 800; margin: 0 0 8px; }
.panel-grid {
  max-width: 1180px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 30px;
  align-items: start;
}
.rail { display: flex; flex-direction: column; gap: 30px; }
.hint-list { margin: 12px 0 0; padding-left: 18px; color: var(--soft-ink-2); font-size: 13px; line-height: 1.7; }

/* ---- Keyway (signature) -------------------------------------------------- */
.keyway {
  margin-top: 18px;
  border-radius: 14px;
  padding: 12px 14px 14px;
  box-shadow: var(--press-deep);
}
.keyway.fresh { box-shadow: var(--press-deep), 0 0 0 2px rgba(31, 138, 91, 0.35); }
.keyway-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.keyway-label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--soft-ink-3);
}
.keyway-channel {
  font-family: 'SF Mono', ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--soft-ink-2);
  word-break: break-all;
  user-select: all;
}

/* ---- Teacher list -------------------------------------------------------- */
.list-card { padding: 24px 26px 28px; }
.list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.list-tools { display: flex; align-items: center; gap: 14px; }
.list-state { padding: 56px 20px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }

.teacher-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
.teacher-row {
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: var(--raise-sm);
  transition: opacity 0.2s ease;
}
.teacher-row.off { opacity: 0.62; }
.row-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.row-id { display: flex; align-items: center; gap: 13px; }
.row-name { font-size: 14.5px; font-weight: 700; margin: 0; }
.row-email { color: var(--soft-ink-3); margin: 3px 0 0; font-size: 11.5px; }
.row-meta { color: var(--soft-ink-3); }

.status-pip {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
  box-shadow: var(--press);
}
.status-pip.on { background: var(--soft-ok); box-shadow: inset 2px 2px 3px rgba(10, 60, 38, 0.45), inset -2px -2px 3px rgba(160, 235, 200, 0.8); }
.status-pip.off { background: var(--soft-ink-3); }

.row-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }

/* ---- Inline confirmation -------------------------------------------------- */
.confirm-well {
  margin-top: 16px;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: var(--press-deep);
}
.confirm-text { font-size: 13px; color: var(--soft-ink-2); margin: 0 0 12px; line-height: 1.55; }
.confirm-row { display: flex; gap: 10px; }

/* ---- Spinner --------------------------------------------------------------- */
.spinner-well {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  box-shadow: var(--press);
  display: flex;
  align-items: center;
  justify-content: center;
}
.spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 3px solid rgba(47, 111, 237, 0.2);
  border-top-color: var(--soft-accent);
  animation: soft-spin 0.9s linear infinite;
}
@keyframes soft-spin { to { transform: rotate(360deg); } }

@media (max-width: 1024px) {
  .panel-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 1.6s; }
  .soft-btn, .soft-input { transition: none; }
}
</style>
