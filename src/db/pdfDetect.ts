import {
  OPS,
  Util,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_CANDIDATES = 200;
const MAX_POINTS_PER_RING = 200;
const MIN_VERTICES = 4;
const MAX_VERTICES = 24;
/** Room footprints: ignore tiny symbols and near-full-page frames. */
const MIN_AREA = 0.005;
const MAX_AREA = 0.35;
/** Closed boxes without a door gap need to be larger (or labeled) to count as rooms. */
const MIN_CLOSED_UNLABELED_AREA = 0.015;
const BEZIER_STEPS = 8;
const NEAREST_TEXT_THRESHOLD = 0.02;
const COLLINEAR_EPSILON = 1e-6;
/** Door opening as a fraction of the room perimeter. */
const MIN_DOOR_GAP_FRAC = 0.01;
const MAX_DOOR_GAP_FRAC = 0.25;
/** Nearly-closed open paths: gap vs page diagonal (absolute door width band). */
const MIN_DOOR_GAP_DIAG = 0.004;
const MAX_DOOR_GAP_DIAG = 0.08;
const MIN_RECTANGULARITY = 0.55;
const MIN_AXIS_ALIGNED = 0.7;
const MAX_ASPECT = 6;
const MIN_ROOM_SCORE = 0.62;
const AXIS_ANGLE_TOL_DEG = 12;

/** DrawOPS packed into constructPath path buffers (pdf.js). */
const DrawOPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

export type PdfDetectConfidence = "low" | "medium" | "high";

export type PdfDetectCandidate = {
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  suggestedLabel: string | null;
  confidence: PdfDetectConfidence;
  pointCount: number;
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

export type PdfDetectSummary = {
  planId: string;
  contentType: "application/pdf";
  page: number;
  pageCount: number;
  candidates: PdfDetectCandidate[];
  notes: string[];
};

type Point = [number, number];

type PageText = {
  value: string;
  x: number;
  y: number;
};

type RawPath = {
  points: Point[];
  /** Explicit PDF closePath vs nearly-closed wall loop (door gap). */
  closedExplicitly: boolean;
  doorGap: number | null;
};

export class PdfDetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfDetectError";
  }
}

