<!-- GridAlignText.vue -->
<template>
  <div class="grid-align-container">
    <canvas 
      ref="canvas" 
      @pointerdown="startDrawing" 
      @pointermove="draw" 
      @pointerup="endDrawing"
      @pointerleave="endDrawing"
    ></canvas>
    <div class="controls">
      <button @click="alignToGrid">Wyrównaj do siatki</button>
      <label>
        Siła przyciągania:
        <input type="range" min="0" max="100" v-model.number="snapStrength" />
      </label>
      <label>
        <input type="checkbox" v-model="showBaseline" />
        Pokaż linię bazową
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { getStroke } from 'perfect-freehand';
import * as Y from 'yjs';

// Props i emity
const props = defineProps({
  gridSize: {
    type: Number,
    default: 20
  },
  // Referencja do dokumentu Yjs
  ydoc: {
    type: Object,
    required: true
  },
  // Nazwa współdzielonej mapy w Yjs
  mapName: {
    type: String,
    default: 'strokes'
  }
});

const emit = defineEmits(['stroke-added', 'stroke-updated']);

// Stan komponentu
const canvas = ref(null);
const ctx = ref(null);
const isDrawing = ref(false);
const currentPoints = ref([]);
const strokes = ref([]);
const snapStrength = ref(50);
const showBaseline = ref(false);
const baselines = ref([]);

// Inicjalizacja Yjs
const ymap = ref(null);

onMounted(() => {
  // Inicjalizacja canvas
  ctx.value = canvas.value.getContext('2d');
  resizeCanvas();
  
  // Inicjalizacja Yjs map
  ymap.value = props.ydoc.getMap(props.mapName);
  
  // Subskrybuj zmiany z Yjs
  ymap.value.observe(event => {
    // Aktualizacja strokes na podstawie zmian w Yjs
    event.keysChanged.forEach(key => {
      const stroke = ymap.value.get(key);
      if (stroke) {
        const existingIndex = strokes.value.findIndex(s => s.id === key);
        if (existingIndex >= 0) {
          strokes.value[existingIndex] = { ...stroke, id: key };
        } else {
          strokes.value.push({ ...stroke, id: key });
        }
      }
    });
    redraw();
  });
  
  window.addEventListener('resize', resizeCanvas);
});

// 5.5: Remove resize listener on unmount
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
});

// Funkcje rysowania
function startDrawing(e) {
  isDrawing.value = true;
  const point = getPoint(e);
  currentPoints.value = [point];
  ctx.value.lineCap = 'round';
  ctx.value.lineJoin = 'round';
}

function draw(e) {
  if (!isDrawing.value) return;
  
  const point = getPoint(e);
  currentPoints.value.push(point);
  
  redraw();
}

function endDrawing() {
  if (!isDrawing.value) return;
  isDrawing.value = false;
  
  if (currentPoints.value.length > 1) {
    const newStroke = {
      points: currentPoints.value,
      color: 'black',
      weight: 3,
      timestamp: Date.now(),
      aligned: false
    };
    
    const id = Date.now().toString();
    strokes.value.push({ ...newStroke, id });
    
    // Dodaj do Yjs
    ymap.value.set(id, newStroke);
    
    emit('stroke-added', { ...newStroke, id });
  }
  
  currentPoints.value = [];
}

function getPoint(e) {
  const rect = canvas.value.getBoundingClientRect();
  return [
    e.clientX - rect.left, 
    e.clientY - rect.top,
    e.pressure || 0.5 // Domyślna wartość nacisku jeśli nie jest dostępna
  ];
}

function resizeCanvas() {
  if (!canvas.value) return;
  
  canvas.value.width = canvas.value.parentElement.clientWidth;
  canvas.value.height = canvas.value.parentElement.clientHeight;
  
  drawGrid();
  redraw();
}

function drawGrid() {
  if (!ctx.value) return;
  
  const { width, height } = canvas.value;
  ctx.value.save();
  ctx.value.strokeStyle = '#ddd';
  ctx.value.lineWidth = 0.5;
  
  // Poziome linie
  for (let y = 0; y < height; y += props.gridSize) {
    ctx.value.beginPath();
    ctx.value.moveTo(0, y);
    ctx.value.lineTo(width, y);
    ctx.value.stroke();
  }
  
  // Pionowe linie
  for (let x = 0; x < width; x += props.gridSize) {
    ctx.value.beginPath();
    ctx.value.moveTo(x, 0);
    ctx.value.lineTo(x, height);
    ctx.value.stroke();
  }
  
  ctx.value.restore();
}

function redraw() {
  if (!ctx.value) return;
  
  // Wyczyść płótno
  ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height);
  
  // Narysuj siatkę
  drawGrid();
  
  // Narysuj wszystkie zapisane ścieżki
  strokes.value.forEach(stroke => {
    const pathData = getStroke(stroke.points, {
      size: stroke.weight * 2,
      thinning: 0.75,
      smoothing: 0.5,
      streamline: 0.5,
    });
    
    ctx.value.fillStyle = stroke.color;
    
    // Rysuj ścieżkę
    ctx.value.beginPath();
    drawPath(ctx.value, pathData);
    ctx.value.fill();
  });
  
  // Rysuj aktualną ścieżkę
  if (currentPoints.value.length > 1) {
    const pathData = getStroke(currentPoints.value, {
      size: 6, // Domyślna grubość
      thinning: 0.75,
      smoothing: 0.5,
      streamline: 0.5,
    });
    
    ctx.value.fillStyle = 'black';
    
    ctx.value.beginPath();
    drawPath(ctx.value, pathData);
    ctx.value.fill();
  }
  
  // Pokaż linie bazowe jeśli opcja włączona
  if (showBaseline.value && baselines.value.length) {
    ctx.value.save();
    ctx.value.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.value.lineWidth = 1;
    
    baselines.value.forEach(baseline => {
      ctx.value.beginPath();
      ctx.value.moveTo(0, baseline.y);
      ctx.value.lineTo(canvas.value.width, baseline.y);
      ctx.value.stroke();
    });
    
    ctx.value.restore();
  }
}

