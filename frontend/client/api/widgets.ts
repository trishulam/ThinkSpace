export type WidgetType = "graph" | "notation";

export interface GraphWidgetSpec {
  title: string;
  expression: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  x_label: string;
  y_label: string;
}

export interface NotationBlockSpec {
  latex: string;
  label: string;
}

export interface NotationWidgetSpec {
  title: string;
  blocks: NotationBlockSpec[];
  annotation: string;
}

export interface WidgetReasonerDebug {
  model: string;
  prompt_text: string;
  raw_response_text: string | null;
  raw_parsed_payload: Record<string, unknown> | null;
}

export interface WidgetReasonerResponse {
  widget_type: WidgetType;
  status: "completed";
  title: string;
  spec: GraphWidgetSpec | NotationWidgetSpec;
  debug: WidgetReasonerDebug;
}

function getApiBaseUrl(): string {
  const explicitBaseUrl = import.meta.env.VITE_SESSION_API_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  const wsBaseUrl = import.meta.env.VITE_AGENT_BACKEND_URL?.trim();
  if (wsBaseUrl) {
    if (wsBaseUrl.startsWith("wss://")) {
      return `https://${wsBaseUrl.slice("wss://".length)}`.replace(/\/$/, "");
    }
    if (wsBaseUrl.startsWith("ws://")) {
      return `http://${wsBaseUrl.slice("ws://".length)}`.replace(/\/$/, "");
    }
    return wsBaseUrl.replace(/\/$/, "");
  }

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://localhost:8000";
  }

  return window.location.origin;
}

export async function reasonWidget(
  widgetType: WidgetType,
  prompt: string,
): Promise<WidgetReasonerResponse> {
  const response = await fetch(`${getApiBaseUrl()}/v1/dev/widgets/reason`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      widget_type: widgetType,
      prompt,
    }),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        message = body.detail;
      }
    } catch {
      // Ignore parse failures.
    }
    throw new Error(message);
  }

  return (await response.json()) as WidgetReasonerResponse;
}
