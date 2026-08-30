<template>
  <div class="chemistry-panel glass-panel feature-panel">
    <div class="panel-header">
      <span>Chemistry Helper</span>
      <button class="close-button" @click="$emit('close')">X</button>
    </div>
    <div class="panel-content">
      <!-- Mode selector -->
      <div class="mode-selector">
        <button :class="{ active: mode === 'h' }" @click="mode = 'h'">
          [H⁺] → pH
        </button>
        <button :class="{ active: mode === 'ph' }" @click="mode = 'ph'">
          pH → [H⁺]
        </button>
        <button :class="{ active: mode === 'oh' }" @click="mode = 'oh'">
          [OH⁻] → pOH
        </button>
      </div>

      <!-- Input -->
      <div class="input-group">
        <label>{{ inputLabel }}</label>
        <input
          type="text"
          v-model="inputValue"
          :placeholder="inputPlaceholder"
          @input="calculate"
          class="chem-input"
        />
      </div>

      <!-- Results -->
      <div v-if="hasResults" class="results-grid">
        <div class="result-item" v-for="r in results" :key="r.label">
          <span class="result-label">{{ r.label }}</span>
          <span class="result-value">{{ r.value }}</span>
        </div>
      </div>

      <!-- Acid/Base indicator -->
      <div v-if="hasResults && phValue !== null" class="indicator">
        <div class="ph-bar">
          <div class="ph-marker" :style="{ left: markerPosition + '%' }"></div>
        </div>
        <div class="ph-labels">
          <span>0 (kwas)</span>
          <span>7 (neutral)</span>
          <span>14 (zasada)</span>
        </div>
        <div class="ph-type">{{ solutionType }}</div>
      </div>

      <!-- Insert on board -->
      <button
        v-if="hasResults"
        class="action-button insert-btn"
        @click="insertOnBoard"
      >
        Wstaw wynik na tablicę (LaTeX)
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const emit = defineEmits(['close', 'insert-element']);

const mode = ref('h'); // 'h' | 'ph' | 'oh'
const inputValue = ref('');
const phValue = ref(null);
const pohValue = ref(null);
const hConc = ref(null);
const ohConc = ref(null);

const Kw = 1e-14; // Water autoionization constant at 25°C

const inputLabel = computed(() => {
  if (mode.value === 'h') return '[H⁺] (mol/L)';
  if (mode.value === 'ph') return 'pH';
  return '[OH⁻] (mol/L)';
});

const inputPlaceholder = computed(() => {
  if (mode.value === 'h') return 'np. 1e-3 lub 0.001';
  if (mode.value === 'ph') return 'np. 3.5';
  return 'np. 1e-5 lub 0.00001';
});

const hasResults = computed(() => phValue.value !== null);

const results = computed(() => {
  if (phValue.value === null) return [];
  return [
    { label: 'pH', value: formatNum(phValue.value) },
    { label: 'pOH', value: formatNum(pohValue.value) },
    { label: '[H⁺]', value: formatSci(hConc.value) + ' mol/L' },
    { label: '[OH⁻]', value: formatSci(ohConc.value) + ' mol/L' },
  ];
});

const markerPosition = computed(() => {
  if (phValue.value === null) return 50;
  return Math.max(0, Math.min(100, (phValue.value / 14) * 100));
});

const solutionType = computed(() => {
  if (phValue.value === null) return '';
  if (phValue.value < 6.5) return 'Roztwór kwaśny';
  if (phValue.value > 7.5) return 'Roztwór zasadowy';
  return 'Roztwór obojętny';
});

const formatNum = (n) => {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
};

const formatSci = (n) => {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) >= 0.01 && Math.abs(n) < 1000) return n.toPrecision(4);
  return n.toExponential(3);
};

const calculate = () => {
  const raw = inputValue.value.trim();
  if (!raw) {
    phValue.value = null;
    return;
  }

  let val;
  try {
    val = parseFloat(raw);
    // Support scientific notation like 1e-3
    if (isNaN(val)) {
      val = Number(raw);
    }
  } catch {
    phValue.value = null;
    return;
  }

  if (isNaN(val) || !isFinite(val)) {
    phValue.value = null;
    return;
  }

  if (mode.value === 'h') {
    if (val <= 0) { phValue.value = null; return; }
    hConc.value = val;
    phValue.value = -Math.log10(val);
    pohValue.value = 14 - phValue.value;
    ohConc.value = Kw / val;
  } else if (mode.value === 'ph') {
    if (val < 0 || val > 14) { phValue.value = null; return; }
    phValue.value = val;
    pohValue.value = 14 - val;
    hConc.value = Math.pow(10, -val);
    ohConc.value = Math.pow(10, -(14 - val));
  } else {
    // mode === 'oh'
    if (val <= 0) { phValue.value = null; return; }
    ohConc.value = val;
    pohValue.value = -Math.log10(val);
    phValue.value = 14 - pohValue.value;
    hConc.value = Kw / val;
  }
};

const insertOnBoard = () => {
  if (phValue.value === null) return;
  const latex = `pH = ${formatNum(phValue.value)}, \\quad pOH = ${formatNum(pohValue.value)}, \\quad [H^+] = ${formatSci(hConc.value)}\\,\\text{mol/L}`;
  emit('insert-element', {
    type: 'text',
    text: latex,
    fontSize: 18,
    color: '#1e293b',
    position: { x: 200, y: 200 },
  });
};
</script>

<style scoped>
.chemistry-panel {
  width: 380px;
}

.mode-selector {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 4px;
}

.mode-selector button {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.mode-selector button.active {
  background: var(--accent-primary, #6366f1);
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.chem-input {
  padding: 10px 12px;
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  font-size: 16px;
  font-family: 'Fira Code', monospace;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s;
}

.chem-input:focus {
  border-color: var(--accent-primary, #6366f1);
}

.results-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.result-item {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.03);
  padding: 8px 12px;
  border-radius: 8px;
}

.result-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.result-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'Fira Code', monospace;
}

.indicator {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ph-bar {
  position: relative;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(to right,
    #ef4444 0%,
    #f97316 15%,
    #eab308 30%,
    #22c55e 45%,
    #06b6d4 60%,
    #3b82f6 75%,
    #8b5cf6 90%,
    #6b21a8 100%
  );
}

.ph-marker {
  position: absolute;
  top: -2px;
  width: 4px;
  height: 16px;
  background: #1e293b;
  border-radius: 2px;
  transform: translateX(-50%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.ph-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary);
}

.ph-type {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.insert-btn {
  width: 100%;
}
</style>
