<template>
  <svg :viewBox="viewBox" class="plot-renderer" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Modern Arrowhead -->
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <path d="M0,0 L10,3.5 L0,7" fill="currentColor" class="axis-arrow" />
      </marker>
      <!-- Dot Grid Pattern -->
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="currentColor" opacity="0.2" class="grid-dot" />
      </pattern>
    </defs>

    <!-- Coordinate System 2D -->
    <g v-if="type === 'coordinateSystem2D'" class="plot-group">
      <!-- Background Grid -->
      <rect width="100%" height="100%" fill="url(#grid)" />
      
      <!-- Axes -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" class="axis-line" marker-end="url(#arrowhead)" />
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" class="axis-line" marker-end="url(#arrowhead)" />
      
      <!-- Labels -->
      <text :x="width - 20" :y="height/2 + 24" class="axis-label">x</text>
      <text :x="width/2 + 12" :y="20" class="axis-label">y</text>
    </g>

    <!-- Coordinate System 3D (Pseudo) -->
    <g v-else-if="type === 'coordinateSystem3D'" class="plot-group">
      <!-- Ground Plane Grid -->
      <g :transform="`translate(${width/4}, ${height/2}) skewX(-35)`" opacity="0.4">
        <g class="grid-lines-3d">
          <line v-for="i in 8" :key="`gx-${i}`" :x1="(i-1)*width*0.1" :y1="0" :x2="(i-1)*width*0.1" :y2="height*0.6" />
          <line v-for="i in 8" :key="`gy-${i}`" :x1="0" :y1="(i-1)*height*0.075" :x2="width*0.9" :y2="(i-1)*height*0.075" />
        </g>
      </g>
      
      <!-- Axes -->
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.8" :y2="height*0.8" class="axis-line" marker-end="url(#arrowhead)" />
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.2" :y2="height*0.15" class="axis-line" marker-end="url(#arrowhead)" />
      <line :x1="width*0.2" :y1="height*0.8" :x2="width*0.05" :y2="height*0.95" class="axis-line" marker-end="url(#arrowhead)" />

      <!-- Axis Labels -->
      <text :x="width*0.82" :y="height*0.8 - 10" class="axis-label">X</text>
      <text :x="width*0.2 + 10" :y="height*0.16" class="axis-label">Y</text>
      <text :x="width*0.02" :y="height*0.97" class="axis-label">Z</text>
    </g>

    <!-- Math Function Plot -->
    <g v-else-if="type === 'mathFunctionPlot'" class="plot-group">
      <!-- Axes -->
      <line :x1="0" :y1="height/2" :x2="width" :y2="height/2" class="axis-line-subtle" marker-end="url(#arrowhead)" />
      <line :x1="width/2" :y1="height" :x2="width/2" :y2="0" class="axis-line-subtle" marker-end="url(#arrowhead)" />
      
      <text :x="width - 20" :y="height/2 + 20" class="axis-label-subtle">x</text>
      <text :x="width/2 + 10" :y="20" class="axis-label-subtle">f(x)</text>
      
      <!-- Function Path -->
      <path :d="functionPath" :stroke="color" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" class="plot-path" />
    </g>

    <!-- Physics Data Plot -->
    <g v-else-if="type === 'physicsDataPlot'" class="plot-group">
      <!-- Axes -->
      <line :x1="0" :y1="height" :x2="width" :y2="height" class="axis-line" marker-end="url(#arrowhead)" /> <!-- X -->
      <line :x1="0" :y1="height" :x2="0" :y2="0" class="axis-line" marker-end="url(#arrowhead)" /> <!-- Y -->

      <text :x="width - 20" :y="height - 10" class="axis-label">t</text>
      <text :x="15" :y="20" class="axis-label">v</text>

      <!-- Connecting Line -->
      <polyline :points="scaledPointsString" :stroke="color" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.7" />
      
      <!-- Data Points -->
      <circle v-for="(pt, i) in scaledPoints" :key="i" :cx="pt.x" :cy="pt.y" r="4" :fill="color" stroke="white" stroke-width="1.5" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue';
import { create, all } from 'mathjs';

const math = create(all);

const props = defineProps({
  type: String,
  width: Number,
  height: Number,
  data: Object
});

// 7.4: Emit error instead of silent return
const emit = defineEmits(['render-error']);

const viewBox = computed(() => `0 0 ${props.width} ${props.height}`);
// Use props color or fallback to a nice blue accent from theme
const color = computed(() => props.data.color || '#2563eb');

// --- Math Plot Logic ---
const functionPath = computed(() => {
  if (props.type !== 'mathFunctionPlot' || !props.data.expression) return '';
  
  const expr = props.data.expression;
  const xRange = props.data.xRange || [-10, 10];
  const [minX, maxX] = xRange;
  const rangeX = maxX - minX;
  
  const aspectRatio = props.height / props.width;
  const rangeY = rangeX * aspectRatio;
  const minY = -(rangeY / 2);
  
  let compiled;
  try {
      compiled = math.compile(expr);
  } catch (e) {
      // 7.4: Emit error instead of silent return
      emit('render-error', { expression: expr, error: e.message });
      console.warn('[PlotRenderer] Failed to compile expression:', expr, e.message);
      return '';
  }

  const points = [];
  const steps = 300; 
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const xVal = minX + t * rangeX;
    
    let yVal;
    try {
        const scope = { x: xVal };
        yVal = compiled.evaluate(scope);
    } catch (e) {
        yVal = NaN;
    }
    
    if (typeof yVal === 'number' && isFinite(yVal)) {
        const svgX = (xVal - minX) / rangeX * props.width;
        const svgY = props.height - ((yVal - minY) / rangeY * props.height);
        
        if (svgY >= -props.height && svgY <= props.height * 2) {
             points.push(`${svgX},${svgY}`);
        }
    }
  }
  
  return `M ${points.join(' L ')}`;
});

// --- Physics Plot Logic ---
const scaledPoints = computed(() => {
  if (props.type !== 'physicsDataPlot' || !props.data.points) return [];
  
  const rawPoints = props.data.points;
  if (rawPoints.length === 0) return [];

  const xs = rawPoints.map(p => p.x);
  const ys = rawPoints.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  
  return rawPoints.map(p => ({
    x: (p.x - minX) / rangeX * props.width,
    y: props.height - ((p.y - minY) / rangeY * props.height)
  }));
});

const scaledPointsString = computed(() => {
  return scaledPoints.value.map(p => `${p.x},${p.y}`).join(' ');
});
</script>

<style scoped>
.plot-renderer {
  width: 100%;
  height: 100%;
  overflow: visible;
  /* Inherit colors from parent/theme */
  color: var(--text-primary, #1e293b);
}

/* Text Styles */
.axis-label {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  fill: currentColor;
  text-anchor: middle;
}

.axis-label-subtle {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  fill: var(--text-secondary, #64748b);
  text-anchor: middle;
}

/* Line Styles */
.axis-line {
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.axis-line-subtle {
  stroke: var(--text-secondary, #94a3b8);
  stroke-width: 1.5;
  stroke-opacity: 0.5;
}

.axis-arrow {
  fill: currentColor;
}

.grid-dot {
  fill: var(--text-secondary, #94a3b8);
}

.grid-lines-3d line {
  stroke: var(--text-secondary, #94a3b8);
  stroke-width: 1;
  stroke-dasharray: 4 4; /* Dotted lines for 3D grid */
}

/* Drop shadow for function line to pop */
.plot-path {
  filter: drop-shadow(0px 4px 6px rgba(37, 99, 235, 0.2));
}
</style>
