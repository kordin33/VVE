// HandwritingStylerModule.js
// Provides lightweight grouping and geometric normalization for handwriting strokes

// 7.6: Return null for invalid points instead of {x:0,y:0} to avoid corrupting strokes
const normalizePoint = (point) => {
  if (!point) return null;
  if (Array.isArray(point)) {
    const x = point[0];
    const y = point[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x,
      y,
      pressure: point[2] ?? 0,
      t: point[3] ?? 0
    };
  }
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    pressure: point.pressure ?? point.p ?? 0,
    t: point.t ?? 0
  };
};

// Filter out null points from normalizePoint
const cloneStroke = (stroke) => ({
  ...stroke,
  points: Array.isArray(stroke?.points)
    ? stroke.points.map(normalizePoint).filter(Boolean)
    : []
});

export default class HandwritingStylerModule {
  constructor(canvasContext, options = {}) {
    this.ctx = canvasContext;

    this.options = {
      angleNormalization: options.angleNormalization || 50,
      heightNormalization: options.heightNormalization || 50,
      widthNormalization: options.widthNormalization || 50,
      smoothingFactor: options.smoothingFactor || 50,
      groupingTimeThreshold: options.groupingTimeThreshold || 1000, // ms
      groupingDistanceThreshold: options.groupingDistanceThreshold || 100, // px
      ...options
    };

    this.strokes = [];
    this.charGroups = [];
    this.stylizedStrokes = null;
    this.enabled = false;
  }

