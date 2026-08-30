<template>
  <div id="app" :class="{ 'dark-mode': darkMode }">
    <template v-if="roomId && roomKey">
    <TopMenu
      :role="effectiveRole"
      @clear-canvas="handleClearCanvas"
      @toggle-feature="toggleFeature"
      @open-room-manager="handleOpenRoomManager"
      @export-whiteboard="handleExportRequest"
      @export-pdf-single="handleExportPdfSingle"
      @export-pdf-paged="handleExportPdfPaged"
      @import-whiteboard="showImportDialog = true"
      @import-pdf="handleImportPdf"
      :active-feature="activeFeature"
     ></TopMenu>
    <!-- Canvas container takes full screen -->
    <div class="whiteboard-container">
      <WhiteboardCanvas
        ref="whiteboard"
        :room-id="roomId"
        :room-key="roomKey"
        :username="username"
        :ws-token="storedWsToken"
        :debug-mode="debugMode"
        :current-shape="currentShape"
        :current-line-style="currentLineStyle"
        :current-arrow-style="currentArrowStyle"
        :current-roughness="currentRoughness"
        :current-fill-color="currentFillColor"
        :active-feature="activeFeature"
        :grid-align-options="gridAlignOptions"
        :handwriting-styler-options="handwritingStylerOptions"
        :math-recognizer-options="mathRecognizerOptions"
        @update:recognition-status="recognitionStatus = $event"
        @update:latex-equation="latexEquation = $event"
        @update:solution="solution = $event"
        @update:has-char-groups="hasCharGroups = $event"
        @update:has-stylized-strokes="hasStylizedStrokes = $event"
        @select-pen-preset="selectPenPreset"
      />
      <AIChatPanel
        v-if="can('experiment.ai')"
        :whiteboard-ref="whiteboard?.containerRef?.value || null"
        :room-id="roomId"
        :ws-token="storedWsToken"
      />
       <GridAlignPanel
         v-if="activeFeature === 'gridAlign' && can('experiment.gridAlign')"
         :options="gridAlignOptions"
         @update:options="gridAlignOptions = $event"
         @close="toggleFeature(null)"
         @align="triggerWhiteboardAction('alignToGrid')"
       />

       <HandwritingStylerPanel
         v-if="activeFeature === 'styleHandwriting'"
         :options="handwritingStylerOptions"
         :preset-cards="penPresetCards"
         :has-char-groups="hasCharGroups"
         :has-stylized-strokes="hasStylizedStrokes"
         @update:options="handwritingStylerOptions = $event"
         @close="toggleFeature(null)"
         @select-preset="selectPenPreset"
         @set-canvas-ref="setPresetCanvasRef"
         @set-main-preview-ref="setMainPreviewRef"
         @action="triggerWhiteboardAction"
       />

      <!-- Math recognizer (AI OCR solving) is excluded from the Pilot surface;
           it has no trigger while `experiment.ai` is unavailable. -->

      <MathGraphPanel
        v-if="showMathGraphPanel"
        @close="toggleMathGraphPanel"
        @plot-function="handleAddElement"
      />
      <PhysicsGraphPanel
        v-if="showPhysicsGraphPanel"
        @close="togglePhysicsGraphPanel"
        @plot-data="handleAddElement"
      />
      <DiagramPanel
        v-if="showDiagramPanel && can('experiment.ai')"
        @close="toggleDiagramPanel"
        @apply="handleDiagramApply"
      />
      <ChemistryPanel
        v-if="showChemistryPanel && can('experiment.chemistry')"
        @close="toggleChemistryPanel"
        @insert-element="handleAddElement"
      />

      <!-- 3.4: Floating Toolbar (Left) with auto-hide toggle -->
      <button v-if="toolbarCollapsed" class="toolbar-expand-btn glass-panel" @click="toggleToolbar" title="Show toolbar">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
      <div class="floating-toolbar" :class="{ 'toolbar-hidden': toolbarCollapsed }">
        <button class="toolbar-collapse-btn" @click="toggleToolbar" title="Hide toolbar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <ToolBar
          :active-tool="currentTool"
          :role="effectiveRole"
          :color="currentColor"
          :fill-color="currentFillColor"
          :line-width="currentLineWidth"
          :current-shape="currentShape"
          :line-style="currentLineStyle"
          :arrow-style="currentArrowStyle"
          :roughness="currentRoughness"
          :is-math-panel-open="showMathGraphPanel"
          :is-physics-panel-open="showPhysicsGraphPanel"
          :is-diagram-panel-open="showDiagramPanel"
          orientation="vertical"
          @update:activeTool="handleToolChange"
          @update:color="handleColorChange"
          @update:fillColor="handleFillColorChange"
          @update:lineWidth="handleLineWidthChange"
          @update:shape="handleShapeChange"
          @update:lineStyle="handleLineStyleChange"
          @update:arrowStyle="handleArrowStyleChange"
          @update:roughness="handleRoughnessChange"
          @update:eraserSize="handleEraserSizeChange"
          @undo="callWhiteboardUndo"
          @redo="callWhiteboardRedo"
          @clear="handleClearCanvas"
          @toggle-math-panel="toggleMathGraphPanel"
          @toggle-physics-panel="togglePhysicsGraphPanel"
          @toggle-diagram-panel="toggleDiagramPanel"
          @add-coordinate-system="handleAddCoordinateSystem"
          @toggle-calculator="toggleCalculator"
          @toggle-chemistry-panel="toggleChemistryPanel"
          @toggle-debug="toggleDebugMode"
        />
      </div>

      <!-- User info in top-right corner -->
      <transition name="fade">
        <button
          v-if="userInfoCollapsed"
          class="user-info-toggle-btn glass-panel"
          @click="toggleUserInfoPanel"
          title="Show user panel"
        >
          <component :is="UsersIcon" :size="20" />
        </button>
      </transition>

      <div class="floating-user-info glass-panel" :class="{ collapsed: userInfoCollapsed }">
        <div class="username-container">
          <input
            v-if="can('dev.editParticipantNames')"
            type="text"
            v-model="username"
            placeholder="Guest"
            class="username-input"
            @blur="updateUsername"
          />
          <span v-else class="username-static" :title="username">{{ username }}</span>
        </div>

        <div class="divider-vertical"></div>

        <div class="user-count" title="Online users">
          <div class="status-dot"></div>
          <span>{{ activeUsersCount }} Online</span>
        </div>

        <button v-if="can('dev.legacyPeerRooms')" class="share-btn" @click="shareRoom">
          <component :is="ShareIcon" :size="16" />
          <span>Share</span>
        </button>

        <button
          v-if="can('dev.debugControls')"
          class="debug-btn"
          @click="toggleDebugMode"
          :class="{ active: debugMode }"
          title="Toggle Debug"
        >
          D
        </button>

        <button class="minimize-btn" @click="toggleUserInfoPanel" title="Hide">
           <component :is="ChevronRightIcon" :size="18" />
        </button>
      </div>
    </div>

    <!-- Dialogs: raw board JSON import/export is a developer tool (ADR: Pilot
         users rely on PDF). -->
    <ImportDialog
      v-if="can('dev.rawBoardTransfer')"
      :show="showImportDialog"
      @close="showImportDialog = false"
      @import="handleImportState"
    />
    <ExportDialog
      v-if="can('dev.rawBoardTransfer')"
      :show="showExportDialog"
      :export-text="exportedState"
      @close="showExportDialog = false"
      @copy="copyToClipboard"
    />
    <CalculatorModal
      :is-visible="isCalculatorVisible"
      @close="isCalculatorVisible = false"
      @update:isVisible="val => isCalculatorVisible = val"
    />

    <EncryptionStatus v-if="can('dev.encryptionClaims')" />

    </template>
    <Lobby v-else-if="can('dev.legacyPeerRooms')" @join="handleJoinRoom" />
    <PilotUnavailable v-else />

    <!-- Global Error Display -->
    <div v-if="globalError" class="global-error-overlay">
      <div class="error-box">
        <h3>Application Error</h3>
        <p>An unexpected error occurred. Please refresh the page.</p>
        <pre>{{ globalError }}</pre>
        <button @click="globalError = null">Dismiss</button>
      </div>
    </div>

  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue';
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import ToolBar from './components/ToolBar.vue';
import TopMenu from './components/TopMenu.vue';
import Lobby from './components/Lobby.vue';
import ImportDialog from './components/ImportDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
import CalculatorModal from './components/CalculatorModal.vue';
import MathGraphPanel from './components/MathGraphPanel.vue';
import PhysicsGraphPanel from './components/PhysicsGraphPanel.vue';
import DiagramPanel from './components/DiagramPanel.vue';
import AIChatPanel from './components/AIChatPanel.vue';
import ChemistryPanel from './components/ChemistryPanel.vue';
import EncryptionStatus from './components/EncryptionStatus.vue';
import GridAlignPanel from './components/GridAlignPanel.vue';
import HandwritingStylerPanel from './components/HandwritingStylerPanel.vue';
import * as Y from 'yjs';
import { undoRedoState as globalUndoRedoState } from './utils/undoRedoState';

