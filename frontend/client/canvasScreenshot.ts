import { Box, Editor, FileHelpers, TLShapeId } from "tldraw";

type BoxLike = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasScreenshotPayload = {
  base64: string;
  mimeType: string;
};

function expandBounds(bounds: BoxLike, padding: number): BoxLike {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function extractBase64FromDataUrl(dataUrl: string): string | null {
  const parts = dataUrl.split(",", 2);
  if (parts.length !== 2) {
    return null;
  }
  return parts[1] ?? null;
}

async function captureShapesInBounds(
  editor: Editor,
  shapeIds: TLShapeId[],
  bounds: BoxLike,
): Promise<CanvasScreenshotPayload | null> {
  const shapeSet = new Set(shapeIds);
  const shapes = editor
    .getCurrentPageShapesSorted()
    .filter((shape) => shapeSet.has(shape.id));

  if (shapes.length === 0) {
    return null;
  }

  const captureBox = Box.From(bounds);
  const largestDimension = Math.max(bounds.w, bounds.h);
  const scale = largestDimension > 8000 ? 8000 / largestDimension : 1;
  const image = await editor.toImage(shapes, {
    format: "jpeg",
    background: true,
    bounds: captureBox,
    padding: 0,
    pixelRatio: 1,
    scale,
  });
  const dataUrl = await FileHelpers.blobToDataUrl(image.blob);
  const base64 = extractBase64FromDataUrl(dataUrl);
  if (!base64) {
    return null;
  }

  return {
    base64,
    mimeType: image.blob.type || "image/jpeg",
  };
}

export async function captureCanvasScreenshotForBounds(
  editor: Editor,
  bounds: BoxLike,
  shapeIds: TLShapeId[],
  padding = 24,
): Promise<CanvasScreenshotPayload | null> {
  if (bounds.w <= 0 || bounds.h <= 0 || shapeIds.length === 0) {
    return null;
  }

  return captureShapesInBounds(editor, shapeIds, expandBounds(bounds, padding));
}

export async function captureCanvasScreenshotForShapeIds(
  editor: Editor,
  shapeIds: TLShapeId[],
  padding = 24,
): Promise<CanvasScreenshotPayload | null> {
  const boundsList = shapeIds
    .map((shapeId) => editor.getShape(shapeId))
    .filter((shape): shape is NonNullable<typeof shape> => shape !== undefined)
    .map((shape) => editor.getShapeMaskedPageBounds(shape))
    .filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== undefined);

  if (boundsList.length === 0) {
    return null;
  }

  const union = Box.Common(boundsList);
  return captureShapesInBounds(
    editor,
    shapeIds,
    expandBounds(
      {
        x: union.x,
        y: union.y,
        w: union.w,
        h: union.h,
      },
      padding,
    ),
  );
}
