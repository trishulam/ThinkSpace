import { Box, Editor, FileHelpers } from "tldraw";
import type { TldrawAgentApp } from "./agent/TldrawAgentApp";
import type { AgentCanvasLint } from "../shared/types/AgentCanvasLint";
import type { BlurryShape } from "../shared/format/BlurryShape";
import type { PeripheralShapeCluster } from "../shared/format/PeripheralShapesCluster";
import type { FocusedShape } from "../shared/format/FocusedShape";
import { convertTldrawShapeToBlurryShape } from "../shared/format/convertTldrawShapeToBlurryShape";
import { convertTldrawShapeToFocusedShape } from "../shared/format/convertTldrawShapeToFocusedShape";
import { convertTldrawShapesToPeripheralShapes } from "../shared/format/convertTldrawShapesToPeripheralShapes";

type BoxLike = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasPlacementHint =
  | "auto"
  | "viewport_right"
  | "viewport_left"
  | "viewport_top"
  | "viewport_bottom";

export type CanvasPlacementPlannerContext = {
  version: 1;
  captured_at: string;
  user_viewport_bounds: BoxLike;
  agent_viewport_bounds: BoxLike;
  screenshot_data_url: string;
  selected_shape_ids: string[];
  selected_shape_details: FocusedShape[];
  blurry_shapes: BlurryShape[];
  peripheral_clusters: PeripheralShapeCluster[];
  canvas_lints: AgentCanvasLint[];
};

function roundBox(box: BoxLike): BoxLike {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
  };
}

async function buildViewportScreenshot(
  editor: Editor,
  viewportBounds: BoxLike,
): Promise<string> {
  const viewportBox = Box.From(viewportBounds);
  const viewportShapes = editor.getCurrentPageShapesSorted().filter((shape) => {
    const bounds = editor.getShapeMaskedPageBounds(shape);
    if (!bounds) {
      return false;
    }
    return viewportBox.includes(bounds);
  });

  if (viewportShapes.length === 0) {
    return "";
  }

  const largestDimension = Math.max(viewportBounds.w, viewportBounds.h);
  const scale = largestDimension > 8000 ? 8000 / largestDimension : 1;
  const image = await editor.toImage(viewportShapes, {
    format: "jpeg",
    background: true,
    bounds: viewportBox,
    padding: 0,
    pixelRatio: 1,
    scale,
  });
  return FileHelpers.blobToDataUrl(image.blob);
}

export async function buildCanvasPlacementPlannerContext(
  editor: Editor,
  app: TldrawAgentApp | null,
): Promise<CanvasPlacementPlannerContext> {
  const userViewportBounds = roundBox(editor.getViewportPageBounds());
  const agentViewportBounds = userViewportBounds;
  const viewportBox = Box.From(userViewportBounds);
  const pageShapes = editor.getCurrentPageShapesSorted();
  const viewportShapes = pageShapes.filter((shape) => {
    const bounds = editor.getShapeMaskedPageBounds(shape);
    if (!bounds) {
      return false;
    }
    return viewportBox.includes(bounds);
  });
  const selectedShapes = editor.getSelectedShapes();
  const lints =
    app?.agents
      .getAgent()
      ?.lints.detectCanvasLints(viewportShapes) ?? [];

  return {
    version: 1,
    captured_at: new Date().toISOString(),
    user_viewport_bounds: userViewportBounds,
    agent_viewport_bounds: agentViewportBounds,
    screenshot_data_url: await buildViewportScreenshot(editor, userViewportBounds),
    selected_shape_ids: selectedShapes.map((shape) => shape.id.slice(6)),
    selected_shape_details: selectedShapes.map((shape) =>
      convertTldrawShapeToFocusedShape(editor, shape),
    ),
    blurry_shapes: viewportShapes
      .map((shape) => convertTldrawShapeToBlurryShape(editor, shape))
      .filter((shape): shape is BlurryShape => shape !== null),
    peripheral_clusters: convertTldrawShapesToPeripheralShapes(
      editor,
      pageShapes.filter((shape) => {
        const bounds = editor.getShapeMaskedPageBounds(shape);
        if (!bounds) {
          return false;
        }
        return !viewportBox.includes(bounds);
      }),
      { padding: 75 },
    ).map((cluster) => ({
      bounds: roundBox(cluster.bounds),
      numberOfShapes: cluster.numberOfShapes,
    })),
    canvas_lints: lints,
  };
}
