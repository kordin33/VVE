<template>
  <AdminTeachersPanel v-if="view === 'admin'" />
  <TeacherDashboard v-else-if="view === 'teacher'" />
  <StudentBoardEntry v-else-if="view === 'student'" :slug="slug" />
  <App v-else-if="view === 'board' || view === 'legacy'" />
  <PilotUnavailable v-else />
</template>

<script setup>
import { computed } from 'vue';
import App from './App.vue';
import TeacherDashboard from './views/TeacherDashboard.vue';
import StudentBoardEntry from './views/StudentBoardEntry.vue';
import AdminTeachersPanel from './views/AdminTeachersPanel.vue';
import PilotUnavailable from './views/PilotUnavailable.vue';
import { PILOT_ENVIRONMENT, featureAvailable } from './services/pilotSurface';

// View switching is driven by the shared PilotAvailability manifest: every
// mountable view must resolve available for its role in this environment.
// In the Pilot there is no product entry on `/` — the whiteboard opens only
// through a board session link; the legacy peer-room lobby is dev-only.
const pathname = window.location.pathname || '';
const search = new URLSearchParams(window.location.search);
const devSurface = (() => {
  if (PILOT_ENVIRONMENT !== 'development') return false;
  try {
    return search.get('__dev') === '1' || localStorage.getItem('vve_dev_surface') === '1';
  } catch {
    return false;
  }
})();

const boardSessionRole = () => {
  const token = search.get('wsToken') || '';
  try {
    const [base] = token.split('.');
    if (!base) return 'developer';
    const payload = JSON.parse(atob(base.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'teacher' || payload.role === 'student' ? payload.role : 'developer';
  } catch {
    return 'developer';
  }
};

const surface = (featureId, role) => featureAvailable(featureId, role, devSurface);

const view = computed(() => {
  if (pathname.startsWith('/admin/teachers')) {
    return surface('surface.adminPanel', 'administrator') ? 'admin' : 'unavailable';
  }
  if (pathname.startsWith('/teacher/dashboard')) {
    return surface('surface.teacherDashboard', 'teacher') ? 'teacher' : 'unavailable';
  }
  if (pathname.startsWith('/s/') || pathname.startsWith('/board/')) {
    return surface('surface.studentEntry', 'student') ? 'student' : 'unavailable';
  }
  // The only Pilot entry to the whiteboard is a board session link.
  if (search.get('room') && search.get('wsToken')) {
    return surface('surface.boardSession', boardSessionRole()) ? 'board' : 'unavailable';
  }
  // Legacy peer rooms/lobby stay reachable only through the internal dev flag.
  if (surface('dev.legacyPeerRooms', 'developer')) return 'legacy';
  return 'unavailable';
});

const slug = computed(() => {
  if (view.value !== 'student') return '';
  const parts = pathname.split('/').filter(Boolean);
  return parts[1] || '';
});
</script>