import katex from 'katex';
import { buildRoomHash, parseRoomHash } from './lib/roomLink';
import { generateEncryptionKey } from './lib/crypto';
import 'katex/dist/katex.min.css';
import { drawStyledPen, DEFAULT_PEN_PRESETS, makePreviewPoints } from './utils/penStyles';
import { usePdfImport } from './composables/usePdfImport';
import { Users, Share2, ChevronRight, ChevronLeft } from 'lucide-vue-next';
import PilotUnavailable from './views/PilotUnavailable.vue';
import { featureAvailable } from './services/pilotSurface';

// Debug logger
const appDebugLog = (msg, ...args) => {
  // console.log(`[App] ${msg}`, ...args);
};

export default {
  name: 'App',
  components: {
    WhiteboardCanvas,
    ToolBar,
    TopMenu,
    Lobby,
    ImportDialog,
    ExportDialog,
    CalculatorModal,
    MathGraphPanel,
    PhysicsGraphPanel,
    DiagramPanel,
    AIChatPanel,
    ChemistryPanel,
    EncryptionStatus,
    GridAlignPanel,
    HandwritingStylerPanel,
    PilotUnavailable
  },
  setup() {
    // --- State ---
    const whiteboard = ref(null);
    const toolbar = ref(null); // Ref for ToolBar component
    const roomId = ref(null);
    const roomKey = ref(null);
    const userRole = ref(null); // null = peer room (no role), 'teacher' | 'student'

    // --- Pilot surface (shared manifest, Module 9) ---
    // Every conditional mount consults the same manifest version the server
    // uses; in the Pilot build excluded features resolve unavailable, so no
    // control, panel, dialog or provider call exists for them.
    const effectiveRole = computed(() =>
      userRole.value === 'teacher' || userRole.value === 'student' ? userRole.value : 'developer'
    );
    const can = (featureId, role = effectiveRole.value) =>
      featureAvailable(featureId, role);
    const username = ref(localStorage.getItem('username') || 'Guest');
    const updateUsername = () => {
      localStorage.setItem('username', username.value);
      if (whiteboard.value && whiteboard.value.updateAwarenessUser) {
        whiteboard.value.updateAwarenessUser(username.value);
      }
    };
    const showImportDialog = ref(false);
    const showExportDialog = ref(false);
    const exportedState = ref('');
    const lastSaved = ref(null);
    const statusMessage = ref('');
    const darkMode = ref(localStorage.getItem('darkMode') === 'true');
    const debugMode = ref(false);
    const userInfoCollapsed = ref(false);
    const isCalculatorVisible = ref(false);
    const toggleCalculator = () => {
      isCalculatorVisible.value = !isCalculatorVisible.value;
    };
    // 3.4: Toolbar auto-hide toggle with localStorage persistence
    const toolbarCollapsed = ref(localStorage.getItem('toolbar_collapsed') === 'true');
    const toggleToolbar = () => {
      toolbarCollapsed.value = !toolbarCollapsed.value;
      localStorage.setItem('toolbar_collapsed', String(toolbarCollapsed.value));
    };
    const toggleUserInfoPanel = () => {
      userInfoCollapsed.value = !userInfoCollapsed.value;
    };
    const globalError = ref(null);
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentFillColor = ref(null);
    const currentLineWidth = ref(2);
    const currentShape = ref('rectangle');
    const currentLineStyle = ref('solid');
    const currentArrowStyle = ref('none');
    const currentRoughness = ref(1);

    // Feature flags/state
    const activeFeature = ref(null); // 'gridAlign', 'styleHandwriting', 'mathRecognizer'
    const gridAlignOptions = ref({ snapStrength: 10, showBaselines: false });
    const handwritingStylerOptions = ref({
      preset: 'gel',
      angleNormalization: 50,
      heightNormalization: 50,
      widthNormalization: 50,
      smoothingFactor: 50,
      presets: {
        gel: {
          minWidth: 1.6,
          maxWidth: 3.4,
          velocityK: 0.045,
          shadowAlpha: 0.16,
          shadowOffset: 0.45,
          shadowInflate: 0.9,
          color: '#0057ff',
          smoothing: 0.12
        },
        technical: {
          lineWidth: 2.4,
          shadowAlpha: 0.06,
          shadowInflate: 0.8,
          color: '#0f172a',
          smoothing: 0.25
        },
        marker: {
          width: 14,
          alpha: 0.35,
          composite: 'multiply',
          color: '#ffeb3b',
          shadowAlpha: 0.08,
          shadowOffset: 0.6,
          shadowInflate: 1.2,
          smoothing: 0.15
        },
        calligraphy: {
          minWidth: 2.2,
          maxWidth: 5,
          nibAngle: -0.35,
          variation: 0.65,
          color: '#0b1021',
          smoothing: 0.2
        }
      }
    });
  const mathRecognizerOptions = ref({ ghostOpacity: 0.5, showHint: true });
  const recognitionStatus = ref('Idle');
  const latexEquation = ref('');
  const solution = ref('');
  const hasCharGroups = ref(false);
  const hasStylizedStrokes = ref(false);
  const penPreviewRef = ref(null);
  const presetCanvasRefs = ref({});
  const previewPoints = ref(makePreviewPoints(320, 110));
  const penPresetCards = computed(() => ([
    { key: 'gel', title: 'Gel Pen', pill: 'Ultra smooth', desc: 'Soft ink with micro-shadow and speed-based width.' },
    { key: 'technical', title: 'Technical Pen', pill: 'Monoline', desc: 'Stable, crisp stroke for math and schematics.' },
    { key: 'marker', title: 'Highlighter', pill: 'Multiply', desc: 'Wide translucent marker with gentle offset shadow.' },
    { key: 'calligraphy', title: 'Calligraphy', pill: 'Tilted nib', desc: 'Angled tip with expressive width variation.' }
  ]));
  const activePresetLabel = computed(() => penPresetCards.value.find(p => p.key === handwritingStylerOptions.value.preset)?.title || 'Preset');

    // Yjs awareness state (count/badges)
    const awarenessStates = ref([]);
    const activeUsersCount = computed(() => awarenessStates.value.length);
    const localClientId = ref(null);
    const formattedLastSaved = computed(() => {
      if (!lastSaved.value) return '';
      return new Date(lastSaved.value).toLocaleTimeString();
    });
    
    // WS Token for board access (from student/teacher entry)
    const storedWsToken = computed(() => {
      return localStorage.getItem('board_ws_token') || null;
    });

    // Decode role from a board wsToken (base64url payload before the dot)
    const parseRoleFromToken = (token) => {
      if (!token) return null;
      try {
        const [base] = token.split('.');
        if (!base) return null;
        const json = atob(base.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        return payload.role || null;
      } catch { return null; }
    };

    // Graph Panels
    const showMathGraphPanel = ref(false);
    const showPhysicsGraphPanel = ref(false);
    const showDiagramPanel = ref(false);
    const showChemistryPanel = ref(false);

    const toggleMathGraphPanel = () => {
        showMathGraphPanel.value = !showMathGraphPanel.value;
        if (showMathGraphPanel.value) {
          showPhysicsGraphPanel.value = false;
          showDiagramPanel.value = false;
        }
    };

    const togglePhysicsGraphPanel = () => {
        showPhysicsGraphPanel.value = !showPhysicsGraphPanel.value;
        if (showPhysicsGraphPanel.value) {
          showMathGraphPanel.value = false;
          showDiagramPanel.value = false;
        }
    };

    const toggleDiagramPanel = () => {
        showDiagramPanel.value = !showDiagramPanel.value;
        if (showDiagramPanel.value) {
          showMathGraphPanel.value = false;
          showPhysicsGraphPanel.value = false;
          showChemistryPanel.value = false;
        }
    };

    const toggleChemistryPanel = () => {
        showChemistryPanel.value = !showChemistryPanel.value;
        if (showChemistryPanel.value) {
          showMathGraphPanel.value = false;
          showPhysicsGraphPanel.value = false;
          showDiagramPanel.value = false;
        }
    };

    const resolvePresetConfig = (presetKey) => ({
      ...(DEFAULT_PEN_PRESETS[presetKey] || {}),
      ...(handwritingStylerOptions.value.presets?.[presetKey] || {})
    });

    let previewRaf = null;
    const renderPresetPreview = (presetKey) => {
      const canvas = presetCanvasRefs.value[presetKey];
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cfg = resolvePresetConfig(presetKey);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStyledPen(ctx, makePreviewPoints(canvas.width, canvas.height), {
        style: presetKey,
        color: cfg.color || '#0f172a',
        lineWidth: cfg.previewWidth || 2.8,
        config: cfg,
        globalSmoothing: (handwritingStylerOptions.value.smoothingFactor || 0) / 100
      });
    };

    const renderMainPenPreview = () => {
      const canvas = penPreviewRef.value;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const presetKey = handwritingStylerOptions.value.preset || 'gel';
      const cfg = resolvePresetConfig(presetKey);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const prefersPreset = !currentColor.value || ['#000000', '#000', 'black'].includes(String(currentColor.value).toLowerCase());
      const strokeColor = prefersPreset ? (cfg.color || currentColor.value || '#0f172a') : currentColor.value;
      drawStyledPen(ctx, previewPoints.value, {
        style: presetKey,
        color: strokeColor,
        lineWidth: cfg.previewWidth || 3,
        config: cfg,
        globalSmoothing: (handwritingStylerOptions.value.smoothingFactor || 0) / 100
      });
    };

    const renderAllPenPreviews = () => {
      Object.keys(presetCanvasRefs.value || {}).forEach(renderPresetPreview);
      renderMainPenPreview();
    };

    const queuePreviewRender = () => {
      if (previewRaf) return;
      previewRaf = requestAnimationFrame(() => {
        previewRaf = null;
        renderAllPenPreviews();
      });
    };

    const setPresetCanvasRef = (key, el) => {
      if (!el) return;
      presetCanvasRefs.value[key] = el;
      queuePreviewRender();
    };

    const setMainPreviewRef = (el) => {
      penPreviewRef.value = el;
      queuePreviewRender();
    };

    const selectPenPreset = (presetKey) => {
      handwritingStylerOptions.value.preset = presetKey;
      queuePreviewRender();
    };

    const handleAddElement = (elementData) => {
      if (whiteboard.value?.addElementFromPanel) {
        whiteboard.value.addElementFromPanel(elementData);
      } else {
        console.warn('Whiteboard not ready to add element.', elementData);
      }
    };

    const { importPdfFile } = usePdfImport({
      addElementFromPanel: (data) => handleAddElement(data),
      showToast: (msg, type, dur) => showNotification(msg, type),
      debugLog: appDebugLog,
    });
    const handleImportPdf = (file) => importPdfFile(file);

    const handleDiagramApply = (diagramData) => {
      if (!diagramData?.nodes?.length) return;

      // --- 1. Visual Config ---
      const themePalette = {
        start:    { stroke: '#0f766e', fill: '#f0fdfa', text: '#134e4a' },
        process:  { stroke: '#334155', fill: '#ffffff', text: '#1e293b' },
        decision: { stroke: '#b45309', fill: '#fffbeb', text: '#78350f' },
        end:      { stroke: '#b91c1c', fill: '#fef2f2', text: '#7f1d1d' },
        fallback: { stroke: '#475569', fill: '#f8fafc', text: '#334155' }
      };

      // Helper for text wrapping
      const wrapText = (text, maxChars = 25) => {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            if ((currentLine + " " + words[i]).length < maxChars) {
                currentLine += " " + words[i];
            } else {
                lines.push(currentLine);
                currentLine = words[i];
            }
        }
        lines.push(currentLine);
        return lines;
      };

      const normalizeType = (type) => (type || 'process').toLowerCase();
      
      // Prepare Nodes with dimensions
      const nodes = diagramData.nodes.map((node, idx) => {
        const type = normalizeType(node.type);
        const labelRaw = (node.label || node.id || '').trim();
        const lines = wrapText(labelRaw, 20);
        const label = lines.join('\n');
        
        // Calculate dimension based on text content
        const baseWidth = 160;
        const charWidth = 9; 
        const longestLine = Math.max(...lines.map(l => l.length));
        const width = Math.max(baseWidth, longestLine * charWidth + 40);
        const height = Math.max(80, lines.length * 20 + 50);

        return {
          ...node,
          id: node.id || `node-${idx}`,
          type,
          _lines: lines,
          _label: label,
          _width: width,
          _height: height
        };
      });

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const edges = Array.isArray(diagramData.edges) ? diagramData.edges : [];

      // --- 2. Topological Layout (Top-Down) ---
      
      // A. Calculate Levels (Depth)
      const indeg = new Map(nodes.map(n => [n.id, 0]));
      edges.forEach(e => {
        if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
      });

      const levels = new Map();
      // Find roots
      let queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
      if (queue.length === 0 && nodes.length > 0) queue = [nodes[0].id]; // Handle cycle/no-root

      queue.forEach(id => levels.set(id, 0));
      
      // BFS for levels
      const adj = new Map(nodes.map(n => [n.id, []]));
      edges.forEach(e => {
        if (adj.has(e.from)) adj.get(e.from).push(e.to);
      });

      const visited = new Set(queue);
      
      // Process queue
      let head = 0;
      while(head < queue.length){
          const u = queue[head++];
          const lvl = levels.get(u);
          
          const neighbors = adj.get(u) || [];
          neighbors.forEach(v => {
             if (!visited.has(v)) {
                 levels.set(v, lvl + 1);
                 visited.add(v);
                 queue.push(v);
             } 
             // If already visited, we might want to push it down if this path is longer (Longest Path Layering)
             // but simple BFS is safer for general graphs to avoid explosion.
             else {
                 const currentLvl = levels.get(v);
                 if (lvl + 1 > currentLvl) {
                     levels.set(v, lvl + 1);
                 }
             }
          });
      }

      // Fallback for disconnected components
      nodes.forEach(n => {
          if (!levels.has(n.id)) levels.set(n.id, 0);
      });

      // B. Organize into Rows
      const rows = [];
      levels.forEach((lvl, id) => {
          if (!rows[lvl]) rows[lvl] = [];
          rows[lvl].push(nodeMap.get(id));
      });

      // C. Calculate Positions (Center Alignment)
      const spacingX = 60;
      const spacingY = 120;
      const startX = 100;
      const startY = 100;
      
      // Calculate width of each row
      const rowWidths = rows.map(row => {
          if (!row) return 0;
          return row.reduce((acc, node) => acc + node._width + spacingX, 0) - spacingX;
      });
      
      const maxDiagramWidth = Math.max(...rowWidths);
      const nodePos = new Map();

      let currentY = startY;

      rows.forEach((row, lvl) => {
          if (!row) return;
          
          // Center this row relative to the widest row
          const currentRowWidth = rowWidths[lvl];
          let currentX = startX + (maxDiagramWidth - currentRowWidth) / 2;
          
          // Find max height in this row to step Y correctly
          const maxRowHeight = Math.max(...row.map(n => n._height));

          row.forEach(node => {
              nodePos.set(node.id, {
                  x: currentX,
                  y: currentY,
                  w: node._width,
                  h: node._height,
                  cx: currentX + node._width / 2,
                  cy: currentY + node._height / 2
              });
              currentX += node._width + spacingX;
          });

          currentY += maxRowHeight + spacingY;
      });

      // --- 3. Generate Canvas Elements ---
      const elements = [];

      // Edge Helper
      const getEdgePoints = (fromId, toId) => {
          const p1 = nodePos.get(fromId);
          const p2 = nodePos.get(toId);
          if (!p1 || !p2) return null;

          // Simple center-to-center connection with offset
          // Improve: Connect bottom of p1 to top of p2
          return {
              start: { x: p1.cx, y: p1.y + p1.h }, // Bottom center
              end: { x: p2.cx, y: p2.y }           // Top center
          };
      };

      // Draw Nodes
      nodes.forEach(node => {
          const pos = nodePos.get(node.id);
          if (!pos) return;

          const style = themePalette[node.type] || themePalette.fallback;
          
          // Determine shape
          let shapeType = 'rectangle';
          if (node.type === 'start' || node.type === 'end') shapeType = 'circle'; // or capsule if supported
          if (node.type === 'decision') shapeType = 'diamond';

          // 1. Shape
          elements.push({
            type: shapeType,
            start: { x: pos.x, y: pos.y },
            end: { x: pos.x + pos.w, y: pos.y + pos.h },
            strokeColor: style.stroke,
            fillColor: style.fill,
            lineWidth: 2,
            roughness: 0, // Clean lines
            id: node.id
          });

          // 2. Text
          // We render text manually as multiline
          const lineHeight = 20;
          const totalTextHeight = node._lines.length * lineHeight;
          const startTextY = pos.cy - (totalTextHeight / 2) + (lineHeight / 2);

          node._lines.forEach((line, i) => {
              elements.push({
                  type: 'text',
                  position: { x: pos.cx, y: startTextY + (i * lineHeight) },
                  text: line,
                  fontSize: 16,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: '500',
                  color: style.text,
                  align: 'center',
                  baseline: 'middle',
                  id: `${node.id}-txt-${i}`
              });
          });
      });

      // Draw Edges
      edges.forEach((edge, idx) => {
          const pts = getEdgePoints(edge.from, edge.to);
          if (!pts) return;

          const edgeId = `edge-${idx}`;
          
          // Line
          elements.push({
              type: 'line',
              start: pts.start,
              end: pts.end,
              arrowStyle: 'end',
              strokeColor: '#64748b',
              lineWidth: 2,
              roughness: 0,
              id: edgeId
          });

          // Label (with background)
          if (edge.label) {
              const midX = (pts.start.x + pts.end.x) / 2;
              const midY = (pts.start.y + pts.end.y) / 2;
              
              // Approximate text width for background
              const textW = edge.label.length * 8 + 10;
              const textH = 20;
              
              // Background Rect for label
              elements.push({
                  type: 'rectangle',
                  start: { x: midX - textW/2, y: midY - textH/2 },
                  end: { x: midX + textW/2, y: midY + textH/2 },
                  fillColor: '#ffffff',
                  strokeColor: 'transparent',
                  fillOpacity: 1,
                  id: `${edgeId}-bg`
              });

              // Label Text
              elements.push({
                  type: 'text',
                  position: { x: midX, y: midY },
                  text: edge.label,
                  fontSize: 12,
                  color: '#475569',
                  align: 'center',
                  baseline: 'middle',
                  id: `${edgeId}-lbl`
              });
          }
      });

      elements.forEach(el => handleAddElement(el));
    };

    const handleClearCanvas = () => {
      if (confirm('Wyczyścić całą tablicę? Tej operacji nie można cofnąć.')) {
        whiteboard.value?.clearCanvas?.({ skipConfirm: true });
      }
    };

    const callWhiteboardUndo = () => {
      whiteboard.value?.undo?.();
    };

    const callWhiteboardRedo = () => {
      whiteboard.value?.redo?.();
    };

    // Tool/brush handlers
    const handleLineWidthChange = (width) => {
      currentLineWidth.value = width;
      whiteboard.value?.setLineWidth?.(width);
    };

    const handleArrowStyleChange = (style) => {
      currentArrowStyle.value = style;
      whiteboard.value?.setArrowStyle?.(style);
    };

    const handleRoughnessChange = (value) => {
      currentRoughness.value = value;
      whiteboard.value?.setRoughness?.(value);
    };

    const handleFillColorChange = (color) => {
      currentFillColor.value = color;
      whiteboard.value?.setFillColor?.(color);
    };

    const handleEraserSizeChange = (size) => {
      whiteboard.value?.setEraserSize?.(size);
    };

    const handleLineStyleChange = (style) => {
      currentLineStyle.value = style;
      whiteboard.value?.setLineStyle?.(style);
    };

    const handleShapeChange = (shape) => {
      currentShape.value = shape;
      if (currentTool.value !== 'shapes') {
        currentTool.value = 'shapes';
        whiteboard.value?.setTool?.('shapes');
      }
    };

    const handleColorChange = (color) => {
      currentColor.value = color;
      whiteboard.value?.setColor?.(color);
    };

    const handleToolChange = (tool) => {
      currentTool.value = tool;
      whiteboard.value?.setTool?.(tool);
    };
    
    const forceUpdateUndoRedo = () => {
        // Triggered by ToolBar to refresh state
        if (whiteboard.value) {
            // This might be redundant if we use the event listener from WhiteboardCanvas
            // but good for manual refresh
        }
    };

    const showStatus = (msg, duration = 2000) => {
      statusMessage.value = msg;
      setTimeout(() => { statusMessage.value = ''; }, duration);
    };
    
    const showNotification = (msg, type = 'info') => {
        if (whiteboard.value && whiteboard.value.showToast) {
            whiteboard.value.showToast(msg, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${msg}`);
        }
    };

    const handleBeforeUnload = (e) => {
      // Optional: warn if unsaved changes? Yjs saves automatically though.
    };

    const handleExportRequest = () => {
      if (whiteboard.value) {
        const state = whiteboard.value.getSnapshot(); // Returns base64
        exportedState.value = state;
        showExportDialog.value = true;
      }
    };

    const handleExportPdfSingle = async () => {
      if (whiteboard.value?.exportBoardAsPdf) {
        await whiteboard.value.exportBoardAsPdf();
      } else {
        console.warn('[App] whiteboard ref missing or exportBoardAsPdf not exposed');
        showStatus('PDF export not available.', 3000);
      }
    };

    const handleExportPdfPaged = async () => {
      if (whiteboard.value?.exportBoardAsPdfPaged) {
        await whiteboard.value.exportBoardAsPdfPaged();
      } else {
        console.warn('[App] whiteboard ref missing or exportBoardAsPdfPaged not exposed');
        showStatus('PDF export not available.', 3000);
      }
    };

    const copyToClipboardLocal = (text) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      } else {
        return Promise.reject('Clipboard API not available');
      }
    };

    const syncWhiteboardState = () => {
      if (!whiteboard.value) return;
      whiteboard.value.setTool?.(currentTool.value);
      whiteboard.value.setColor?.(currentColor.value);
      whiteboard.value.setLineWidth?.(currentLineWidth.value);
    };

    const downloadAsFile = () => {
      const blob = new Blob([exportedState.value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard_${roomId.value}_${new Date().toISOString().replace(/:/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('File downloaded!');
    };

    const handleOpenRoomManager = () => {
      // Disconnect or clean up if needed
      roomId.value = null;
      roomKey.value = null;
      window.history.pushState({}, '', '/'); // Clear URL
    };

    const handleImportState = (base64State) => {
      if (!base64State.trim()) {
        showStatus('Please paste a valid whiteboard state (base64).', 3000);
        return;
      }
      if (whiteboard.value?.yjsConnection?.ydoc) {
        try {
          const binaryString = window.atob(base64State);
          const len = binaryString.length;
          const stateUpdate = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            stateUpdate[i] = binaryString.charCodeAt(i);
          }
          whiteboard.value.yjsConnection.ydoc.transact(() => {
            Y.applyUpdate(whiteboard.value.yjsConnection.ydoc, stateUpdate);
          });
          showStatus('Whiteboard state loaded successfully!');
          lastSaved.value = new Date().toISOString();
          showImportDialog.value = false;
        } catch (e) {
          console.error('Error importing Yjs state:', e);
          showStatus('Invalid whiteboard state format (base64).', 3000);
        }
      }
    };

    const handleJsonFileImport = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try { handleImportState(e.target.result); }
        catch (err) {
          console.error('Error reading state file:', err);
          showStatus('Error reading file.', 3000);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

    const handleImageSelected = (file) => {
      appDebugLog("App.vue: handleImageSelected called with:", file);
      if (!file) {
          console.warn("handleImageSelected: No file received.");
          return;
      }
      if (!whiteboard.value) {
          console.warn("handleImageSelected: Whiteboard ref not available yet.");
          showNotification("Whiteboard not ready, please try again.", "warning");
          return;
      }

      if (file instanceof File) {
        appDebugLog(`handleImageSelected: Processing File object: ${file.name}, type: ${file.type}`);
        const reader = new FileReader();

        reader.onload = (e) => {
          appDebugLog("FileReader onload triggered.");
          const dataUrl = e.target.result;
          if (whiteboard.value?.addImageFromDataUrl) {
            appDebugLog("Calling whiteboard.addImageFromDataUrl with dataUrl (first 50 chars):", dataUrl.substring(0, 50));
            whiteboard.value.addImageFromDataUrl(dataUrl);
            appDebugLog("Called whiteboard.addImageFromDataUrl.");
          } else {
            console.error("Whiteboard ref or addImageFromDataUrl method not available when FileReader loaded.");
            showNotification("Error processing image (internal).", "error");
          }
        };

        reader.onerror = (err) => {
            console.error("FileReader error:", err);
            showNotification("Error reading selected file.", "error");
        };

        reader.readAsDataURL(file);
        appDebugLog("FileReader readAsDataURL called.");

      } else {
         console.warn("handleImageSelected received non-File object:", file);
         if (whiteboard.value?.addImageFromDataUrl && typeof file === 'string') {
             appDebugLog("Calling whiteboard.addImageFromDataUrl with non-File object (string)...");
             whiteboard.value.addImageFromDataUrl(file);
         } else {
             showNotification("Invalid image data received.", "error");
         }
      }
    };


    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
      localStorage.setItem('darkMode', darkMode.value);
      // My new CSS is dark by default, so we toggle 'light-mode' when darkMode is FALSE
      if (darkMode.value) {
        document.body.classList.remove('light-mode');
      } else {
        document.body.classList.add('light-mode');
      }
      
      if (whiteboard.value) {
        nextTick(() => { whiteboard.value.redrawCanvas(); });
      }
      showStatus(darkMode.value ? 'Dark mode enabled' : 'Light mode enabled');
    };

    const toggleDebugMode = () => {
      debugMode.value = !debugMode.value;
      if (whiteboard.value) whiteboard.value.toggleDebug(debugMode.value);
      showNotification(`Debug mode: ${debugMode.value ? 'ENABLED' : 'DISABLED'}`, 'info');
    };

    const ensureRoomKey = async () => {
      if (!roomKey.value) {
        roomKey.value = await generateEncryptionKey('string');
      }
      return roomKey.value;
    };

    const updateRoomUrlHash = () => {
      if (!roomId.value || !roomKey.value) return null;
      const hash = buildRoomHash({ roomId: roomId.value, roomKey: roomKey.value });
      const shareableUrl = `${window.location.origin}${window.location.pathname}${hash}`;
      window.history.replaceState({}, '', shareableUrl);
      return { hash, shareableUrl };
    };

    const shareRoom = async () => {
      await ensureRoomKey();
      const { shareableUrl } = updateRoomUrlHash() || {
        shareableUrl: `${window.location.origin}${window.location.pathname}`
      };

      const fallbackCopy = () => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = shareableUrl;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'absolute';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          const success = document.execCommand('copy');
          document.body.removeChild(textarea);
          return success;
        } catch (error) {
          console.error('Fallback copy failed:', error);
          return false;
        }
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareableUrl)
          .then(() => {
            showStatus('Room link copied! Share to collaborate.');
            showNotification('Room link copied', 'success');
          })
          .catch(err => {
            console.error('Failed to copy with Clipboard API:', err);
            if (fallbackCopy()) {
              showStatus('Room link copied!', 2000);
              showNotification('Room link copied', 'success');
            } else {
              showStatus('Failed to copy room link.', 3000);
              showNotification('Unable to copy room link', 'error');
            }
          });
      } else {
        if (fallbackCopy()) {
          showStatus('Room link copied!', 2000);
          showNotification('Room link copied', 'success');
        } else {
          showStatus('Failed to copy room link.', 3000);
          showNotification('Unable to copy room link', 'error');
        }
      }
    };

    // --- Feature Methods ---
    const toggleFeature = (featureName) => {
      if (activeFeature.value === featureName) {
        activeFeature.value = null; // Toggle off if clicking the same feature
      } else {
        activeFeature.value = featureName;
      }
      // WhiteboardCanvas watcher will handle enabling/disabling modules
      if (debugMode.value) {
        appDebugLog(`[App] Active feature: ${activeFeature.value}`);
      }
    };

    const triggerWhiteboardAction = (actionName, payload = null) => {
      if (whiteboard.value && typeof whiteboard.value[actionName] === 'function') {
        appDebugLog(`[App] Triggering whiteboard action: ${actionName}`);
        whiteboard.value[actionName](payload);
      } else {
        console.warn(`[App] Whiteboard ref or action '${actionName}' not available.`);
      }
    };

    // --- Keyboard Shortcuts ---
    const handleGlobalKeyDown = (event) => {
      // Ignore if typing in an input
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      // Shift + K for Calculator
      if (event.shiftKey && event.key.toUpperCase() === 'K') {
        event.preventDefault();
        toggleCalculator();
      }
      // Add other global shortcuts here if needed
    };

    const handleJoinRoom = async (id) => {
      // 1. Resolve key first to avoid mounting WhiteboardCanvas with null key
      let key = null;
      const existing = parseRoomHash(window.location.hash);
      if (existing?.roomId === id) {
        key = existing.roomKey;
      }
      
      if (!key) {
        key = await generateEncryptionKey('string');
      }

      // 2. Set state atomically-ish
      roomKey.value = key;
      roomId.value = id;
      
      updateRoomUrlHash();
      localStorage.setItem('last_room_id', id);

      // Save to recent rooms
      try {
        const stored = localStorage.getItem('whitevue_recent_rooms');
        let recent = stored ? JSON.parse(stored) : [];
        // Remove if exists to move to top
        recent = recent.filter(r => r.id !== id);
        recent.unshift({ id, lastVisited: new Date().toISOString() });
        // Keep last 5
        recent = recent.slice(0, 5);
        localStorage.setItem('whitevue_recent_rooms', JSON.stringify(recent));
      } catch (e) {
        console.error('Error saving recent rooms', e);
      }
    };

    // 5.8: Watch specific properties instead of deep watcher on entire options object
    watch(() => handwritingStylerOptions.value.preset, () => {
      if (activeFeature.value === 'styleHandwriting') {
        queuePreviewRender();
      }
    });
    watch(() => handwritingStylerOptions.value.smoothingFactor, () => {
      if (activeFeature.value === 'styleHandwriting') {
        queuePreviewRender();
      }
    });

    watch(currentColor, () => {
      if (activeFeature.value === 'styleHandwriting') {
        queuePreviewRender();
      }
    });

    watch(activeFeature, (val) => {
      if (val === 'styleHandwriting') {
        nextTick(() => queuePreviewRender());
      } else {
        presetCanvasRefs.value = {};
      }
    });

    watch(whiteboard, (instance) => {
      if (instance) {
        syncWhiteboardState();
      }
    });

    // --- Lifecycle Hooks ---
    onMounted(() => {
      const bootstrapRoom = async () => {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Check for wsToken-based access (from student/teacher board entry)
        const queryRoom = urlParams.get('room');
        const queryWsToken = urlParams.get('wsToken');
        const queryName = urlParams.get('name');
        
        if (queryRoom && queryWsToken) {
          // Student/teacher board access via token (no E2E encryption needed)
          roomId.value = queryRoom;
          // Use a dummy key or skip encryption for token-based boards
          roomKey.value = 'board-token-access';
          userRole.value = parseRoleFromToken(queryWsToken);
          if (queryName) {
            username.value = queryName;
            localStorage.setItem('username', queryName);
          }
          // Store wsToken for WhiteboardCanvas to use
          localStorage.setItem('board_ws_token', queryWsToken);
          appDebugLog(`App mounted with board token. Room ID: ${roomId.value}, role: ${userRole.value}`);
          return;
        }

        // Legacy peer-room access (development dev surface only). The Pilot
        // never auto-bootstraps a room on `/`: Root.vue only mounts App for a
        // board session, and the Lobby below is dev-only.
        if (!can('dev.legacyPeerRooms', 'developer')) {
          appDebugLog('Legacy peer rooms unavailable in this environment');
          return;
        }
        const parsedHash = parseRoomHash(window.location.hash);
        if (parsedHash) {
          roomId.value = parsedHash.roomId;
          roomKey.value = parsedHash.roomKey;
          updateRoomUrlHash();
        } else if (queryRoom) {
          roomId.value = queryRoom;
          await ensureRoomKey();
          updateRoomUrlHash();
        }
        if (roomId.value) {
          localStorage.setItem('last_room_id', roomId.value);
        }
        appDebugLog(`App mounted. Room ID: ${roomId.value}`);
      };

      bootstrapRoom();
      nextTick(syncWhiteboardState);

      // Initial theme set
      if (!darkMode.value) {
        document.body.classList.add('light-mode');
      } else {
        document.body.classList.remove('light-mode');
      }
      
      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('keydown', handleGlobalKeyDown); // Add global key listener
      queuePreviewRender();
    });

    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleGlobalKeyDown); // Remove global key listener
    });

    // --- Return values accessible to the template ---
    return {
      UsersIcon: Users,
      ShareIcon: Share2,
      ChevronRightIcon: ChevronRight,
      ChevronLeftIcon: ChevronLeft,
      can,
      effectiveRole,
      whiteboard,
      toolbar,
      lastSaved,
      showExportDialog,
      showImportDialog,
      exportedState,
      username,
      awarenessStates,
      statusMessage,
      darkMode,
      debugMode,
      userInfoCollapsed,
      roomId,
      roomKey,
      userRole,
      storedWsToken,
      currentTool,
      currentColor,
      currentLineWidth,
      currentShape,
      currentLineStyle,
      currentArrowStyle,
      currentRoughness,
      currentFillColor,
      isCalculatorVisible,
      toolbarCollapsed,
      toggleToolbar,
      activeUsersCount,
      localClientId,
      formattedLastSaved,
      handleToolChange,
      handleColorChange,
      handleLineWidthChange,
      handleEraserSizeChange,
      handleShapeChange,
      handleLineStyleChange,
      handleArrowStyleChange,
      handleRoughnessChange,
      handleFillColorChange,
      toggleCalculator, // Return toggle method
      toggleUserInfoPanel,
      handleClearCanvas,
      handleExportRequest,
      handleExportPdfSingle,
      handleExportPdfPaged,
      handleImportState,
      handleImageSelected,
      copyToClipboard: copyToClipboardLocal,
      downloadAsFile,
      handleJsonFileImport,
      updateUsername,
      shareRoom,
      handleOpenRoomManager,
      toggleDebugMode,
      toggleDarkMode,
      showStatus,
      showNotification,
      callWhiteboardUndo,
      callWhiteboardRedo,
      globalUndoRedoState,
      forceUpdateUndoRedo,
      globalError,

      // Feature state & methods
      activeFeature,
      gridAlignOptions,
      handwritingStylerOptions,
      penPresetCards,
      selectPenPreset,
      setPresetCanvasRef,
      setMainPreviewRef,
      penPreviewRef,
      activePresetLabel,
      mathRecognizerOptions,
      recognitionStatus,
      latexEquation,
      solution,
      hasCharGroups,
      hasStylizedStrokes,
      toggleFeature,
      toggleMathGraphPanel,
      togglePhysicsGraphPanel,
      toggleDiagramPanel,
      triggerWhiteboardAction,
      handleJoinRoom,
      showMathGraphPanel,
      showPhysicsGraphPanel,
      showDiagramPanel,
      showChemistryPanel,
      toggleChemistryPanel,
      handleAddElement,
      handleDiagramApply,
      handleImportPdf,
      handleAddCoordinateSystem: (type) => {
        // Create default coordinate system element
        const elementData = {
          type: type === '2d' ? 'coordinateSystem2D' : 'coordinateSystem3D',
          position: { x: 100, y: 100 },
          width: 400,
          height: 300,
          // Add default properties if needed
        };
        handleAddElement(elementData);
      }
      // Need to add computed for renderedLatex if KaTeX is used here
    };
  }
}
</script>

<style>

/* Layout Styles Only - Theme is handled in style.css */



html, body {

  width: 100%;

  height: 100%;

  overflow: hidden;

}



body {

  margin: 0;

  width: 100vw;

  height: 100vh;

  /* Background handled in style.css */

}



#app {

  display: flex;

  flex-direction: column;

  width: 100%;

  height: 100%;

  overflow: hidden;

  /* Colors handled in style.css */

}



.whiteboard-container {

  flex: 1;

  display: flex;

  position: relative;

  overflow: hidden;

  width: 100%;

}



/* Canvas taking full available space */

.whiteboard-container canvas {

  flex: 1;

  width: 100%;

  height: 100%;

  touch-action: none;

}



/* UI Overlays Positioned Absolute */



.theme-toggle-container {

  position: absolute;

  bottom: 20px;

  right: 20px;

  z-index: 50;

}



.status-message {

  background-color: rgba(0, 0, 0, 0.8);

  color: white;

  padding: 8px 12px;

  border-radius: 4px;

  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

  z-index: var(--z-toast, 5000);

}



.logo { display: flex; align-items: center; gap: 10px; }

.logo svg { stroke: var(--accent-primary); }

.logo h1 { margin: 0; font-size: 18px; font-weight: 500; color: var(--text-primary); }

.username-container { margin-left: 20px; }



.global-error-overlay {

  position: fixed;

  top: 0;

  left: 0;

  width: 100%;

  height: 100%;

  background: rgba(0,0,0,0.8);

  z-index: var(--z-error-overlay, 9999);

  display: flex;

  align-items: center;

  justify-content: center;

}



.error-box {

  background: #1e293b;

  padding: 20px;

  border-radius: 8px;

  max-width: 80%;

  color: #ef4444;

  border: 1px solid rgba(255,255,255,0.1);

}



.error-box pre {

  white-space: pre-wrap;

  background: rgba(0,0,0,0.2);

  padding: 10px;

  margin: 10px 0;

  color: #e2e8f0;

}



.username-input {

  /* Styled globally in style.css */

}



.user-count { display: flex; align-items: center; margin-left: 15px; gap: 5px; }

.user-count-badge {

  display: flex; align-items: center; justify-content: center;

  background-color: var(--accent-primary); color: white; border-radius: 50%;

  min-width: 24px; height: 24px; padding: 0 6px;

  font-size: 12px; font-weight: bold;

}

.user-count-label { font-size: 14px; color: var(--text-secondary); }



.actions { margin-left: auto; display: flex; gap: 10px; }



/* Floating Toolbar Container Positioning */

.floating-toolbar {

  position: absolute !important;

  left: 20px;

  top: 50%;

  transform: translateY(-50%);

  display: flex;

  flex-direction: column;

  pointer-events: none;

  z-index: var(--z-toolbar, 3000);

  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

}



/* 3.4: Toolbar collapse/expand */
.floating-toolbar.toolbar-hidden {
  transform: translateY(-50%) translateX(calc(-100% - 40px));
  opacity: 0;
  pointer-events: none;
}

.toolbar-collapse-btn {
  position: absolute;
  top: 4px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle, #e2e8f0);
  background: var(--bg-surface, white);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  pointer-events: auto;
  transition: all 0.2s;
}

.toolbar-collapse-btn:hover {
  background: var(--bg-base, #f1f5f9);
  color: var(--text-primary);
}

.toolbar-expand-btn {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle, #e2e8f0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-toolbar, 3000);
  color: var(--text-secondary);
  transition: all 0.2s;
}

.toolbar-expand-btn:hover {
  transform: translateY(-50%) scale(1.1);
  color: var(--text-primary);
}

/* Floating User Info */
.floating-user-info {
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 16px; /* Increased from 12px to prevent overlap */
  z-index: var(--z-user-info, 3000);
  pointer-events: auto;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  
  /* Glass Style */
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  padding: 8px 12px 8px 18px; /* Increased padding for better spacing */
  border-radius: 30px;
  box-shadow: 
    0 4px 20px -5px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.dark-mode .floating-user-info {
  background: rgba(30, 41, 59, 0.8);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 
    0 4px 20px -5px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.05);
}

.floating-user-info.collapsed {
  transform: translateX(calc(100% + 40px));
  opacity: 0;
  pointer-events: none;
}

.user-info-toggle-btn {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: calc(var(--z-user-info, 3000) + 1);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.dark-mode .user-info-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border-color: rgba(255, 255, 255, 0.1);
}

.user-info-toggle-btn:hover {
  transform: scale(1.05);
  background: white;
}

.dark-mode .user-info-toggle-btn:hover {
  background: #334155;
}

.username-input {
  background: transparent;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  width: 100px;
  outline: none;
  padding: 4px 0;
}

.username-input:focus {
  border-bottom: 1px solid var(--accent-primary);
}

.divider-vertical {
  width: 1px;
  height: 20px;
  background: rgba(0, 0, 0, 0.1);
}

.dark-mode .divider-vertical {
  background: rgba(255, 255, 255, 0.1);
}

.user-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
}

.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--accent-primary);
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: 4px;
}

.share-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.debug-btn {
  background: transparent;
  border: 1px solid rgba(0,0,0,0.1);
  color: var(--text-tertiary);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
}

.debug-btn.active {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.2);
}

.minimize-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 4px;
}

.minimize-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.dark-mode .minimize-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}





/* Notifications */

.notification-info { background-color: var(--accent-primary); }

.notification-success { background-color: #10b981; }

.notification-warning { background-color: #f59e0b; }

.notification-error { background-color: #ef4444; }



/* Feature Panels (Draggable/Absolute) */

.feature-panel {

  position: absolute;

  top: 80px;

  left: 50%;

  transform: translateX(-50%);

  width: 420px;
  max-width: 92vw;

  z-index: var(--z-panel, 1010);

  display: flex;

  flex-direction: column;

  /* Glass style applied via global class .feature-panel in style.css */

}



.panel-header {

  display: flex;

  justify-content: space-between;

  align-items: center;

  padding: 12px 16px;

  font-weight: 600;

}



.panel-content {

  padding: 16px;

  display: flex;

  flex-direction: column;

  gap: 16px;

  overflow-y: auto;

  max-height: 70vh;

}

.slider-container,

.checkbox-container,

.status-display,

.latex-preview-container,

.button-group {

  display: flex;

  flex-direction: column;

  gap: 6px;

}



.checkbox-container {

  flex-direction: row;

  align-items: center;

  gap: 10px;

}



.slider-container label,

.checkbox-container label {

  font-size: 13px;

  color: var(--text-secondary);

}



.action-button {

  padding: 8px 12px;

  background-color: var(--accent-primary);

  color: white;

  border: none;

  border-radius: 6px;

  cursor: pointer;

  font-size: 13px;

  transition: background-color 0.2s ease;

}

.action-button:hover:not(:disabled) {

  background-color: var(--accent-hover);

}

.action-button:disabled {

  background-color: rgba(255,255,255,0.1);

  color: rgba(255,255,255,0.3);

  cursor: not-allowed;

}



.button-group {

  display: flex;

  flex-direction: row;

  flex-wrap: wrap;

  gap: 8px;

}

.button-group .action-button {

  flex-grow: 1;

}



.latex-preview-container {

  margin-top: 5px;

  padding: 10px;

  background-color: rgba(0,0,0,0.2);

  border: 1px solid var(--glass-border);

  border-radius: 6px;

  overflow-x: auto;

  font-size: 14px;

  color: var(--text-primary);

}



.latex-preview-container .katex {

   color: var(--text-primary) !important;

}

</style>
