export type CustomItem = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type CustomItemRef = {
  id: string;
  item_id: string;
  image_data_url: string;
  embedding: number[];
  created_at: string;
};

export type CustomItemWithRefs = CustomItem & {
  references: CustomItemRef[];
};

export type CustomItemDetection = {
  label: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  item_id: string;
  source: "custom";
  similarity: number;
};

export type CustomItemMatchCandidate = {
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  embedding: Float32Array;
};

const DEFAULT_EMBED_SIZE = 16;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function l2Normalize(values: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] * values[i];
  }
  if (sum <= 1e-12) {
    return values;
  }
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < values.length; i += 1) {
    values[i] *= inv;
  }
  return values;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toFloatEmbedding(values: number[]): Float32Array {
  const vector = new Float32Array(Math.min(values.length, 2048));
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = Number.isFinite(values[i]) ? values[i] : 0;
  }
  return l2Normalize(vector);
}

function confidenceFromSimilarity(similarity: number, threshold: number): number {
  if (similarity <= threshold) {
    return clamp(similarity, 0, 1);
  }
  const scaled = (similarity - threshold) / Math.max(1e-6, 1 - threshold);
  return clamp(0.35 + scaled * 0.64, 0, 0.99);
}

export function normalizeCustomItemLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 48);
}

export function computeImageEmbeddingFromImageData(
  imageData: ImageData,
  embedSize = DEFAULT_EMBED_SIZE,
): Float32Array {
  const target = Math.max(8, Math.min(32, Math.floor(embedSize)));
  const vectorLength = target * target + 6;
  const output = new Float32Array(vectorLength);
  const { width, height, data } = imageData;
  if (width <= 0 || height <= 0 || data.length === 0) {
    return output;
  }

  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let sqR = 0;
  let sqG = 0;
  let sqB = 0;
  const sampleCount = target * target;
  for (let y = 0; y < target; y += 1) {
    const sourceY = Math.floor((y / target) * height);
    for (let x = 0; x < target; x += 1) {
      const sourceX = Math.floor((x / target) * width);
      const index = (sourceY * width + sourceX) * 4;
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      output[y * target + x] = luma;
      meanR += r;
      meanG += g;
      meanB += b;
      sqR += r * r;
      sqG += g * g;
      sqB += b * b;
    }
  }

  meanR /= sampleCount;
  meanG /= sampleCount;
  meanB /= sampleCount;
  const stdR = Math.sqrt(Math.max(0, sqR / sampleCount - meanR * meanR));
  const stdG = Math.sqrt(Math.max(0, sqG / sampleCount - meanG * meanG));
  const stdB = Math.sqrt(Math.max(0, sqB / sampleCount - meanB * meanB));
  output[target * target + 0] = meanR;
  output[target * target + 1] = meanG;
  output[target * target + 2] = meanB;
  output[target * target + 3] = stdR;
  output[target * target + 4] = stdG;
  output[target * target + 5] = stdB;
  return l2Normalize(output);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA <= 1e-12 || magB <= 1e-12) {
    return 0;
  }
  return clamp(dot / Math.sqrt(magA * magB), -1, 1);
}

