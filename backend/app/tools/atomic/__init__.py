from app.tools.registry import BackendToolRegistry

from .get_image_context import GetImageContextTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
