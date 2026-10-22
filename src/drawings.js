// Serializable chart drawings. Keep geometry separate from Canvas rendering so
// old saved trend lines and new drawing tools share the same validation rules.
export const DRAWING_TOOLS = Object.freeze(['pan', 'select', 'line', 'horizontal', 'vertical', 'fib']);
export const DRAWING_TYPES = Object.freeze(['line', 'horizontal', 'vertical', 'fib']);
export const FIB_RATIOS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
export const MAX_DRAWINGS = 200;

function normalizePoint(value) {
  if (!value || !Number.isFinite(value.time) || !Number.isFinite(value.price) ||
      value.time < 0 || value.price <= 0) return null;
  return { time: value.time, price: value.price };
}

/** Backwards-compatible with old {a,b} lines saved before v0.7. */
export function normalizeDrawing(drawing) {
  if (!drawing || typeof drawing !== 'object') return null;
  const type = drawing.type ?? 'line';
  if (!DRAWING_TYPES.includes(type)) return null;
  const a = normalizePoint(drawing.a);
  const b = normalizePoint(drawing.b ?? (['vertical','horizontal'].includes(type) ? drawing.a : null));
  if (!a || !b) return null;
  return { type, a, b };
}
export function normalizeDrawings(input, max = MAX_DRAWINGS) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const drawing = normalizeDrawing(raw);
    if (!drawing) continue;
    out.push(drawing);
    if (out.length === max) break;
  }
  return out;
}
export function makeDrawing(type, a, b = a) {
  return normalizeDrawing({ type, a, b });
}
export function fibonacciPrices(drawing) {
  const d = normalizeDrawing(drawing);
  if (!d || d.type !== 'fib') return [];
  return FIB_RATIOS.map((ratio) => ({
    ratio, price: d.a.price + (d.b.price - d.a.price) * ratio
  }));
}
export function drawingShapes(drawing, pointToPixel, bounds) {
  const d = normalizeDrawing(drawing);
  if (!d) return { lines: [], handles: [] };
  const pa = pointToPixel(d.a), pb = pointToPixel(d.b);
  const lines = [];
  const handles = [];
  if (d.type === 'line') {
    lines.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
    handles.push({ ...pa, part: 'a' }, { ...pb, part: 'b' });
  } else if (d.type === 'horizontal') {
    lines.push({ x1: bounds.left, y1: pa.y, x2: bounds.right, y2: pa.y });
    handles.push({ ...pa, part: 'a' });
  } else if (d.type === 'vertical') {
    lines.push({ x1: pa.x, y1: bounds.top, x2: pa.x, y2: bounds.bottom });
    handles.push({ ...pa, part: 'a' });
  } else if (d.type === 'fib') {
    for (const level of fibonacciPrices(d)) {
      const y = pa.y + (pb.y - pa.y) * level.ratio;
      lines.push({
        x1: Math.min(pa.x, pb.x), y1: y, x2: bounds.right, y2: y,
        label: String(Math.round(level.ratio * 1000) / 10) + '%',
        price: level.price, ratio: level.ratio
      });
    }
    handles.push({ ...pa, part: 'a' }, { ...pb, part: 'b' });
  }
  return { lines, handles };
}
export function distanceToSegment(px, py, line) {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const length2 = dx * dx + dy * dy;
  if (!Number.isFinite(length2)) return Infinity;
  const t = length2 ? Math.max(0, Math.min(1,
    ((px - line.x1) * dx + (py - line.y1) * dy) / length2)) : 0;
  return Math.hypot(px - (line.x1 + dx * t), py - (line.y1 + dy * t));
}
export function hitDrawing(drawing, pointToPixel, bounds, x, y, tolerance = 9) {
  const { lines, handles } = drawingShapes(drawing, pointToPixel, bounds);
  for (const handle of handles) {
    const distance = Math.hypot(x - handle.x, y - handle.y);
    if (distance <= tolerance) return { part: handle.part, distance };
  }
  let min = Infinity;
  for (const line of lines) min = Math.min(min, distanceToSegment(x, y, line));
  return min <= tolerance ? { part: 'body', distance: min } : null;
}
/** Returns the visually topmost (last inserted) selected drawing. */
export function pickDrawing(drawings, pointToPixel, bounds, x, y, tolerance = 9) {
  for (let index = drawings.length - 1; index >= 0; index--) {
    const hit = hitDrawing(drawings[index], pointToPixel, bounds, x, y, tolerance);
    if (hit) return { index, ...hit };
  }
  return null;
}

/** Translates a drawing on the chart, respecting vertical/horizontal semantics. */
export function moveDrawing(drawing, deltaTime, deltaPrice) {
  const d = normalizeDrawing(drawing);
  if (!d || !Number.isFinite(deltaTime) || !Number.isFinite(deltaPrice)) return null;
  const a = {
    time: d.type === 'horizontal' ? d.a.time : Math.max(0, d.a.time + deltaTime),
    price: d.type === 'vertical' ? d.a.price : Math.max(1e-12, d.a.price + deltaPrice)
  };
  const b = {
    time: d.type === 'horizontal' ? d.b.time : Math.max(0, d.b.time + deltaTime),
    price: d.type === 'vertical' ? d.b.price : Math.max(1e-12, d.b.price + deltaPrice)
  };
  return makeDrawing(d.type, a, b);
}