export function buildCustomMatchCandidates(
  frameWidth: number,
  frameHeight: number,
  objectBoxes: Array<{ bbox: { x: number; y: number; width: number; height: number } }>,
  maxCandidates = 30,
): Array<{ x: number; y: number; width: number; height: number }> {
  if (!isFiniteNumber(frameWidth) || !isFiniteNumber(frameHeight)) {
    return [];
  }
  const safeFrameWidth = Math.floor(frameWidth);
  const safeFrameHeight = Math.floor(frameHeight);
  if (safeFrameWidth < 8 || safeFrameHeight < 8) {
    return [];
  }

  const candidates: Array<{ x: number; y: number; width: number; height: number }> = [];
  const seen = new Set<string>();

  const push = (bbox: { x: number; y: number; width: number; height: number }) => {
    if (
      !isFiniteNumber(bbox.x) ||
      !isFiniteNumber(bbox.y) ||
      !isFiniteNumber(bbox.width) ||
      !isFiniteNumber(bbox.height)
    ) {
      return;
    }
    const x = clamp(Math.round(bbox.x), 0, safeFrameWidth - 1);
    const y = clamp(Math.round(bbox.y), 0, safeFrameHeight - 1);
    const width = clamp(Math.round(bbox.width), 1, safeFrameWidth - x);
    const height = clamp(Math.round(bbox.height), 1, safeFrameHeight - y);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return;
    }
    if (width < 8 || height < 8) {
      return;
    }
    const key = `${x}:${y}:${width}:${height}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ x, y, width, height });
  };

  for (const object of objectBoxes) {
    push(object.bbox);
    if (candidates.length >= maxCandidates) {
      return candidates;
    }
  }

  const cols = 3;
  const rows = 3;
  const cellWidth = Math.max(8, Math.floor(safeFrameWidth / cols));
  const cellHeight = Math.max(8, Math.floor(safeFrameHeight / rows));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      push({
        x: col * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
      if (candidates.length >= maxCandidates) {
        return candidates;
      }
    }
  }

  return candidates.slice(0, maxCandidates);
}

export function extractEmbeddingFromCanvasRegion(
  sourceCtx: CanvasRenderingContext2D,
  bbox: { x: number; y: number; width: number; height: number },
  options: {
    embedSize?: number;
    scratchCanvas?: HTMLCanvasElement;
    scratchCtx?: CanvasRenderingContext2D;
  } = {},
): Float32Array {
  if (
    !isFiniteNumber(bbox.x) ||
    !isFiniteNumber(bbox.y) ||
    !isFiniteNumber(bbox.width) ||
    !isFiniteNumber(bbox.height)
  ) {
    return new Float32Array(0);
  }
  const embedSize = options.embedSize ?? DEFAULT_EMBED_SIZE;
  const scratchCanvas = options.scratchCanvas ?? document.createElement("canvas");
  const scratchCtx = options.scratchCtx ?? scratchCanvas.getContext("2d");
  if (!scratchCtx) {
    return new Float32Array(0);
  }
  const width = Math.max(8, Math.floor(bbox.width));
  const height = Math.max(8, Math.floor(bbox.height));
  const sourceWidth = sourceCtx.canvas.width;
  const sourceHeight = sourceCtx.canvas.height;
  if (sourceWidth < 8 || sourceHeight < 8 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return new Float32Array(0);
  }
  const sx = clamp(Math.floor(bbox.x), 0, Math.max(0, sourceWidth - 1));
  const sy = clamp(Math.floor(bbox.y), 0, Math.max(0, sourceHeight - 1));
  const sw = clamp(width, 1, Math.max(1, sourceWidth - sx));
  const sh = clamp(height, 1, Math.max(1, sourceHeight - sy));
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sw) || !Number.isFinite(sh)) {
    return new Float32Array(0);
  }
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  try {
    scratchCtx.drawImage(sourceCtx.canvas, sx, sy, sw, sh, 0, 0, width, height);
    const imageData = scratchCtx.getImageData(0, 0, width, height);
    return computeImageEmbeddingFromImageData(imageData, embedSize);
  } catch {
    return new Float32Array(0);
  }
}

export function matchCustomItems(
  items: CustomItemWithRefs[],
  candidates: CustomItemMatchCandidate[],
  similarityThreshold = 0.35,
): {
  detections: CustomItemDetection[];
  bestSimilarity: number;
} {
  if (!items.length || !candidates.length) {
    return { detections: [], bestSimilarity: 0 };
  }

  const detections: CustomItemDetection[] = [];
  let bestSimilarity = 0;
  for (const item of items) {
    let itemBestSimilarity = 0;
    let itemBestCandidate: CustomItemMatchCandidate | null = null;
    for (const ref of item.references) {
      const referenceEmbedding = toFloatEmbedding(ref.embedding);
      if (referenceEmbedding.length === 0) {
        continue;
      }
      for (const candidate of candidates) {
        if (candidate.embedding.length !== referenceEmbedding.length) {
          continue;
        }
        const similarity = cosineSimilarity(referenceEmbedding, candidate.embedding);
        if (similarity > itemBestSimilarity) {
          itemBestSimilarity = similarity;
          itemBestCandidate = candidate;
        }
      }
    }
    bestSimilarity = Math.max(bestSimilarity, itemBestSimilarity);
    if (!itemBestCandidate || itemBestSimilarity < similarityThreshold) {
      continue;
    }
    detections.push({
      label: item.label,
      confidence: confidenceFromSimilarity(itemBestSimilarity, similarityThreshold),
      bbox: { ...itemBestCandidate.bbox },
      item_id: item.id,
      source: "custom",
      similarity: itemBestSimilarity,
    });
  }

  detections.sort((a, b) => b.confidence - a.confidence);
  return { detections, bestSimilarity };
}

export function parseCustomItemsPayload(payload: unknown): CustomItemWithRefs[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.items)) {
    return [];
  }
  const items: CustomItemWithRefs[] = [];
  for (const entry of root.items) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = typeof record.id === "string" ? record.id : "";
    const label =
      typeof record.label === "string" ? normalizeCustomItemLabel(record.label) : "";
    const createdAt = typeof record.created_at === "string" ? record.created_at : "";
    const updatedAt = typeof record.updated_at === "string" ? record.updated_at : "";
    if (!id || !label || !createdAt || !updatedAt) {
      continue;
    }
    const referencesRaw = Array.isArray(record.references) ? record.references : [];
    const references: CustomItemRef[] = [];
    for (const rawRef of referencesRaw) {
      const refRecord = asRecord(rawRef);
      if (!refRecord) {
        continue;
      }
      const refId = typeof refRecord.id === "string" ? refRecord.id : "";
      const itemId = typeof refRecord.item_id === "string" ? refRecord.item_id : "";
      const imageDataUrl =
        typeof refRecord.image_data_url === "string" ? refRecord.image_data_url : "";
      const created = typeof refRecord.created_at === "string" ? refRecord.created_at : "";
      const embedding = isNumberArray(refRecord.embedding) ? refRecord.embedding : [];
      if (!refId || !itemId || !created || embedding.length === 0) {
        continue;
      }
      references.push({
        id: refId,
        item_id: itemId,
        image_data_url: imageDataUrl,
        created_at: created,
        embedding,
      });
    }
    items.push({
      id,
      label,
      created_at: createdAt,
      updated_at: updatedAt,
      references,
    });
  }
  return items;
}

export async function fetchCustomItemsRegistry(
  signal?: AbortSignal,
): Promise<CustomItemWithRefs[]> {
  const response = await fetch("/api/custom-items", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseCustomItemsPayload(payload);
}

export async function createCustomItemApi(label: string): Promise<CustomItemWithRefs | null> {
  const response = await fetch("/api/custom-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  const items = parseCustomItemsPayload(payload);
  return items[0] ?? null;
}

export async function addCustomItemReferenceApi(input: {
  itemId: string;
  imageDataUrl: string;
  embedding: number[];
}): Promise<boolean> {
  const response = await fetch(`/api/custom-items/${encodeURIComponent(input.itemId)}/reference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: input.imageDataUrl,
      embedding: input.embedding,
    }),
  });
  return response.ok;
}

export async function deleteCustomItemApi(itemId: string): Promise<boolean> {
  const response = await fetch(`/api/custom-items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return response.ok;
}

export async function deleteCustomItemReferenceApi(
  itemId: string,
  refId: string,
): Promise<boolean> {
  const response = await fetch(
    `/api/custom-items/${encodeURIComponent(itemId)}/reference/${encodeURIComponent(refId)}`,
    {
      method: "DELETE",
    },
  );
  return response.ok;
}
