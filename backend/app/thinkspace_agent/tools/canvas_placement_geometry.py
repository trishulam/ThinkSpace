"""Shared geometry preprocessing for canvas placement planners."""

from __future__ import annotations

import json
import time
from typing import TypedDict


MIN_FREE_RECT_EDGE = 48.0
OCCUPIED_RECT_PADDING = 24.0
MAX_FREE_RECTS = 8


class Rect(TypedDict):
    x: float
    y: float
    w: float
    h: float


def _coerce_rect(candidate: object) -> Rect | None:
    if not isinstance(candidate, dict):
        return None
    try:
        x = float(candidate.get("x"))
        y = float(candidate.get("y"))
        w = float(candidate.get("w"))
        h = float(candidate.get("h"))
    except (TypeError, ValueError):
        return None

    if w <= 0 or h <= 0:
        return None

    return {"x": x, "y": y, "w": w, "h": h}


def _round_rect(rect: Rect) -> dict[str, int]:
    return {
        "x": round(rect["x"]),
        "y": round(rect["y"]),
        "w": round(rect["w"]),
        "h": round(rect["h"]),
    }


def _rect_area(rect: Rect) -> float:
    return rect["w"] * rect["h"]


def _rect_right(rect: Rect) -> float:
    return rect["x"] + rect["w"]


def _rect_bottom(rect: Rect) -> float:
    return rect["y"] + rect["h"]


def _rects_overlap(a: Rect, b: Rect) -> bool:
    return not (
        _rect_right(a) <= b["x"]
        or _rect_right(b) <= a["x"]
        or _rect_bottom(a) <= b["y"]
        or _rect_bottom(b) <= a["y"]
    )


def _inflate_and_clip_rect(
    rect: Rect,
    *,
    viewport: Rect,
    padding: float,
) -> Rect | None:
    x1 = max(viewport["x"], rect["x"] - padding)
    y1 = max(viewport["y"], rect["y"] - padding)
    x2 = min(_rect_right(viewport), _rect_right(rect) + padding)
    y2 = min(_rect_bottom(viewport), _rect_bottom(rect) + padding)
    if x2 <= x1 or y2 <= y1:
        return None
    return {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}


def _merge_rect_pair(a: Rect, b: Rect) -> Rect:
    x1 = min(a["x"], b["x"])
    y1 = min(a["y"], b["y"])
    x2 = max(_rect_right(a), _rect_right(b))
    y2 = max(_rect_bottom(a), _rect_bottom(b))
    return {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}


def _merge_overlapping_rects(rects: list[Rect]) -> list[Rect]:
    merged = list(rects)
    changed = True
    while changed:
        changed = False
        next_rects: list[Rect] = []
        while merged:
            current = merged.pop()
            merged_any = False
            for index, other in enumerate(merged):
                if _rects_overlap(current, other):
                    current = _merge_rect_pair(current, other)
                    merged.pop(index)
                    merged.append(current)
                    merged_any = True
                    changed = True
                    break
            if not merged_any:
                next_rects.append(current)
        merged = next_rects
    merged.sort(key=lambda rect: (rect["y"], rect["x"], rect["w"], rect["h"]))
    return merged


def _build_cut_coordinates(viewport: Rect, rects: list[Rect], axis: str) -> list[float]:
    coords = {viewport[axis], viewport[axis] + viewport["w" if axis == "x" else "h"]}
    size_key = "w" if axis == "x" else "h"
    for rect in rects:
        coords.add(rect[axis])
        coords.add(rect[axis] + rect[size_key])
    return sorted(coords)