function drawPath(ctx, pathData) {
  if (!pathData.length) return;
  
  const [first, ...rest] = pathData;
  
  ctx.moveTo(first[0], first[1]);
  
  rest.forEach(point => {
    ctx.lineTo(point[0], point[1]);
  });
}

// Algorytm wykrywania linii bazowej
function detectBaselines() {
  // Resetuj linie bazowe
  baselines.value = [];
  
  // Grupowanie ścieżek w potencjalne linie tekstu
  // Używamy prostego podejścia - grupowanie wg pozycji Y
  if (!strokes.value.length) return;
  
  // Dla każdej ścieżki oblicz średnią pozycję Y
  const strokesWithY = strokes.value.map(stroke => {
    const yValues = stroke.points.map(p => p[1]);
    const avgY = yValues.reduce((sum, y) => sum + y, 0) / yValues.length;
    return { ...stroke, avgY };
  });
  
  // Sortuj ścieżki według średniej pozycji Y
  strokesWithY.sort((a, b) => a.avgY - b.avgY);
  
  // Znajdź grupy ścieżek (potencjalne linie tekstu)
  const lineGroups = [];
  let currentGroup = [strokesWithY[0]];
  let currentY = strokesWithY[0].avgY;
  
  for (let i = 1; i < strokesWithY.length; i++) {
    const stroke = strokesWithY[i];
    
    // Jeśli ścieżka jest blisko poprzedniej (w granicach 1.5 * gridSize), dodaj do bieżącej grupy
    if (Math.abs(stroke.avgY - currentY) < props.gridSize * 1.5) {
      currentGroup.push(stroke);
      // Aktualizuj średnią pozycję Y dla grupy
      currentY = currentGroup.reduce((sum, s) => sum + s.avgY, 0) / currentGroup.length;
    } else {
      // W przeciwnym razie utwórz nową grupę
      lineGroups.push(currentGroup);
      currentGroup = [stroke];
      currentY = stroke.avgY;
    }
  }
  
  // Dodaj ostatnią grupę
  if (currentGroup.length) {
    lineGroups.push(currentGroup);
  }
  
  // Dla każdej grupy oblicz linię bazową
  lineGroups.forEach(group => {
    // Użyj średniej pozycji Y jako linii bazowej
    const baselineY = group.reduce((sum, stroke) => sum + stroke.avgY, 0) / group.length;
    
    baselines.value.push({ 
      y: baselineY,
      strokes: group.map(s => s.id)
    });
  });
  
  // Rysuj ponownie, aby pokazać linie bazowe
  redraw();
}

// Algorytm przyciągania do siatki
function alignToGrid() {
  // Najpierw wykryj linie bazowe
  detectBaselines();
  
  if (!baselines.value.length) return;
  
  // Dla każdej linii bazowej znajdź najbliższą linię siatki
  baselines.value.forEach(baseline => {
    // Znajdź najbliższą linię siatki
    const nearestGridLine = Math.round(baseline.y / props.gridSize) * props.gridSize;
    
    // Oblicz przesunięcie
    const offsetY = nearestGridLine - baseline.y;
    
    // Zastosuj przesunięcie do każdej ścieżki w linii bazowej
    // Siła przesunięcia zależy od ustawionej siły przyciągania
    const effectiveOffset = offsetY * (snapStrength.value / 100);
    
    baseline.strokes.forEach(strokeId => {
      const strokeIndex = strokes.value.findIndex(s => s.id === strokeId);
      if (strokeIndex === -1) return;
      
      // Klonuj punkty i zastosuj przesunięcie
      const updatedPoints = strokes.value[strokeIndex].points.map(point => [
        point[0],
        point[1] + effectiveOffset,
        point[2]
      ]);
      
      // Aktualizuj ścieżkę
      const updatedStroke = {
        ...strokes.value[strokeIndex],
        points: updatedPoints,
        aligned: true
      };
      
      strokes.value[strokeIndex] = updatedStroke;
      
      // Aktualizuj w Yjs
      ymap.value.set(strokeId, {
        points: updatedPoints,
        color: updatedStroke.color,
        weight: updatedStroke.weight,
        timestamp: updatedStroke.timestamp,
        aligned: true
      });
      
      emit('stroke-updated', updatedStroke);
    });
  });
  
  // Aktualizuj pozycje linii bazowych
  baselines.value = baselines.value.map(baseline => ({
    ...baseline,
    y: Math.round(baseline.y / props.gridSize) * props.gridSize
  }));
  
  // Rysuj ponownie
  redraw();
}

watch([snapStrength, showBaseline], () => {
  redraw();
});
</script>

<style scoped>
.grid-align-container {
  position: relative;
  width: 100%;
  height: 100%;
}

canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.controls {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: white;
  padding: 10px;
  border-radius: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 10;
}
</style>
