import type { CanvasChangeActor, CanvasChangeEvent } from "./canvasChangeTracker";
import type { TLShapeId } from "tldraw";

export type CanvasActivityWindowCloseReason =
  | "inactivity"
  | "max_duration"
  | "manual"
  | "stop";

export type CanvasActivityWindowAggregateCounts = {
  total_events: number;
  create_count: number;
  update_count: number;
  delete_count: number;
  user_changes: number;
  agent_changes: number;
  system_changes: number;
};

export type CanvasActivityWindow = {
  id: string;
  started_at: string;
  last_change_at: string;
  closed_at: string;
  close_reason: CanvasActivityWindowCloseReason;
  events: CanvasChangeEvent[];
  changed_shape_ids: TLShapeId[];
  actor_counts: Record<CanvasChangeActor, number>;
  aggregate_counts: CanvasActivityWindowAggregateCounts;
};

export type CanvasActivityWindowManagerState = {
  collecting_window_id: string | null;
  ready_window_id: string | null;
  dispatching_window_id: string | null;
  is_dispatching: boolean;
};

type InternalWindow = {
  id: string;
  started_at: string;
  last_change_at: string;
  events: CanvasChangeEvent[];
};

type CanvasActivityWindowManagerOptions = {
  inactivityMs?: number;
  maxDurationMs?: number;
  onWindowReady?: (window: CanvasActivityWindow) => Promise<void> | void;
};

type CanvasChangeTrackerLike = {
  onEvent: (listener: (event: CanvasChangeEvent) => void) => () => void;
};

let nextWindowSequence = 0;

function createWindowId() {
  nextWindowSequence += 1;
  return `canvas-window-${Date.now()}-${nextWindowSequence}`;
}

function buildClosedWindow(
  window: InternalWindow,
  reason: CanvasActivityWindowCloseReason,
): CanvasActivityWindow {
  const changedShapeIds = new Set<TLShapeId>();
  const actorCounts: Record<CanvasChangeActor, number> = {
    user: 0,
    agent: 0,
    system: 0,
  };
  const aggregateCounts: CanvasActivityWindowAggregateCounts = {
    total_events: window.events.length,
    create_count: 0,
    update_count: 0,
    delete_count: 0,
    user_changes: 0,
    agent_changes: 0,
    system_changes: 0,
  };

  for (const event of window.events) {
    changedShapeIds.add(event.shape_id);
    actorCounts[event.actor] += 1;

    if (event.event_type === "create") {
      aggregateCounts.create_count += 1;
    } else if (event.event_type === "update") {
      aggregateCounts.update_count += 1;
    } else if (event.event_type === "delete") {
      aggregateCounts.delete_count += 1;
    }

    if (event.actor === "user") {
      aggregateCounts.user_changes += 1;
    } else if (event.actor === "agent") {
      aggregateCounts.agent_changes += 1;
    } else {
      aggregateCounts.system_changes += 1;
    }
  }

  return {
    id: window.id,
    started_at: window.started_at,
    last_change_at: window.last_change_at,
    closed_at: new Date().toISOString(),
    close_reason: reason,
    events: [...window.events],
    changed_shape_ids: [...changedShapeIds],
    actor_counts: actorCounts,
    aggregate_counts: aggregateCounts,
  };
}

function mergeClosedWindows(
  first: CanvasActivityWindow,
  second: CanvasActivityWindow,
): CanvasActivityWindow {
  const syntheticWindow: InternalWindow = {
    id: second.id,
    started_at: first.started_at,
    last_change_at: second.last_change_at,
    events: [...first.events, ...second.events],
  };

  return {
    ...buildClosedWindow(syntheticWindow, second.close_reason),
    id: second.id,
    closed_at: second.closed_at,
  };
}

export class CanvasActivityWindowManager {
  private readonly inactivityMs: number;
  private readonly maxDurationMs: number;
  private readonly onWindowReady?: (
    window: CanvasActivityWindow,
  ) => Promise<void> | void;
  private collectingWindow: InternalWindow | null = null;
  private readyWindow: CanvasActivityWindow | null = null;
  private dispatchingWindowId: string | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private stopListeningFn: (() => void) | null = null;
  private isDispatching = false;
  private externalHoldActive = false;
  private pendingHeldCloseReason: Extract<
    CanvasActivityWindowCloseReason,
    "inactivity" | "max_duration"
  > | null = null;