def _build_blocked_grid(
    *,
    viewport: Rect,
    occupied_rects: list[Rect],
) -> tuple[list[float], list[float], list[list[bool]]]:
    xs = _build_cut_coordinates(viewport, occupied_rects, "x")
    ys = _build_cut_coordinates(viewport, occupied_rects, "y")
    cols = max(0, len(xs) - 1)
    rows = max(0, len(ys) - 1)
    blocked = [[False for _ in range(cols)] for _ in range(rows)]

    for row in range(rows):
        cell_y = ys[row]
        cell_h = ys[row + 1] - ys[row]
        for col in range(cols):
            cell: Rect = {
                "x": xs[col],
                "y": cell_y,
                "w": xs[col + 1] - xs[col],
                "h": cell_h,
            }
            blocked[row][col] = any(_rects_overlap(cell, rect) for rect in occupied_rects)

    return xs, ys, blocked


def _enumerate_free_rects(
    *,
    viewport: Rect,
    occupied_rects: list[Rect],
) -> list[Rect]:
    if not occupied_rects:
        return [viewport]

    xs, ys, blocked = _build_blocked_grid(
        viewport=viewport,
        occupied_rects=occupied_rects,
    )
    rows = len(blocked)
    cols = len(blocked[0]) if rows else 0
    candidates: list[Rect] = []

    for top in range(rows):
        free_cols = [not blocked[top][col] for col in range(cols)]
        for bottom in range(top, rows):
            if bottom > top:
                for col in range(cols):
                    free_cols[col] = free_cols[col] and not blocked[bottom][col]

            start_col: int | None = None
            for col in range(cols + 1):
                is_free = col < cols and free_cols[col]
                if is_free and start_col is None:
                    start_col = col
                    continue
                if is_free or start_col is None:
                    continue

                rect: Rect = {
                    "x": xs[start_col],
                    "y": ys[top],
                    "w": xs[col] - xs[start_col],
                    "h": ys[bottom + 1] - ys[top],
                }
                if rect["w"] >= MIN_FREE_RECT_EDGE and rect["h"] >= MIN_FREE_RECT_EDGE:
                    candidates.append(rect)
                start_col = None

    if not candidates:
        return [viewport]

    return candidates


def _rect_contains(container: Rect, rect: Rect) -> bool:
    return (
        container["x"] <= rect["x"]
        and container["y"] <= rect["y"]
        and _rect_right(container) >= _rect_right(rect)
        and _rect_bottom(container) >= _rect_bottom(rect)
    )


def _rank_and_trim_free_rects(
    rects: list[Rect],
    *,
    desired_w: float,
    desired_h: float,
    max_items: int,
) -> list[Rect]:
    sorted_rects = sorted(
        rects,
        key=lambda rect: (
            rect["w"] >= desired_w and rect["h"] >= desired_h,
            _rect_area(rect),
            min(rect["w"], rect["h"]),
        ),
        reverse=True,
    )

    trimmed: list[Rect] = []
    for rect in sorted_rects:
        if any(_rect_contains(existing, rect) for existing in trimmed):
            continue
        trimmed.append(rect)
        if len(trimmed) >= max_items:
            break
    return trimmed


