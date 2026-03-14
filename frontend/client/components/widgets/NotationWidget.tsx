import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import type { NotationWidgetSpec } from "../../api/widgets";

type NotationWidgetProps = {
  spec: NotationWidgetSpec;
  className?: string;
  style?: React.CSSProperties;
};

function renderBlockLatex(latex: string): string {
  return katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
  });
}

export const notationCardRootStyle: React.CSSProperties = {
  border: "1px solid rgba(100, 116, 139, 0.35)",
  borderRadius: 18,
  background: "#ffffff",
  padding: "20px 14px 18px",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.10)",
  boxSizing: "border-box",
  display: "inline-block",
};

type NotationCardContentProps = {
  spec: NotationWidgetSpec;
};

export const NotationCardContent: React.FC<NotationCardContentProps> = ({
  spec,
}) => {
  const renderedBlocks = useMemo(
    () =>
      spec.blocks.map((block) => ({
        label: block.label,
        html: renderBlockLatex(block.latex),
      })),
    [spec.blocks],
  );

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 14,
        }}
      >
        {renderedBlocks.map((block, index) => (
          <div
            key={`${block.label}-${index}`}
            style={{
              display: "grid",
              gap: block.label ? 8 : 0,
              justifyItems: "stretch",
            }}
          >
            {block.label ? (
              <p
                style={{
                  margin: 0,
                  color: "#475569",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                {block.label}
              </p>
            ) : null}
            <div
              style={{
                color: "#0f172a",
                width: "fit-content",
                maxWidth: "100%",
                margin: "0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            </div>
          </div>
        ))}
      </div>
      {spec.annotation ? (
        <p
          style={{
            margin: "14px 0 0",
            color: "#64748b",
            fontSize: 13,
            lineHeight: 1.55,
            textAlign: "center",
          }}
        >
          {spec.annotation}
        </p>
      ) : null}
      <p
        style={{
          margin: "10px 0 0",
          color: "#0f172a",
          fontSize: 12,
          textAlign: "center",
          fontWeight: 500,
          opacity: 0.72,
        }}
      >
        {spec.title}
      </p>
    </>
  );
};

export const NotationWidget: React.FC<NotationWidgetProps> = ({
  spec,
  className,
  style,
}) => {
  return (
    <div
      className={className}
      style={{
        ...notationCardRootStyle,
        ...style,
      }}
    >
      <NotationCardContent spec={spec} />
    </div>
  );
};
