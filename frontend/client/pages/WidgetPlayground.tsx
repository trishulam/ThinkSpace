import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  reasonWidget,
  type GraphWidgetSpec,
  type NotationWidgetSpec,
  type WidgetReasonerResponse,
  type WidgetType,
} from "../api/widgets";
import { GraphWidget } from "../components/widgets/GraphWidget";
import { NotationWidget } from "../components/widgets/NotationWidget";

const DEFAULT_PROMPTS: Record<WidgetType, string> = {
  graph: "Plot y = x^2 - 3x + 2 from x = -10 to 10 and label the axes.",
  notation:
    "Show the quadratic formula and a short two-step derivation as rendered notation.",
};

const WIDGET_OPTIONS: Array<{ id: WidgetType; label: string }> = [
  { id: "graph", label: "Graph" },
  { id: "notation", label: "Notation" },
];

export const WidgetPlayground: React.FC = () => {
  const [widgetType, setWidgetType] = useState<WidgetType>("graph");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPTS.graph);
  const [response, setResponse] = useState<WidgetReasonerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const rawJson = useMemo(
    () => (response ? JSON.stringify(response, null, 2) : ""),
    [response],
  );

  const handleWidgetTypeChange = (nextType: WidgetType) => {
    setWidgetType(nextType);
    setPrompt(DEFAULT_PROMPTS[nextType]);
    setResponse(null);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsLoading(true);
    setError(null);

    try {
      const nextResponse = await reasonWidget(widgetType, prompt);
      setResponse(nextResponse);
    } catch (requestError) {
      setResponse(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to reason about widget prompt",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, rgba(241,245,249,1) 0%, rgba(248,250,252,1) 100%)",
        color: "#0f172a",
      }}
    >
      <div
        style={{
          maxWidth: 1360,
          margin: "0 auto",
          padding: "32px 24px 48px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Widget Playground
            </p>
            <h1 style={{ margin: "8px 0 0", fontSize: 32 }}>
              Prompt to widget reasoner preview
            </h1>
            <p style={{ margin: "12px 0 0", color: "#475569", maxWidth: 760 }}>
              This page exercises the shared widget reasoner service directly before
              any canvas-tool integration. It validates prompt design, reasoner
                  config, and renderer behavior for graph and notation widgets.
            </p>
          </div>
          <Link
            to="/dashboard"
            style={{
              color: "#2563eb",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Back to dashboard
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(340px, 420px) minmax(0, 1fr)",
            gap: 24,
            alignItems: "start",
          }}
        >
          <section
            style={{
              borderRadius: 20,
              background: "#ffffff",
              border: "1px solid rgba(148, 163, 184, 0.25)",
              padding: 20,
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.06)",
            }}
          >
            <form onSubmit={handleSubmit}>
              <fieldset
                style={{
                  border: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                <legend
                  style={{
                    marginBottom: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#334155",
                  }}
                >
                  Widget type
                </legend>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 20,
                  }}
                >
                  {WIDGET_OPTIONS.map((option) => {
                    const active = option.id === widgetType;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleWidgetTypeChange(option.id)}
                        style={{
                          borderRadius: 999,
                          padding: "10px 14px",
                          border: active
                            ? "1px solid #2563eb"
                            : "1px solid rgba(148, 163, 184, 0.35)",
                          background: active ? "#dbeafe" : "#ffffff",
                          color: active ? "#1d4ed8" : "#334155",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <label
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#334155",
                  }}
                >
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={8}
                  style={{
                    width: "100%",
                    resize: "vertical",
                    borderRadius: 14,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    padding: 14,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#0f172a",
                    background: "#f8fafc",
                    boxSizing: "border-box",
                  }}
                />

                <button
                  type="submit"
                  disabled={isLoading || !prompt.trim()}
                  style={{
                    width: "100%",
                    marginTop: 18,
                    borderRadius: 14,
                    border: "none",
                    padding: "14px 16px",
                    background: isLoading ? "#94a3b8" : "#2563eb",
                    color: "#ffffff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: isLoading ? "progress" : "pointer",
                  }}
                >
                  {isLoading ? "Reasoning..." : "Generate widget spec"}
                </button>
              </fieldset>
            </form>

            {error ? (
              <div
                style={{
                  marginTop: 16,
                  borderRadius: 14,
                  background: "#fee2e2",
                  color: "#b91c1c",
                  padding: 14,
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            ) : null}
          </section>

          <section
            style={{
              display: "grid",
              gap: 24,
            }}
          >
            <div
              style={{
                borderRadius: 20,
                background: "#ffffff",
                border: "1px solid rgba(148, 163, 184, 0.25)",
                padding: 20,
                boxShadow: "0 20px 40px rgba(15, 23, 42, 0.06)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20 }}>Rendered preview</h2>
              <div style={{ marginTop: 18 }}>
                {!response ? (
                  <div
                    style={{
                      borderRadius: 16,
                      border: "1px dashed rgba(148, 163, 184, 0.45)",
                      padding: 24,
                      color: "#64748b",
                    }}
                  >
                    Submit a prompt to render a widget preview.
                  </div>
                ) : response.widget_type === "graph" ? (
                  <GraphWidget spec={response.spec as GraphWidgetSpec} />
                ) : (
                      <NotationWidget spec={response.spec as NotationWidgetSpec} />
                )}
              </div>
            </div>

            <div
              style={{
                borderRadius: 20,
                background: "#0f172a",
                color: "#e2e8f0",
                padding: 20,
                boxShadow: "0 20px 40px rgba(15, 23, 42, 0.14)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20 }}>Reasoner output</h2>
              <pre
                style={{
                  margin: "18px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                }}
              >
                {rawJson || "No response yet."}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
