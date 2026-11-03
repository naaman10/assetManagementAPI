import {
  DwgReader,
  LayerFlags,
  LwPolyline,
  MText,
  Polyline,
  TextEntity,
  type CadDocument,
} from "@node-projects/acad-ts";
import { PLAN_ACAD_CONTENT_TYPE } from "./locationPlanHelpers.js";

const MAX_CLOSED_POLYLINES = 200;
const MAX_TEXTS = 200;
const MAX_BLOCKS = 100;
const MAX_POINTS_PER_POLYLINE = 200;

export type CadInspectSummary = {
  planId: string;
  contentType: typeof PLAN_ACAD_CONTENT_TYPE;
  dwgVersion: string | null;
  layers: Array<{
    name: string;
    isOn?: boolean;
    isFrozen?: boolean;
    colorIndex?: number;
  }>;
  entityCounts: Record<string, number>;
  blocks: Array<{ name: string }>;
  texts: Array<{ layer: string; value: string; x: number; y: number }>;
  closedPolylines: Array<{
    layer: string;
    handle: string | null;
    pointCount: number;
    points: [number, number][];
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
  }>;
  notes: string[];
};

export function inspectDwgBytes(planId: string, bytes: Uint8Array): CadInspectSummary {
  const notes: string[] = [];
  const dwgVersion = readDwgVersionMarker(bytes);
  const warnings: string[] = [];

  const arrayBuffer = Uint8Array.from(bytes).buffer;
  let doc: CadDocument;

  try {
    doc = DwgReader.readFromStream(arrayBuffer, (_sender, event) => {
      if (event?.message) {
        warnings.push(String(event.message));
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse DWG.";
    throw new CadInspectError(message);
  }

  if (warnings.length > 0) {
    notes.push(`Parser reported ${warnings.length} warning(s).`);
    notes.push(...warnings.slice(0, 20));
  }

  const layers: CadInspectSummary["layers"] = [];
  if (doc.layers) {
    for (const layer of doc.layers) {
      layers.push({
        name: layer.name,
        isOn: layer.isOn,
        isFrozen: (layer.layerFlags & LayerFlags.Frozen) === LayerFlags.Frozen,
        colorIndex: layer.color?.index,
      });
    }
  }

  const blocks: CadInspectSummary["blocks"] = [];
  if (doc.blockRecords) {
    for (const record of doc.blockRecords) {
      const name = record.name;
      if (!name || name.startsWith("*")) {
        continue;
      }
      if (blocks.length >= MAX_BLOCKS) {
        notes.push(`Block list capped at ${MAX_BLOCKS}.`);
        break;
      }
      blocks.push({ name });
    }
  }

  const entityCounts: Record<string, number> = {};
  const texts: CadInspectSummary["texts"] = [];
  const closedPolylines: CadInspectSummary["closedPolylines"] = [];
  let textsCapped = false;
  let polylinesCapped = false;

  const entities = doc.modelSpace?.entities;
  if (!entities) {
    notes.push("No model-space entities found.");
  } else {
    for (const entity of entities) {
      const typeName = entity.constructor?.name || entity.objectName || "Unknown";
      entityCounts[typeName] = (entityCounts[typeName] ?? 0) + 1;

      if (entity instanceof TextEntity || entity instanceof MText) {
        if (texts.length >= MAX_TEXTS) {
          textsCapped = true;
          continue;
        }
        const value = (entity.value ?? "").trim();
        if (!value) {
          continue;
        }
        texts.push({
          layer: entity.layer?.name ?? "",
          value: value.slice(0, 500),
          x: Number(entity.insertPoint?.x ?? 0),
          y: Number(entity.insertPoint?.y ?? 0),
        });
        continue;
      }

      if (entity instanceof LwPolyline || entity instanceof Polyline) {
        if (!entity.isClosed) {
          continue;
        }
        if (closedPolylines.length >= MAX_CLOSED_POLYLINES) {
          polylinesCapped = true;
          continue;
        }

        const summarized = summarizeClosedPolyline(entity);
        if (summarized) {
          closedPolylines.push(summarized);
        }
      }
    }
  }

  if (textsCapped) {
    notes.push(`Text list capped at ${MAX_TEXTS}.`);
  }
  if (polylinesCapped) {
    notes.push(`Closed polyline list capped at ${MAX_CLOSED_POLYLINES}.`);
  }

  return {
    planId,
    contentType: PLAN_ACAD_CONTENT_TYPE,
    dwgVersion,
    layers,
    entityCounts,
    blocks,
    texts,
    closedPolylines,
    notes,
  };
}

export class CadInspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadInspectError";
  }
}

function summarizeClosedPolyline(entity: LwPolyline | Polyline) {
  const points3d = entity.getPoints?.() ?? [];
  const points: [number, number][] = [];

  for (const point of points3d) {
    if (points.length >= MAX_POINTS_PER_POLYLINE) {
      break;
    }
    points.push([Number(point.x), Number(point.y)]);
  }

  if (points.length < 3) {
    return null;
  }

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

  return {
    layer: entity.layer?.name ?? "",
    handle: entity.handle != null ? String(entity.handle) : null,
    pointCount: points3d.length,
    points,
    bbox: { minX, minY, maxX, maxY },
  };
}

function readDwgVersionMarker(bytes: Uint8Array) {
  if (bytes.length < 6) {
    return null;
  }

  const marker = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return /^AC\d{4}$/.test(marker) ? marker : null;
}