def build_compact_placement_payload(
    *,
    context: dict[str, object] | None,
    viewport_bounds: dict[str, float],
    desired_w: float,
    desired_h: float,
    occupied_padding: float = OCCUPIED_RECT_PADDING,
    max_free_rects: int = MAX_FREE_RECTS,
) -> tuple[dict[str, object], dict[str, object]]:
    """Build a compact occupied/free-area payload for LLM placement planning."""

    started_perf = time.perf_counter()
    viewport: Rect = {
        "x": float(viewport_bounds["x"]),
        "y": float(viewport_bounds["y"]),
        "w": float(viewport_bounds["w"]),
        "h": float(viewport_bounds["h"]),
    }

    raw_occupied: list[Rect] = []
    blurry_shapes = context.get("blurry_shapes") if isinstance(context, dict) else None
    if isinstance(blurry_shapes, list):
        for shape in blurry_shapes:
            rect = _coerce_rect(shape)
            if rect is not None:
                raw_occupied.append(rect)

    padded_occupied = [
        clipped
        for rect in raw_occupied
        if (clipped := _inflate_and_clip_rect(rect, viewport=viewport, padding=occupied_padding))
        is not None
    ]
    merged_occupied = _merge_overlapping_rects(padded_occupied)
    free_rect_candidates = _enumerate_free_rects(
        viewport=viewport,
        occupied_rects=merged_occupied,
    )
    free_rects = _rank_and_trim_free_rects(
        free_rect_candidates,
        desired_w=desired_w,
        desired_h=desired_h,
        max_items=max_free_rects,
    )

    payload: dict[str, object] = {
        "viewport_bounds": _round_rect(viewport),
        "desired_size": {
            "w": round(desired_w),
            "h": round(desired_h),
        },
        "occupied_rects": [_round_rect(rect) for rect in merged_occupied],
        "free_rects": [_round_rect(rect) for rect in free_rects],
    }
    payload_json = json.dumps(payload, ensure_ascii=True)
    prep_trace = {
        "duration_ms": max(0, int((time.perf_counter() - started_perf) * 1000)),
        "raw_occupied_rect_count": len(raw_occupied),
        "merged_occupied_rect_count": len(merged_occupied),
        "free_rect_candidate_count": len(free_rect_candidates),
        "returned_free_rect_count": len(free_rects),
        "planner_payload_char_count": len(payload_json),
        "occupied_padding": occupied_padding,
    }
    return payload, prep_trace


def _load_rects_from_payload(payload: dict[str, object], key: str) -> list[Rect]:
    raw_rects = payload.get(key)
    if not isinstance(raw_rects, list):
        return []
    rects: list[Rect] = []
    for raw_rect in raw_rects:
        rect = _coerce_rect(raw_rect)
        if rect is not None:
            rects.append(rect)
    return rects


def _distance_sq_to_rect(x: float, y: float, rect: Rect) -> float:
    dx = 0.0
    if x < rect["x"]:
        dx = rect["x"] - x
    elif x > _rect_right(rect):
        dx = x - _rect_right(rect)

    dy = 0.0
    if y < rect["y"]:
        dy = rect["y"] - y
    elif y > _rect_bottom(rect):
        dy = y - _rect_bottom(rect)

    return (dx * dx) + (dy * dy)


def select_free_rect_for_anchor(
    *,
    compact_payload: dict[str, object],
    x: float,
    y: float,
) -> Rect | None:
    free_rects = _load_rects_from_payload(compact_payload, "free_rects")
    if not free_rects:
        return None

    containing = [
        rect
        for rect in free_rects
        if rect["x"] <= x <= _rect_right(rect) and rect["y"] <= y <= _rect_bottom(rect)
    ]
    if containing:
        return max(containing, key=_rect_area)

    return min(free_rects, key=lambda rect: (_distance_sq_to_rect(x, y, rect), -_rect_area(rect)))


def clamp_anchor_to_rect(*, x: float, y: float, rect: Rect) -> dict[str, float]:
    return {
        "x": min(max(x, rect["x"]), _rect_right(rect)),
        "y": min(max(y, rect["y"]), _rect_bottom(rect)),
    }


def fit_rect_from_anchor(
    *,
    anchor_x: float,
    anchor_y: float,
    free_rect: Rect,
    aspect_ratio: float | None,
    max_width: float,
    max_height: float,
) -> dict[str, float]:
    available_w = max(0.0, _rect_right(free_rect) - anchor_x)
    available_h = max(0.0, _rect_bottom(free_rect) - anchor_y)
    width_limit = min(available_w, max_width)
    height_limit = min(available_h, max_height)

    if aspect_ratio is None:
        width = width_limit
        height = height_limit
    else:
        width = min(width_limit, height_limit * aspect_ratio)
        height = width / aspect_ratio if aspect_ratio > 0 else 0.0
        if height > height_limit and aspect_ratio > 0:
            height = height_limit
            width = height * aspect_ratio

    return {
        "x": round(anchor_x),
        "y": round(anchor_y),
        "w": round(max(width, 0.0)),
        "h": round(max(height, 0.0)),
    }
