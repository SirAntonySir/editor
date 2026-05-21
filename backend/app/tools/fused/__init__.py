from typing import Iterable

from app.tools.fused_framework import FusedToolTemplate

from .warm_grade import WarmGradeTemplate


def all_fused_templates() -> Iterable[FusedToolTemplate]:
    yield WarmGradeTemplate()
