import {
  OPS,
  Util,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_CANDIDATES = 200;
const MAX_POINTS_PER_RING = 200;
const MIN_VERTICES = 3;
const MAX_VERTICES = 32;
const MIN_AREA = 0.0005;
const MAX_AREA = 0.8;
const BEZIER_STEPS = 8;
const NEAREST_TEXT_THRESHOLD = 0.02;
const COLLINEAR_EPSILON = 1e-6;

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

type RawClosedPath = {
  points: Point[];
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

    const { closedPaths, pathOpCount, imageOpCount } = await extractClosedPaths(page);
    const texts = await extractTexts(page);

    if (pathOpCount === 0) {
      if (imageOpCount > 0) {
        throw new PdfDetectError(
          "No vector paths found. This PDF looks image-only or scanned; vector room detection needs CAD-exported paths.",
        );
      }
      throw new PdfDetectError("No vector paths found on page 1.");
    }

    if (closedPaths.length === 0) {
      notes.push("Vector paths were found, but none were closed polygons.");
    }

    const pageArea = pageWidth * pageHeight;
    const pageDiagonal = Math.hypot(pageWidth, pageHeight);
    const nearestThreshold = NEAREST_TEXT_THRESHOLD * pageDiagonal;

    const candidates: PdfDetectCandidate[] = [];
    let capped = false;

    for (const closed of closedPaths) {
      if (candidates.length >= MAX_CANDIDATES) {
        capped = true;
        break;
      }

      const simplified = simplifyCollinear(closed.points);
      if (simplified.length < MIN_VERTICES || simplified.length > MAX_VERTICES) {
        continue;
      }

      const areaAbs = Math.abs(polygonArea(simplified));
      const areaNorm = areaAbs / pageArea;
      if (areaNorm < MIN_AREA || areaNorm > MAX_AREA) {
        continue;
      }

      const ringPdf = closeRing(simplified.slice(0, MAX_POINTS_PER_RING));
      const ringNorm = ringPdf.map(([x, y]) => normalizePoint(x, y, pageWidth, pageHeight));
      const bbox = bboxOf(ringNorm);
      const label = suggestLabel(ringPdf, texts, nearestThreshold);

      candidates.push({
        geometry: {
          type: "Polygon",
          coordinates: [ringNorm],
        },
        suggestedLabel: label.value,
        confidence: label.confidence,
        pointCount: ringNorm.length - 1,
        area: Number(areaNorm.toFixed(6)),
        bbox,
      });
    }

    if (capped) {
      notes.push(`Candidate list capped at ${MAX_CANDIDATES}.`);
    }

    if (candidates.length === 0) {
      notes.push(
        "No room candidates passed size/vertex filters. The plan may use open walls, hatches, or complex path styles.",
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

async function extractClosedPaths(page: PDFPageProxy) {
  const opList = await page.getOperatorList();
  const closedPaths: RawClosedPath[] = [];
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
        for (const points of decodeDrawOps(buffer, ctm)) {
          closedPaths.push({ points });
        }
      }
      continue;
    }

    // Older / rare individual path ops.
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

  return { closedPaths, pathOpCount, imageOpCount };
}

function decodeDrawOps(data: ArrayLike<number>, ctm: number[]): Point[][] {
  const closed: Point[][] = [];
  let current: Point[] = [];
  let start: Point | null = null;
  let i = 0;

  const apply = (x: number, y: number): Point => applyTransformPoint(x, y, ctm);

  while (i < data.length) {
    const op = data[i++];

    switch (op) {
      case DrawOPS.moveTo: {
        if (current.length >= MIN_VERTICES) {
          // Unclosed leftover — ignore for room detection.
        }
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
          closed.push(current);
        }
        current = [];
        start = null;
        break;
      }
      default:
        // Unknown opcode — abort this buffer safely.
        return closed;
    }
  }

  return closed;
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
