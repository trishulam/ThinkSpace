"""ThinkSpace tool registration surface."""

from .canvas_delegate import get_canvas_delegate_tools
from .canvas_snapshot import get_canvas_snapshot_tools
from .canvas_visuals import get_canvas_visual_tools
from .canvas_widgets import get_canvas_widget_tools
from .flashcards import get_flashcard_tools
from .knowledge_lookup import get_knowledge_lookup_tools
from .registry import get_tools

__all__ = [
    "get_canvas_delegate_tools",
    "get_canvas_snapshot_tools",
    "get_canvas_visual_tools",
    "get_canvas_widget_tools",
    "get_flashcard_tools",
    "get_knowledge_lookup_tools",
    "get_tools",
]
