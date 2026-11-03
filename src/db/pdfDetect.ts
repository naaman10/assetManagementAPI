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
const MAX_VERTICES = 64;
const MIN_AREA = 0.0008;
const MAX_AREA = 0.55;
const MAX_BBOX_COVERAGE = 0.92;
const BEZIER_STEPS = 8;
const COLLINEAR_EPSILON = 1e-6;
const MIN_DOOR_GAP_DIAG = 0.002;
const MAX_DOOR_GAP_DIAG = 0.15;
const AXIS_ANGLE_TOL_DEG = 20;
const MIN_RECTANGULARITY = 0.25;
const MIN_AXIS_ALIGNED = 0.4;
const MAX_ASPECT = 12;
/** Fuzzy match threshold against location name/code (0–1). */
const MIN_FUZZY_SCORE = 0.72;
/** Max distance from label to a wall loop centroid, as a fraction of page diagonal. */
const MAX_LOOP_CENTROID_DIST = 0.2;
/** Ray length for wall search around a label when no loop contains it. */
const RAY_LENGTH_DIAG_FRAC = 0.35;

/** DrawOPS packed into constructPath path buffers (pdf.js). */
const DrawOPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

export type PdfDetectConfidence = "low" | "medium" | "high";

export type PdfDetectLocationHint = {
  id: string;
  name: string | null;
  locationCode: string | null;
  locationType: string | null;
};

export type PdfDetectCandidate = {
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  suggestedLabel: string | null;
  suggestedLocationId: string | null;
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
  closedExplicitly: boolean;
  doorGap: number | null;
};

type WallSegment = {
  a: Point;
  b: Point;
};