export async function detectRoomsFromPdfBytes(
  planId: string,
  bytes: Uint8Array,
): Promise<PdfDetectSummary> {
  const notes: string[] = [];
  let document: PDFDocumentProxy | null = null;
  let loadingTask: ReturnType<typeof getDocument> | null = null;

  try {
    loadingTask = getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    document = await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse PDF.";
    throw new PdfDetectError(message);
  }

  try {
    const pageCount = document.numPages;

    if (pageCount < 1) {
      throw new PdfDetectError("PDF has no pages.");
    }

    if (pageCount > 1) {
      notes.push(`PDF has ${pageCount} pages; only page 1 is analyzed.`);
    } else {
      notes.push("First page only.");
    }

    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    if (!(pageWidth > 0) || !(pageHeight > 0)) {
      throw new PdfDetectError("PDF page has an invalid size.");
    }

    const pageArea = pageWidth * pageHeight;
    const pageDiagonalLen = Math.hypot(pageWidth, pageHeight);
    const nearestThreshold = NEAREST_TEXT_THRESHOLD * pageDiagonalLen;

    const { paths, pathOpCount, imageOpCount } = await extractRoomPaths(page, pageDiagonalLen);
    const texts = await extractTexts(page);

    if (pathOpCount === 0) {
      if (imageOpCount > 0) {
        throw new PdfDetectError(
          "No vector paths found. This PDF looks image-only or scanned; vector room detection needs CAD-exported paths.",
        );
      }
      throw new PdfDetectError("No vector paths found on page 1.");
    }

    if (paths.length === 0) {
      notes.push(
        "Vector paths were found, but none looked like closed or nearly-closed wall loops (rooms with door gaps).",
      );
    }

    notes.push(
      "Candidates are filtered to axis-aligned, room-sized wall loops (including door openings).",
    );

    type Scored = PdfDetectCandidate & { score: number };
    const scored: Scored[] = [];
    let rejected = 0;

    for (const path of paths) {
      const simplified = simplifyCollinear(path.points);
      if (simplified.length < MIN_VERTICES || simplified.length > MAX_VERTICES) {
        rejected += 1;
        continue;
      }

      const areaAbs = Math.abs(polygonArea(simplified));
      const areaNorm = areaAbs / pageArea;
      if (areaNorm < MIN_AREA || areaNorm > MAX_AREA) {
        rejected += 1;
        continue;
      }

      const metrics = roomMetrics(simplified, path.doorGap, pageDiagonalLen);
      if (!metrics) {
        rejected += 1;
        continue;
      }

      const ringPdf = closeRing(simplified.slice(0, MAX_POINTS_PER_RING));
      const label = suggestLabel(ringPdf, texts, nearestThreshold);

      // Prefer wall loops with door openings; plain closed boxes need a label or more area.
      if (
        !metrics.hasDoorGap &&
        !label.value &&
        areaNorm < MIN_CLOSED_UNLABELED_AREA
      ) {
        rejected += 1;
        continue;
      }

      const score = roomScore(metrics, Boolean(label.value), path.closedExplicitly);

      if (score < MIN_ROOM_SCORE) {
        rejected += 1;
        continue;
      }

      const ringNorm = ringPdf.map(([x, y]) => normalizePoint(x, y, pageWidth, pageHeight));
      const confidence = refineConfidence(label.confidence, metrics, score);

      scored.push({
        geometry: {
          type: "Polygon",
          coordinates: [ringNorm],
        },
        suggestedLabel: label.value,
        confidence,
        pointCount: ringNorm.length - 1,
        area: Number(areaNorm.toFixed(6)),
        bbox: bboxOf(ringNorm),
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const candidates = dedupeOverlapping(scored)
      .slice(0, MAX_CANDIDATES)
      .map((entry) => ({
        geometry: entry.geometry,
        suggestedLabel: entry.suggestedLabel,
        confidence: entry.confidence,
        pointCount: entry.pointCount,
        area: entry.area,
        bbox: entry.bbox,
      }));

    if (scored.length > MAX_CANDIDATES) {
      notes.push(`Candidate list capped at ${MAX_CANDIDATES}.`);
    }

    if (rejected > 0) {
      notes.push(`Filtered out ${rejected} non-room-like shape(s) (furniture, frames, symbols, etc.).`);
    }

    if (candidates.length === 0) {
      notes.push(
        "No room candidates passed wall/door filters. The plan may use open wall networks, hatches, or non-axis-aligned outlines.",
      );
    }

    return {
      planId,
      contentType: "application/pdf",
      page: 1,
      pageCount,
      candidates,
      notes,
    };
  } finally {
    try {
      await loadingTask?.destroy();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function extractRoomPaths(page: PDFPageProxy, pageDiagonal: number) {
  const opList = await page.getOperatorList();
  const paths: RawPath[] = [];
  let pathOpCount = 0;
  let imageOpCount = 0;

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | null;

    if (fn === OPS.save) {
      stack.push(ctm.slice());
      continue;
    }

    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (fn === OPS.transform && args) {
      ctm = Util.transform(ctm, args as number[]);
      continue;
    }

    if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintImageMaskXObject
    ) {
      imageOpCount += 1;
      continue;
    }

    if (fn === OPS.constructPath && args && args.length >= 2) {
      pathOpCount += 1;
      const pathBuffers = args[1];
      const buffers = Array.isArray(pathBuffers) ? pathBuffers : [pathBuffers];

      for (const buffer of buffers) {
        if (!(buffer instanceof Float32Array)) {
          continue;
        }
        paths.push(...decodeDrawOps(buffer, ctm, pageDiagonal));
      }
      continue;
    }

    if (
      fn === OPS.moveTo ||
      fn === OPS.lineTo ||
      fn === OPS.curveTo ||
      fn === OPS.curveTo2 ||
      fn === OPS.curveTo3 ||
      fn === OPS.rectangle ||
      fn === OPS.closePath
    ) {
      pathOpCount += 1;
    }
  }

  return { paths, pathOpCount, imageOpCount };
}

function decodeDrawOps(data: ArrayLike<number>, ctm: number[], pageDiagonal: number): RawPath[] {
  const out: RawPath[] = [];
  let current: Point[] = [];
  let start: Point | null = null;
  let i = 0;

  const apply = (x: number, y: number): Point => applyTransformPoint(x, y, ctm);

  const flushOpen = () => {
    if (current.length < MIN_VERTICES || !start) {
      current = [];
      start = null;
      return;
    }

    const end = current[current.length - 1];
    const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const minGap = MIN_DOOR_GAP_DIAG * pageDiagonal;
    const maxGap = MAX_DOOR_GAP_DIAG * pageDiagonal;

    // Nearly-closed wall loop with a door-sized opening.
    if (gap >= minGap && gap <= maxGap) {
      out.push({ points: current, closedExplicitly: false, doorGap: gap });
    } else if (gap <= minGap) {
      // Effectively closed without closePath.
      out.push({ points: current, closedExplicitly: false, doorGap: null });
    }

    current = [];
    start = null;
  };

  while (i < data.length) {
    const op = data[i++];

    switch (op) {
      case DrawOPS.moveTo: {
        flushOpen();
        const x = data[i++];
        const y = data[i++];
        start = apply(x, y);
        current = [start];
        break;
      }
      case DrawOPS.lineTo: {
        const x = data[i++];
        const y = data[i++];
        current.push(apply(x, y));
        break;
      }
      case DrawOPS.curveTo: {
        const x1 = data[i++];
        const y1 = data[i++];
        const x2 = data[i++];
        const y2 = data[i++];
        const x3 = data[i++];
        const y3 = data[i++];
        const p0 = current[current.length - 1] ?? start;
        if (p0) {
          const c1 = apply(x1, y1);
          const c2 = apply(x2, y2);
          const c3 = apply(x3, y3);
          current.push(...sampleCubic(p0, c1, c2, c3));
        }
        break;
      }
      case DrawOPS.quadraticCurveTo: {
        const x1 = data[i++];
        const y1 = data[i++];
        const x2 = data[i++];
        const y2 = data[i++];
        const p0 = current[current.length - 1] ?? start;
        if (p0) {
          const c1 = apply(x1, y1);
          const c2 = apply(x2, y2);
          current.push(...sampleQuadratic(p0, c1, c2));
        }
        break;
      }
      case DrawOPS.closePath: {
        if (current.length >= MIN_VERTICES) {
          // Closed loops are kept only if they look like wall boxes; door bonus
          // comes from nearly-closed open paths (gap in the wall), not short edges.
          out.push({
            points: current,
            closedExplicitly: true,
            doorGap: null,
          });
        }
        current = [];
        start = null;
        break;
      }
      default:
        flushOpen();
        return out;
    }
  }

  flushOpen();
  return out;
}

type RoomMetrics = {
  rectangularity: number;
  axisAligned: number;
  aspect: number;
  hasDoorGap: boolean;
  doorGapFrac: number | null;
};

function roomMetrics(points: Point[], doorGap: number | null, pageDiagonal: number): RoomMetrics | null {
  const areaAbs = Math.abs(polygonArea(points));
  const bbox = bboxOf(points);
  const bw = Math.max(bbox.maxX - bbox.minX, COLLINEAR_EPSILON);
  const bh = Math.max(bbox.maxY - bbox.minY, COLLINEAR_EPSILON);
  const bboxArea = bw * bh;
  const rectangularity = Math.min(1, areaAbs / bboxArea);
  const aspect = Math.max(bw / bh, bh / bw);
  const axisAligned = axisAlignedEdgeRatio(points);
  const perimeter = polygonPerimeter(points);

  let hasDoorGap = false;
  let doorGapFrac: number | null = null;

  if (doorGap != null && perimeter > 0) {
    doorGapFrac = doorGap / perimeter;
    hasDoorGap =
      doorGapFrac >= MIN_DOOR_GAP_FRAC &&
      doorGapFrac <= MAX_DOOR_GAP_FRAC &&
      doorGap >= MIN_DOOR_GAP_DIAG * pageDiagonal &&
      doorGap <= MAX_DOOR_GAP_DIAG * pageDiagonal;
  }

  if (rectangularity < MIN_RECTANGULARITY) {
    return null;
  }

  if (axisAligned < MIN_AXIS_ALIGNED) {
    return null;
  }

  if (aspect > MAX_ASPECT) {
    return null;
  }

  return { rectangularity, axisAligned, aspect, hasDoorGap, doorGapFrac };
}

function roomScore(metrics: RoomMetrics, hasLabel: boolean, closedExplicitly: boolean) {
  let score = 0;
  score += 0.35 * metrics.rectangularity;
  score += 0.3 * metrics.axisAligned;
  score += 0.1 * Math.max(0, 1 - (metrics.aspect - 1) / (MAX_ASPECT - 1));

  if (metrics.hasDoorGap) {
    score += 0.18;
  } else if (closedExplicitly) {
    // Fully closed room outline without an obvious door gap — still valid but weaker.
    score += 0.08;
  }

  if (hasLabel) {
    score += 0.12;
  }

  return score;
}

function refineConfidence(
  labelConfidence: PdfDetectConfidence,
  metrics: RoomMetrics,
  score: number,
): PdfDetectConfidence {
  if (metrics.hasDoorGap && hasStrongRoomShape(metrics) && labelConfidence === "high") {
    return "high";
  }

  if (score >= 0.8 && labelConfidence !== "low") {
    return labelConfidence === "high" ? "high" : "medium";
  }

  if (metrics.hasDoorGap && hasStrongRoomShape(metrics)) {
    return labelConfidence === "low" ? "medium" : labelConfidence;
  }

  return labelConfidence;
}

function hasStrongRoomShape(metrics: RoomMetrics) {
  return metrics.rectangularity >= 0.7 && metrics.axisAligned >= 0.85;
}

function axisAlignedEdgeRatio(points: Point[]) {
  let aligned = 0;
  let total = 0;
  const tol = (AXIS_ANGLE_TOL_DEG * Math.PI) / 180;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < COLLINEAR_EPSILON) {
      continue;
    }

    total += len;
    const angle = Math.abs(Math.atan2(dy, dx));
    const toHoriz = Math.min(angle, Math.PI - angle);
    const toVert = Math.abs(angle - Math.PI / 2);
    if (toHoriz <= tol || toVert <= tol) {
      aligned += len;
    }
  }

  return total > 0 ? aligned / total : 0;
}

function polygonPerimeter(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

function dedupeOverlapping(candidates: Array<PdfDetectCandidate & { score: number }>) {
  const kept: Array<PdfDetectCandidate & { score: number }> = [];

  for (const candidate of candidates) {
    const overlaps = kept.some((existing) => bboxOverlapRatio(existing.bbox, candidate.bbox) >= 0.65);
    if (!overlaps) {
      kept.push(candidate);
    }
  }

  return kept;
}

function bboxOverlapRatio(
  a: PdfDetectCandidate["bbox"],
  b: PdfDetectCandidate["bbox"],
) {
  const xOverlap = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const yOverlap = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const intersection = xOverlap * yOverlap;
  if (intersection <= 0) {
    return 0;
  }

  const areaA = Math.max(COLLINEAR_EPSILON, (a.maxX - a.minX) * (a.maxY - a.minY));
  const areaB = Math.max(COLLINEAR_EPSILON, (b.maxX - b.minX) * (b.maxY - b.minY));
  return intersection / Math.min(areaA, areaB);
}

async function extractTexts(page: PDFPageProxy): Promise<PageText[]> {
  const content = await page.getTextContent();
  const texts: PageText[] = [];

  for (const item of content.items) {
    if (!("str" in item) || typeof item.str !== "string") {
      continue;
    }

    const value = item.str.trim();
    if (!value) {
      continue;
    }

    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) {
      continue;
    }

    texts.push({
      value: value.slice(0, 200),
      x: Number(transform[4]),
      y: Number(transform[5]),
    });
  }

  return texts;
}

function suggestLabel(
  ringPdf: Point[],
  texts: PageText[],
  nearestThreshold: number,
): { value: string | null; confidence: PdfDetectConfidence } {
  const inside = texts.filter((text) => pointInPolygon([text.x, text.y], ringPdf));

  if (inside.length === 1) {
    return { value: inside[0].value, confidence: "high" };
  }

  if (inside.length > 1) {
    const centroid = polygonCentroid(ringPdf);
    let best = inside[0];
    let bestDist = Number.POSITIVE_INFINITY;

    for (const text of inside) {
      const dist = Math.hypot(text.x - centroid[0], text.y - centroid[1]);
      if (dist < bestDist) {
        bestDist = dist;
        best = text;
      }
    }

    return { value: best.value, confidence: "medium" };
  }

  const centroid = polygonCentroid(ringPdf);
  let nearest: PageText | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;

  for (const text of texts) {
    const dist = Math.hypot(text.x - centroid[0], text.y - centroid[1]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = text;
    }
  }

  if (nearest && nearestDist <= nearestThreshold) {
    return { value: nearest.value, confidence: "medium" };
  }

  return { value: null, confidence: "low" };
}

function applyTransformPoint(x: number, y: number, m: number[]): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function normalizePoint(x: number, y: number, pageWidth: number, pageHeight: number): Point {
  return [
    clamp01(x / pageWidth),
    clamp01(1 - y / pageHeight),
  ];
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function closeRing(points: Point[]): Point[] {
  if (points.length === 0) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (first[0] === last[0] && first[1] === last[1]) {
    return points;
  }

  return [...points, first];
}

function simplifyCollinear(points: Point[]): Point[] {
  if (points.length <= 3) {
    return points;
  }

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    if (areCollinear(prev, curr, next)) {
      continue;
    }

    result.push(curr);
  }

  result.push(points[points.length - 1]);

  // Drop duplicate closing vertex before filters; closeRing adds it later.
  if (
    result.length > 1 &&
    result[0][0] === result[result.length - 1][0] &&
    result[0][1] === result[result.length - 1][1]
  ) {
    result.pop();
  }

  return result;
}

function areCollinear(a: Point, b: Point, c: Point) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(area) <= COLLINEAR_EPSILON;
}

function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function polygonCentroid(points: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  area /= 2;
  if (Math.abs(area) < COLLINEAR_EPSILON) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of points) {
      sx += x;
      sy += y;
    }
    return [sx / points.length, sy / points.length];
  }

  return [cx / (6 * area), cy / (6 * area)];
}

function bboxOf(points: Point[]) {
  let minX = points[0][0];
  let minY = points[0][1];
  let maxX = points[0][0];
  let maxY = points[0][1];

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

function pointInPolygon(point: Point, ring: Point[]) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const points: Point[] = [];
  for (let step = 1; step <= BEZIER_STEPS; step++) {
    const t = step / BEZIER_STEPS;
    const u = 1 - t;
    const x =
      u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1];
    points.push([x, y]);
  }
  return points;
}

function sampleQuadratic(p0: Point, p1: Point, p2: Point): Point[] {
  const points: Point[] = [];
  for (let step = 1; step <= BEZIER_STEPS; step++) {
    const t = step / BEZIER_STEPS;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    points.push([x, y]);
  }
  return points;
}
