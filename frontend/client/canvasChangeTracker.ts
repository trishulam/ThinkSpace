import { Editor, TLRecord, TLShape, TLShapeId } from "tldraw";

import type { TldrawAgent } from "./agent/TldrawAgent";

export type CanvasChangeActor = "user" | "agent" | "system";
export type CanvasChangeEventType = "create" | "update" | "delete";

export type CanvasPrimitiveSummary = {
  shape_id: TLShapeId;
  shape_type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  note?: string;
  asset_id?: string;
  artifact_id?: string;
  title?: string;
  source_tool?: string;
  delegate_job_id?: string;
  created_at?: string;
};

export type CanvasChangeEvent = {
  event_type: CanvasChangeEventType;
  occurred_at: string;
  actor: CanvasChangeActor;
  source: string | null;
  shape_id: TLShapeId;
  shape_type: string;
  primitive: CanvasPrimitiveSummary;
  previous_primitive?: CanvasPrimitiveSummary;
  shape_meta: Record<string, unknown>;
};

type CanvasChangeTrackerOptions = {
  editor: Editor;
  getAgent?: () => TldrawAgent | null;
};

type CanvasChangeListener = (event: CanvasChangeEvent) => void;

function normalizeSource(source: unknown): string | null {
  return typeof source === "string" ? source : null;
}

function getShapeText(shape: TLShape): string | undefined {
  const props = shape.props as Record<string, unknown> | undefined;
  const directText = props?.text;
  if (typeof directText === "string" && directText.trim()) {
    return directText.trim();
  }

  const richText = props?.richText;
  if (typeof richText === "string" && richText.trim()) {
    return richText.trim();
  }

  const metaText = shape.meta.text;
  if (typeof metaText === "string" && metaText.trim()) {
    return metaText.trim();
  }

  return undefined;
}

function buildPrimitiveSummary(shape: TLShape): CanvasPrimitiveSummary {
  const props = shape.props as Record<string, unknown> | undefined;
  return {
    shape_id: shape.id,
    shape_type: shape.type,
    x: typeof shape.x === "number" ? shape.x : undefined,
    y: typeof shape.y === "number" ? shape.y : undefined,
    w: typeof props?.w === "number" ? props.w : undefined,
    h: typeof props?.h === "number" ? props.h : undefined,
    text: getShapeText(shape),
    note: typeof shape.meta.note === "string" ? shape.meta.note : undefined,
    asset_id: typeof props?.assetId === "string" ? props.assetId : undefined,
    artifact_id:
      typeof shape.meta.thinkspace_artifact_id === "string"
        ? shape.meta.thinkspace_artifact_id
        : typeof shape.meta.artifactId === "string"
          ? shape.meta.artifactId
        : undefined,
    title: typeof shape.meta.title === "string" ? shape.meta.title : undefined,
    source_tool:
      typeof shape.meta.thinkspace_source_tool === "string"
        ? shape.meta.thinkspace_source_tool
        : undefined,
    delegate_job_id:
      typeof shape.meta.thinkspace_delegate_job_id === "string"
        ? shape.meta.thinkspace_delegate_job_id
        : undefined,
    created_at:
      typeof shape.meta.thinkspace_created_at === "string"
        ? shape.meta.thinkspace_created_at
        : undefined,
  };
}

function cloneShapeMeta(shape: TLShape): Record<string, unknown> {
  return { ...shape.meta };
}

function classifyActor(
  shape: TLShape,
  source: unknown,
  getAgent?: () => TldrawAgent | null,
): CanvasChangeActor {
  if (shape.meta.thinkspace_actor === "agent") {
    return "agent";
  }

  const agent = getAgent?.() ?? null;
  if (agent?.getIsActingOnEditor()) {
    return "agent";
  }

  if (source === "user") {
    return "user";
  }

  return "system";
}

export class CanvasChangeTracker {
  private readonly editor: Editor;
  private readonly getAgent?: () => TldrawAgent | null;
  private readonly listeners = new Set<CanvasChangeListener>();
  private readonly events: CanvasChangeEvent[] = [];
  private stopRecordingFn: (() => void) | null = null;

  constructor({ editor, getAgent }: CanvasChangeTrackerOptions) {
    this.editor = editor;
    this.getAgent = getAgent;
  }

  start() {
    if (this.stopRecordingFn) {
      return this.stopRecordingFn;
    }

    const stopCreate = this.editor.sideEffects.registerAfterCreateHandler(
      "shape",
      (shape, source) => {
        this.pushEvent({
          event_type: "create",
          actor: classifyActor(shape, source, this.getAgent),
          source: normalizeSource(source),
          shape_id: shape.id,
          shape_type: shape.type,
          primitive: buildPrimitiveSummary(shape),
          shape_meta: cloneShapeMeta(shape),
        });
      },
    );

    const stopDelete = this.editor.sideEffects.registerAfterDeleteHandler(
      "shape",
      (shape, source) => {
        this.pushEvent({
          event_type: "delete",
          actor: classifyActor(shape, source, this.getAgent),
          source: normalizeSource(source),
          shape_id: shape.id,
          shape_type: shape.type,
          primitive: buildPrimitiveSummary(shape),
          shape_meta: cloneShapeMeta(shape),
        });
      },
    );

    const stopChange = this.editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (prev, next, source) => {
        this.pushEvent({
          event_type: "update",
          actor: classifyActor(next, source, this.getAgent),
          source: normalizeSource(source),
          shape_id: next.id,
          shape_type: next.type,
          primitive: buildPrimitiveSummary(next),
          previous_primitive: buildPrimitiveSummary(prev),
          shape_meta: cloneShapeMeta(next),
        });
      },
    );

    const stop = () => {
      stopCreate();
      stopDelete();
      stopChange();
      this.stopRecordingFn = null;
    };

    this.stopRecordingFn = stop;
    return stop;
  }

  stop() {
    this.stopRecordingFn?.();
  }

  getEvents(): CanvasChangeEvent[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }

  getEventsSince(startIndex: number): CanvasChangeEvent[] {
    if (startIndex <= 0) {
      return this.getEvents();
    }
    return this.events.slice(startIndex);
  }

  clearEvents() {
    this.events.length = 0;
  }

  onEvent(listener: CanvasChangeListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private pushEvent(
    event: Omit<CanvasChangeEvent, "occurred_at">,
  ): CanvasChangeEvent {
    const nextEvent: CanvasChangeEvent = {
      ...event,
      occurred_at: new Date().toISOString(),
    };

    this.events.push(nextEvent);
    for (const listener of this.listeners) {
      listener(nextEvent);
    }

    return nextEvent;
  }
}

export function isCanvasShapeRecord(record: TLRecord): record is TLShape {
  return record.typeName === "shape";
}