type PreparedLoop = {
  ring: Point[];
  areaAbs: number;
  areaNorm: number;
  centroid: Point;
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
  existingLocations: PdfDetectLocationHint[] = [],
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
    const pageDiagonal = Math.hypot(pageWidth, pageHeight);

    const { paths, segments, pathOpCount, imageOpCount } = await extractGeometry(
      page,
      pageDiagonal,
    );
    const texts = await extractTexts(page);

    if (pathOpCount === 0 && texts.length === 0) {
      if (imageOpCount > 0) {
        throw new PdfDetectError(
          "No vector text/paths found. This PDF looks image-only or scanned; vector room detection needs CAD-exported content.",
        );
      }
      throw new PdfDetectError("No vector content found on page 1.");
    }

    notes.push(
      "Detection matches PDF text to existing rooms/areas, then finds walls around each matched label.",
    );

    if (existingLocations.length === 0) {
      notes.push(
        "No existing rooms/areas under this floor — create locations first so labels can be matched.",
      );
      return {
        planId,
        contentType: "application/pdf",
        page: 1,
        pageCount,
        candidates: [],
        notes,
      };
    }

    const matches = fuzzyMatchTextsToLocations(texts, existingLocations);
    notes.push(
      `Matched ${matches.length} PDF label(s) to existing locations (from ${texts.length} text item(s), ${existingLocations.length} location(s)).`,
    );

    if (matches.length === 0) {
      notes.push(
        "No fuzzy text matches. Check that room names/codes on the PDF align with location name or locationCode.",
      );
      return {
        planId,
        contentType: "application/pdf",
        page: 1,
        pageCount,
        candidates: [],
        notes,
      };
    }

    const loops = prepareLoops(paths, pageWidth, pageHeight, pageArea);
    notes.push(`Prepared ${loops.length} wall loop(s); ${segments.length} wall segment(s) for ray search.`);

    const candidates: PdfDetectCandidate[] = [];
    let fromLoop = 0;
    let fromRays = 0;
    let noWalls = 0;

    for (const match of matches) {
      if (candidates.length >= MAX_CANDIDATES) {
        break;
      }

      const loop = findBestLoopAroundPoint(match.text, loops, pageDiagonal);
      let ringPdf: Point[] | null = loop?.ring ?? null;
      let source: "loop" | "rays" | null = loop ? "loop" : null;

      if (!ringPdf) {
        ringPdf = rectangleFromWallRays(match.text, segments, pageDiagonal);
        source = ringPdf ? "rays" : null;
      }

      if (!ringPdf) {
        noWalls += 1;
        continue;
      }

      const areaAbs = Math.abs(polygonArea(ringPdf));
      const areaNorm = areaAbs / pageArea;
      if (areaNorm < MIN_AREA || areaNorm > MAX_AREA) {
        noWalls += 1;
        continue;
      }

      const ringNorm = closeRing(ringPdf).map(([x, y]) =>
        normalizePoint(x, y, pageWidth, pageHeight),
      );

      if (source === "loop") {
        fromLoop += 1;
      } else {
        fromRays += 1;
      }

      candidates.push({
        geometry: {
          type: "Polygon",
          coordinates: [ringNorm],
        },
        suggestedLabel: match.matchedText,
        suggestedLocationId: match.location.id,
        confidence: confidenceForMatch(match.fuzzyScore, source === "loop"),
        pointCount: ringNorm.length - 1,
        area: Number(areaNorm.toFixed(6)),
        bbox: bboxOf(ringNorm),
      });
    }

    notes.push(
      `Walls found via loop=${fromLoop}, ray-box=${fromRays}, unmatched labels=${noWalls}.`,
    );

    if (candidates.length === 0) {
      notes.push(
        "Labels matched, but no enclosing walls were found nearby. The plan may draw walls in a way that is hard to join around text.",
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

function confidenceForMatch(fuzzyScore: number, fromLoop: boolean): PdfDetectConfidence {
  if (fuzzyScore >= 0.92 && fromLoop) {
    return "high";
  }
  if (fuzzyScore >= 0.8 || fromLoop) {
    return "medium";
  }
  return "low";
}

function fuzzyMatchTextsToLocations(texts: PageText[], locations: PdfDetectLocationHint[]) {
  type ScoredMatch = {
    text: PageText;
    location: PdfDetectLocationHint;
    fuzzyScore: number;
    matchedText: string;
  };

  const scored: ScoredMatch[] = [];

  for (const text of texts) {
    for (const location of locations) {
      const against = [location.locationCode, location.name].filter(
        (value): value is string => Boolean(value && value.trim()),
      );

      for (const target of against) {
        const score = fuzzyLabelScore(text.value, target);
        if (score >= MIN_FUZZY_SCORE) {
          scored.push({
            text,
            location,
            fuzzyScore: score,
            matchedText: text.value.trim(),
          });
        }
      }
    }
  }

  scored.sort((a, b) => b.fuzzyScore - a.fuzzyScore);

  const usedTexts = new Set<string>();
  const usedLocations = new Set<string>();
  const matches: ScoredMatch[] = [];

  for (const entry of scored) {
    const textKey = `${entry.text.x.toFixed(2)}:${entry.text.y.toFixed(2)}:${entry.text.value}`;
    if (usedTexts.has(textKey) || usedLocations.has(entry.location.id)) {
      continue;
    }
    usedTexts.add(textKey);
    usedLocations.add(entry.location.id);
    matches.push(entry);
  }

  return matches;
}

function fuzzyLabelScore(rawA: string, rawB: string) {
  const a = normalizeLabel(rawA);
  const b = normalizeLabel(rawB);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return 0.82 + 0.15 * (shorter / longer);
  }

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / maxLen);
}

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function levenshtein(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function prepareLoops(
  paths: RawPath[],
  pageWidth: number,
  pageHeight: number,
  pageArea: number,
): PreparedLoop[] {
  const loops: PreparedLoop[] = [];

  for (const path of paths) {
    const simplified = simplifyCollinear(path.points);
    if (simplified.length < MIN_VERTICES || simplified.length > MAX_VERTICES) {
      continue;
    }

    const areaAbs = Math.abs(polygonArea(simplified));
    const areaNorm = areaAbs / pageArea;
    if (areaNorm < MIN_AREA || areaNorm > MAX_AREA) {
      continue;
    }

    const pdfBbox = bboxOf(simplified);
    const bboxCoverage =
      ((pdfBbox.maxX - pdfBbox.minX) / pageWidth) *
      ((pdfBbox.maxY - pdfBbox.minY) / pageHeight);
    if (bboxCoverage >= MAX_BBOX_COVERAGE) {
      continue;
    }

    if (!passesSoftRoomShape(simplified)) {
      continue;
    }

    const ring = closeRing(simplified.slice(0, MAX_POINTS_PER_RING));
    loops.push({
      ring,
      areaAbs,
      areaNorm,
      centroid: polygonCentroid(ring),
    });
  }

  loops.sort((a, b) => a.areaAbs - b.areaAbs);
  return loops;
}

function passesSoftRoomShape(points: Point[]) {
  const areaAbs = Math.abs(polygonArea(points));
  const box = bboxOf(points);
  const bw = Math.max(box.maxX - box.minX, COLLINEAR_EPSILON);
  const bh = Math.max(box.maxY - box.minY, COLLINEAR_EPSILON);
  const rectangularity = Math.min(1, areaAbs / (bw * bh));
  const aspect = Math.max(bw / bh, bh / bw);
  const axisAligned = axisAlignedEdgeRatio(points);

  return (
    rectangularity >= MIN_RECTANGULARITY &&
    axisAligned >= MIN_AXIS_ALIGNED &&
    aspect <= MAX_ASPECT
  );
}

function findBestLoopAroundPoint(
  text: PageText,
  loops: PreparedLoop[],
  pageDiagonal: number,
): PreparedLoop | null {
  const point: Point = [text.x, text.y];
  const containing = loops.filter((loop) => pointInPolygon(point, loop.ring));

  if (containing.length > 0) {
    // Smallest enclosing room loop.
    return containing[0];
  }

  // Nearby loop by centroid if the label sits just outside (common with door/label placement).
  const maxDist = MAX_LOOP_CENTROID_DIST * pageDiagonal;
  let best: PreparedLoop | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const loop of loops) {
    const dist = Math.hypot(loop.centroid[0] - point[0], loop.centroid[1] - point[1]);
    if (dist <= maxDist && dist < bestDist && pointNearPolygon(point, loop.ring, maxDist * 0.25)) {
      best = loop;
      bestDist = dist;
    }
  }

  return best;
}

function pointNearPolygon(point: Point, ring: Point[], threshold: number) {
  if (pointInPolygon(point, ring)) {
    return true;
  }

  for (let i = 0; i < ring.length - 1; i++) {
    if (distanceToSegment(point, ring[i], ring[i + 1]) <= threshold) {
      return true;
    }
  }

  return false;
}

function rectangleFromWallRays(
  text: PageText,
  segments: WallSegment[],
  pageDiagonal: number,
): Point[] | null {
  if (segments.length === 0) {
    return null;
  }

  const origin: Point = [text.x, text.y];
  const rayLen = RAY_LENGTH_DIAG_FRAC * pageDiagonal;

  const left = nearestHit(origin, [-1, 0], segments, rayLen);
  const right = nearestHit(origin, [1, 0], segments, rayLen);
  const down = nearestHit(origin, [0, -1], segments, rayLen);
  const up = nearestHit(origin, [0, 1], segments, rayLen);

  if (left == null || right == null || down == null || up == null) {
    return null;
  }

  // Require hits on both sides so we don't invent huge open boxes.
  if (right - left < pageDiagonal * 0.01 || up - down < pageDiagonal * 0.01) {
    return null;
  }

  if (right - left > pageDiagonal * 0.5 || up - down > pageDiagonal * 0.5) {
    return null;
  }

  return [
    [left, down],
    [right, down],
    [right, up],
    [left, up],
  ];
}

function nearestHit(
  origin: Point,
  direction: Point,
  segments: WallSegment[],
  maxDist: number,
): number | null {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCoord: number | null = null;

  for (const segment of segments) {
    const hit = raySegmentIntersection(origin, direction, segment.a, segment.b, maxDist);
    if (hit == null || hit.distance >= bestDistance) {
      continue;
    }

    bestDistance = hit.distance;
    bestCoord = direction[0] !== 0 ? hit.point[0] : hit.point[1];
  }

  return bestCoord;
}

function raySegmentIntersection(
  origin: Point,
  direction: Point,
  a: Point,
  b: Point,
  maxDist: number,
): { point: Point; distance: number } | null {
  const dx = direction[0];
  const dy = direction[1];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const denom = dx * ey - dy * ex;

  if (Math.abs(denom) < COLLINEAR_EPSILON) {
    return null;
  }

  const qx = a[0] - origin[0];
  const qy = a[1] - origin[1];
  const t = (qx * ey - qy * ex) / denom;
  const u = (qx * dy - qy * dx) / denom;

  if (t < COLLINEAR_EPSILON || t > maxDist || u < 0 || u > 1) {
    return null;
  }

  return {
    point: [origin[0] + t * dx, origin[1] + t * dy],
    distance: t,
  };
}

async function extractGeometry(page: PDFPageProxy, pageDiagonal: number) {
  const opList = await page.getOperatorList();
  const paths: RawPath[] = [];
  const segments: WallSegment[] = [];
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
        const decoded = decodeDrawOps(buffer, ctm, pageDiagonal);
        paths.push(...decoded.paths);
        segments.push(...decoded.segments);
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

  return { paths, segments, pathOpCount, imageOpCount };
}

function decodeDrawOps(
  data: ArrayLike<number>,
  ctm: number[],
  pageDiagonal: number,
): { paths: RawPath[]; segments: WallSegment[] } {
  const paths: RawPath[] = [];
  const segments: WallSegment[] = [];
  let current: Point[] = [];
  let start: Point | null = null;
  let i = 0;

  const apply = (x: number, y: number): Point => applyTransformPoint(x, y, ctm);

  const pushSegment = (from: Point, to: Point) => {
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) > COLLINEAR_EPSILON) {
      segments.push({ a: from, b: to });
    }
  };

  const flushOpen = () => {
    if (current.length >= 2) {
      for (let idx = 0; idx < current.length - 1; idx++) {
        pushSegment(current[idx], current[idx + 1]);
      }
    }

    if (current.length < MIN_VERTICES || !start) {
      current = [];
      start = null;
      return;
    }

    const end = current[current.length - 1];
    const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const minGap = MIN_DOOR_GAP_DIAG * pageDiagonal;
    const maxGap = MAX_DOOR_GAP_DIAG * pageDiagonal;

    if (gap <= minGap) {
      paths.push({ points: current, closedExplicitly: true, doorGap: null });
    } else if (gap <= maxGap) {
      paths.push({ points: current, closedExplicitly: false, doorGap: gap });
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
        const next = apply(x, y);
        const prev = current[current.length - 1];
        if (prev) {
          pushSegment(prev, next);
        }
        current.push(next);
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
          const sampled = sampleCubic(p0, apply(x1, y1), apply(x2, y2), apply(x3, y3));
          for (const point of sampled) {
            const prev = current[current.length - 1];
            if (prev) {
              pushSegment(prev, point);
            }
            current.push(point);
          }
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
          const sampled = sampleQuadratic(p0, apply(x1, y1), apply(x2, y2));
          for (const point of sampled) {
            const prev = current[current.length - 1];
            if (prev) {
              pushSegment(prev, point);
            }
            current.push(point);
          }
        }
        break;
      }
      case DrawOPS.closePath: {
        if (current.length >= 2 && start) {
          pushSegment(current[current.length - 1], start);
        }
        if (current.length >= MIN_VERTICES) {
          paths.push({
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
        return { paths, segments };
    }
  }

  flushOpen();
  return { paths, segments };
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

function applyTransformPoint(x: number, y: number, m: number[]): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function normalizePoint(x: number, y: number, pageWidth: number, pageHeight: number): Point {
  return [clamp01(x / pageWidth), clamp01(1 - y / pageHeight)];
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

function polygonPerimeter(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
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

function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq < COLLINEAR_EPSILON) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }

  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj: Point = [a[0] + t * dx, a[1] + t * dy];
  return Math.hypot(point[0] - proj[0], point[1] - proj[1]);
}

function axisAlignedEdgeRatio(points: Point[]) {
  let aligned = 0;
  let total = 0;
  const tol = (AXIS_ANGLE_TOL_DEG * Math.PI) / 180;
  const perimeter = polygonPerimeter(points);
  const minSeg = Math.max(COLLINEAR_EPSILON, perimeter * 0.01);

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < minSeg) {
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