  constructor(
    private readonly tracker: CanvasChangeTrackerLike,
    {
      inactivityMs = 2000,
      maxDurationMs = 15000,
      onWindowReady,
    }: CanvasActivityWindowManagerOptions = {},
  ) {
    this.inactivityMs = inactivityMs;
    this.maxDurationMs = maxDurationMs;
    this.onWindowReady = onWindowReady;
  }

  start() {
    if (this.stopListeningFn) {
      return this.stopListeningFn;
    }

    this.stopListeningFn = this.tracker.onEvent((event) => {
      this.handleEvent(event);
    });

    return () => this.stop();
  }

  stop() {
    this.clearTimers();
    this.pendingHeldCloseReason = null;
    this.closeCollectingWindow("stop", { ignoreExternalHold: true });
    this.stopListeningFn?.();
    this.stopListeningFn = null;
  }

  flush(reason: CanvasActivityWindowCloseReason = "manual") {
    this.pendingHeldCloseReason = null;
    this.closeCollectingWindow(reason, { ignoreExternalHold: true });
  }

  setExternalHold(active: boolean) {
    this.externalHoldActive = active;
    if (active || !this.pendingHeldCloseReason) {
      return;
    }

    const pendingReason = this.pendingHeldCloseReason;
    this.pendingHeldCloseReason = null;
    this.closeCollectingWindow(pendingReason);
  }

  getState(): CanvasActivityWindowManagerState {
    return {
      collecting_window_id: this.collectingWindow?.id ?? null,
      ready_window_id: this.readyWindow?.id ?? null,
      dispatching_window_id: this.dispatchingWindowId,
      is_dispatching: this.isDispatching,
    };
  }

  private handleEvent(event: CanvasChangeEvent) {
    if (!this.collectingWindow) {
      this.collectingWindow = {
        id: createWindowId(),
        started_at: event.occurred_at,
        last_change_at: event.occurred_at,
        events: [event],
      };
      this.armMaxDurationTimer();
      this.armInactivityTimer();
      return;
    }

    this.collectingWindow.events.push(event);
    this.collectingWindow.last_change_at = event.occurred_at;
    if (this.pendingHeldCloseReason === "inactivity") {
      this.pendingHeldCloseReason = null;
    }
    this.armInactivityTimer();
  }

  private closeCollectingWindow(
    reason: CanvasActivityWindowCloseReason,
    { ignoreExternalHold = false }: { ignoreExternalHold?: boolean } = {},
  ) {
    if (!this.collectingWindow) {
      return;
    }

    if (
      !ignoreExternalHold &&
      this.externalHoldActive &&
      (reason === "inactivity" || reason === "max_duration")
    ) {
      this.pendingHeldCloseReason =
        this.pendingHeldCloseReason === "max_duration"
          ? "max_duration"
          : reason;
      return;
    }

    const closedWindow = buildClosedWindow(this.collectingWindow, reason);
    this.collectingWindow = null;
    this.pendingHeldCloseReason = null;
    this.clearTimers();

    if (this.isDispatching) {
      this.readyWindow = this.readyWindow
        ? mergeClosedWindows(this.readyWindow, closedWindow)
        : closedWindow;
      return;
    }

    this.dispatchWindow(closedWindow);
  }

  private dispatchWindow(window: CanvasActivityWindow) {
    this.isDispatching = true;
    this.dispatchingWindowId = window.id;

    Promise.resolve(this.onWindowReady?.(window))
      .catch((error) => {
        console.error("Canvas activity window dispatch failed", error);
      })
      .finally(() => {
        this.isDispatching = false;
        this.dispatchingWindowId = null;
        if (!this.readyWindow) {
          return;
        }
        const nextWindow = this.readyWindow;
        this.readyWindow = null;
        this.dispatchWindow(nextWindow);
      });
  }

  private armInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    this.inactivityTimer = setTimeout(() => {
      this.closeCollectingWindow("inactivity");
    }, this.inactivityMs);
  }

  private armMaxDurationTimer() {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
    }
    this.maxDurationTimer = setTimeout(() => {
      this.closeCollectingWindow("max_duration");
    }, this.maxDurationMs);
  }

  private clearTimers() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }
}
