import React, { useEffect, useMemo, useRef, useState } from "react";
import functionPlot from "function-plot";

import type { GraphWidgetSpec } from "../../api/widgets";

type GraphWidgetProps = {
  spec: GraphWidgetSpec;
  width?: number;
  height?: number;
};

export const GraphWidget: React.FC<GraphWidgetProps> = ({
  spec,
  width = 640,
  height = 420,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const graphId = useMemo(
    () => `graph-widget-${Math.random().toString(36).slice(2)}`,
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.innerHTML = "";
    setRenderError(null);

    try {
      functionPlot({
        target: `#${graphId}`,
        width,
        height,
        grid: true,
        disableZoom: true,
        xAxis: {
          label: spec.x_label,
          domain: [spec.x_min, spec.x_max],
        },
        yAxis: {
          label: spec.y_label,
          domain: [spec.y_min, spec.y_max],
        },
        data: [
          {
            fn: spec.expression,
          },
        ],
      });
    } catch (error) {
      setRenderError(
        error instanceof Error ? error.message : "Unable to render graph widget",
      );
    }
  }, [
    graphId,
    height,
    spec.expression,
    spec.x_label,
    spec.x_max,
    spec.x_min,
    spec.y_label,
    spec.y_max,
    spec.y_min,
    width,
  ]);

  return (
    <div
      style={{
        border: "1px solid rgba(100, 116, 139, 0.35)",
        borderRadius: 18,
        background: "#ffffff",
        overflow: "hidden",
        boxShadow: "0 16px 36px rgba(15, 23, 42, 0.10)",
      }}
    >
      <div
        style={{
          height: 42,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 100%)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 500,
            color: "#334155",
          }}
        >
          {spec.title}
        </h3>
      </div>
      <div
        id={graphId}
        ref={containerRef}
        style={{
          padding: "8px 8px 12px",
          minHeight: height,
          overflow: "hidden",
        }}
      />
      {renderError ? (
        <p style={{ margin: "0 10px 12px", color: "#b91c1c", fontSize: 13 }}>
          {renderError}
        </p>
      ) : null}
    </div>
  );
};
