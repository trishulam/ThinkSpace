import React from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
} from "tldraw";

import type {
  GraphWidgetSpec,
  NotationWidgetSpec,
} from "../../api/widgets";
import { GraphWidget } from "./GraphWidget";
import { NotationWidget } from "./NotationWidget";

export type ThinkspaceWidgetKind = "graph" | "notation";

export type ThinkspaceWidgetShape = TLBaseShape<
  "thinkspace-widget",
  {
    w: number;
    h: number;
    widgetKind: ThinkspaceWidgetKind;
    specJson: string;
  }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGraphWidgetSpec(value: unknown): value is GraphWidgetSpec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.expression === "string" &&
    typeof value.x_min === "number" &&
    typeof value.x_max === "number" &&
    typeof value.y_min === "number" &&
    typeof value.y_max === "number" &&
    typeof value.x_label === "string" &&
    typeof value.y_label === "string"
  );
}

function isNotationWidgetSpec(value: unknown): value is NotationWidgetSpec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (block) =>
        isRecord(block) &&
        typeof block.latex === "string" &&
        typeof block.label === "string",
    ) &&
    typeof value.annotation === "string"
  );
}

function parseWidgetSpec(shape: ThinkspaceWidgetShape) {
  try {
    return JSON.parse(shape.props.specJson) as unknown;
  } catch {
    return null;
  }
}

export class ThinkspaceWidgetShapeUtil extends ShapeUtil<any> {
  static override type = "thinkspace-widget" as const;

  static override props = {
    w: T.number,
    h: T.number,
    widgetKind: T.string,
    specJson: T.string,
  };

  override canEdit = () => false;

  override canBind = () => false;

  override canResize = () => false;

  override getDefaultProps(): ThinkspaceWidgetShape["props"] {
    return {
      w: 480,
      h: 320,
      widgetKind: "notation",
      specJson: "{}",
    };
  }

  override getGeometry(shape: any) {
    const widgetShape = shape as ThinkspaceWidgetShape;
    return new Rectangle2d({
      width: widgetShape.props.w,
      height: widgetShape.props.h,
      isFilled: true,
    });
  }

  override component(shape: any) {
    const widgetShape = shape as ThinkspaceWidgetShape;
    const spec = parseWidgetSpec(widgetShape);

    return (
      <HTMLContainer
        style={{
          width: widgetShape.props.w,
          height: widgetShape.props.h,
          overflow: "hidden",
        }}
      >
        {widgetShape.props.widgetKind === "graph" && isGraphWidgetSpec(spec) ? (
          <GraphWidget
            spec={spec}
            width={Math.max(280, Math.round(widgetShape.props.w - 16))}
            height={Math.max(220, Math.round(widgetShape.props.h - 54))}
          />
        ) : widgetShape.props.widgetKind === "notation" &&
          isNotationWidgetSpec(spec) ? (
          <NotationWidget spec={spec} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 18,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "#ffffff",
              color: "#64748b",
              fontSize: 13,
              textAlign: "center",
              padding: 16,
              boxSizing: "border-box",
            }}
          >
            Widget data could not be rendered.
          </div>
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: any) {
    const widgetShape = shape as ThinkspaceWidgetShape;
    return (
      <rect
        width={widgetShape.props.w}
        height={widgetShape.props.h}
        rx={18}
        ry={18}
      />
    );
  }
}

export const thinkspaceShapeUtils = [ThinkspaceWidgetShapeUtil];
