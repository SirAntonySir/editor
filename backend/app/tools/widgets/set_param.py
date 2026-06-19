from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


def _format_value(v: object) -> str:
    """Format a param value for the history label.

    - bool   → "on" / "off"
    - float  → rounded to 2 decimal places, then signed if non-negative
               (e.g. 0.42 → "+0.42", -0.3 → "-0.3", 0.0 → "0.0")
    - int    → signed if non-negative (e.g. 5 → "+5", -20 → "-20", 0 → "0")
    - other  → str()
    """
    if isinstance(v, bool):
        return "on" if v else "off"
    if isinstance(v, float):
        rounded = round(v, 2)
        return f"{rounded:+g}" if rounded >= 0 else str(rounded)
    if isinstance(v, int):
        return f"{v:+d}" if v >= 0 else str(v)
    return str(v)


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = Field(min_length=1)
    op: str = Field(min_length=1)
    param: str = Field(min_length=1)
    value: float | int | str | bool | list | dict


class _Output(BaseModel):
    ok: bool


class SetParamTool(BackendTool[_Input, _Output]):
    name = "set_param"
    kind = "mutate"
    description = (
        "Write a single canonical (layer, op, param) value directly — no widget "
        "required. The Adjustments accordion edits canonical state through this. "
        "REST-only — accordion/slider editing is a human pointing-device action, "
        "not an agent action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def coalesce_key(self, input: _Input) -> str:  # noqa: A002
        """Merge consecutive set_param calls on the SAME (layer, op, param)
        into one undo entry — see BackendTool.coalesce_key. Lets a slow
        slider drag (which fires multiple debounced set_params as the
        user pauses) collapse into a single undoable step."""
        return f"set_param:{input.layer_id}:{input.op}:{input.param}"

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        """Readable label: "Setting <param> = <value>" — shows up in the
        history dropdown instead of the raw tool name."""
        return f"Setting {input.param} = {_format_value(input.value)}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.set_param(input.layer_id, input.op, input.param, input.value)
        return _Output(ok=True)
