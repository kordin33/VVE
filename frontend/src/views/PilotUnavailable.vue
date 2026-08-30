<template>
  <div class="unavailable-shell">
    <div class="unavailable-card">
      <p class="eyebrow">WhiteVue</p>
      <h1>Ta strona nie jest dostępna</h1>
      <p class="lead">
        Otwórz tablicę swoim linkiem do lekcji. Jeśli link nie działa, poproś nauczyciela o nowy.
      </p>
    </div>
  </div>
</template>

<script setup>
</script>

<style scoped>
.unavailable-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: var(--bg-base, #f8fafc);
}
.unavailable-card {
  max-width: 420px;
  text-align: center;
  background: var(--bg-surface, #ffffff);
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.1);
}
.eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--accent-primary, #2563eb);
  font-weight: 700;
  margin-bottom: 8px;
}
h1 {
  font-size: 24px;
  margin: 0 0 12px;
  color: var(--text-primary, #0f172a);
}
.lead {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary, #475569);
  margin: 0;
}
</style>