  // Activation
  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    return this;
  }

  addStroke(stroke) {
    if (!this.enabled) return this;
    this.strokes.push(cloneStroke(stroke));
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  setStrokes(strokes = []) {
    this.strokes = strokes.map(cloneStroke);
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  getStrokeBounds(stroke) {
    const pts = Array.isArray(stroke?.points) ? stroke.points.map(normalizePoint) : [];
    if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    pts.forEach(({ x, y }) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    return { minX, minY, maxX, maxY };
  }

  getGroupBounds(group) {
    if (!group.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    group.forEach((stroke) => {
      const bounds = this.getStrokeBounds(stroke);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    });

    return { minX, minY, maxX, maxY };
  }

  calculateSpatialDifference(stroke1, stroke2) {
    const bounds1 = this.getStrokeBounds(stroke1);
    const bounds2 = this.getStrokeBounds(stroke2);

    const center1X = (bounds1.minX + bounds1.maxX) / 2;
    const center1Y = (bounds1.minY + bounds1.maxY) / 2;
    const center2X = (bounds2.minX + bounds2.maxX) / 2;
    const center2Y = (bounds2.minY + bounds2.maxY) / 2;

    const distX = center1X - center2X;
    const distY = center1Y - center2Y;
    return Math.sqrt(distX * distX + distY * distY);
  }

  // Group strokes into characters
  groupStrokes() {
    if (!this.enabled || !this.strokes.length) return this;

    this.charGroups = [];
    this.stylizedStrokes = null;

    const sortedStrokes = [...this.strokes].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (!sortedStrokes.length) return this;

    let currentGroup = [sortedStrokes[0]];
    for (let i = 1; i < sortedStrokes.length; i++) {
      const stroke = sortedStrokes[i];
      const prevStroke = sortedStrokes[i - 1];
      const timeDiff = (stroke.timestamp && prevStroke.timestamp) ? stroke.timestamp - prevStroke.timestamp : Infinity;
      const spatialDiff = this.calculateSpatialDifference(stroke, prevStroke);

      if (timeDiff < this.options.groupingTimeThreshold && spatialDiff < this.options.groupingDistanceThreshold) {
        currentGroup.push(stroke);
      } else {
        if (currentGroup.length) {
          this.charGroups.push([...currentGroup]);
        }
        currentGroup = [stroke];
      }
    }

    if (currentGroup.length) {
      this.charGroups.push(currentGroup);
    }
    return this;
  }

  analyzeStyle() {
    if (!this.charGroups.length) return null;

    const groupStyles = this.charGroups.map((group) => {
      let totalAngle = 0;
      let angleCount = 0;
      group.forEach((stroke) => {
        const pts = (stroke.points || []).map(normalizePoint);
        for (let i = 1; i < pts.length; i++) {
          const dx = pts[i].x - pts[i - 1].x;
          const dy = pts[i].y - pts[i - 1].y;
          if (dx !== 0 || dy !== 0) {
            totalAngle += Math.atan2(dy, dx);
            angleCount++;
          }
        }
      });

      const bounds = this.getGroupBounds(group);
      const width = bounds.maxX - bounds.minX || 1;
      const height = bounds.maxY - bounds.minY || 1;

      return {
        angle: angleCount > 0 ? totalAngle / angleCount : 0,
        width,
        height,
        bounds
      };
    });

    const avgStyle = {
      angle: groupStyles.reduce((sum, style) => sum + style.angle, 0) / groupStyles.length,
      width: groupStyles.reduce((sum, style) => sum + style.width, 0) / groupStyles.length,
      height: groupStyles.reduce((sum, style) => sum + style.height, 0) / groupStyles.length
    };

    return { groupStyles, avgStyle };
  }

  smoothPoints(points, factor) {
    if (points.length < 3 || factor <= 0) return points;
    const smoothFactor = Math.min(Math.max(factor / 100, 0), 0.5);
    const result = [points[0]];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      const q0 = {
        x: p0.x * (1 - smoothFactor) + p1.x * smoothFactor,
        y: p0.y * (1 - smoothFactor) + p1.y * smoothFactor,
        pressure: p0.pressure
      };

      const q1 = {
        x: p0.x * smoothFactor + p1.x * (1 - smoothFactor),
        y: p0.y * smoothFactor + p1.y * (1 - smoothFactor),
        pressure: p1.pressure
      };

      result.push(q0, q1);
    }

    result.push(points[points.length - 1]);
    return result;
  }

  applyStyleTransformation() {
    if (!this.enabled || !this.charGroups.length) return this;

    const styleAnalysis = this.analyzeStyle();
    if (!styleAnalysis) return this;

    this.stylizedStrokes = this.strokes.map(cloneStroke);

    this.charGroups.forEach((group, groupIndex) => {
      const groupStyle = styleAnalysis.groupStyles[groupIndex];
      const targetStyle = styleAnalysis.avgStyle;

      const angleNorm = this.options.angleNormalization / 100;
      const heightNorm = this.options.heightNormalization / 100;
      const widthNorm = this.options.widthNormalization / 100;

      const targetAngle = groupStyle.angle * (1 - angleNorm) + targetStyle.angle * angleNorm;
      const targetHeight = groupStyle.height * (1 - heightNorm) + targetStyle.height * heightNorm;
      const targetWidth = groupStyle.width * (1 - widthNorm) + targetStyle.width * widthNorm;

      const scaleX = groupStyle.width === 0 ? 1 : targetWidth / groupStyle.width;
      const scaleY = groupStyle.height === 0 ? 1 : targetHeight / groupStyle.height;
      const rotationAngle = targetAngle - groupStyle.angle;
      const centerX = (groupStyle.bounds.minX + groupStyle.bounds.maxX) / 2;
      const centerY = (groupStyle.bounds.minY + groupStyle.bounds.maxY) / 2;

      group.forEach((stroke) => {
        const stylizedIndex = this.stylizedStrokes.findIndex((s) => s.id === stroke.id);
        if (stylizedIndex === -1) return;

        const transformedPoints = this.stylizedStrokes[stylizedIndex].points.map((point) => {
          let x = point.x - centerX;
          let y = point.y - centerY;

          const rotatedX = x * Math.cos(rotationAngle) - y * Math.sin(rotationAngle);
          const rotatedY = x * Math.sin(rotationAngle) + y * Math.cos(rotationAngle);

          const scaledX = rotatedX * scaleX;
          const scaledY = rotatedY * scaleY;

          return {
            x: scaledX + centerX,
            y: scaledY + centerY,
            pressure: point.pressure,
            t: point.t
          };
        });

        this.stylizedStrokes[stylizedIndex].points =
          this.options.smoothingFactor > 0
            ? this.smoothPoints(transformedPoints, this.options.smoothingFactor)
            : transformedPoints;
      });
    });

    return this;
  }

  confirmStyleChanges() {
    if (!this.enabled || !this.stylizedStrokes) return null;
    const updatedStrokes = [...this.stylizedStrokes];
    this.strokes = [...this.stylizedStrokes];
    this.stylizedStrokes = null;
    this.charGroups = [];
    return updatedStrokes;
  }

  cancelStyleChanges() {
    if (!this.enabled) return this;
    this.stylizedStrokes = null;
    return this;
  }

  drawCharGroups(ctx = this.ctx) {
    if (!this.enabled || !this.charGroups.length || this.stylizedStrokes) return this;
    if (!ctx) return this;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    this.charGroups.forEach((group) => {
      const bounds = this.getGroupBounds(group);
      ctx.strokeRect(
        bounds.minX - 5,
        bounds.minY - 5,
        bounds.maxX - bounds.minX + 10,
        bounds.maxY - bounds.minY + 10
      );
    });

    ctx.restore();
    return this;
  }

  getStrokes() {
    return this.stylizedStrokes || this.strokes;
  }

  clear() {
    this.strokes = [];
    this.charGroups = [];
    this.stylizedStrokes = null;
    return this;
  }

  hasCharGroups() {
    return this.charGroups.length > 0;
  }

  hasStylizedStrokes() {
    return this.stylizedStrokes !== null;
  }
}
