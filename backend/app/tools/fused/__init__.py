from typing import Iterable

from app.tools.fused_framework import FusedToolTemplate

from .bw_cinematic import BwCinematicTemplate
from .cast_correct import CastCorrectTemplate
from .cool_grade import CoolGradeTemplate
from .exposure_balance import ExposureBalanceTemplate
from .portrait_glow import PortraitGlowTemplate
from .sky_recovery import SkyRecoveryTemplate
from .subject_pop import SubjectPopTemplate
from .teal_orange import TealOrangeTemplate
from .warm_grade import WarmGradeTemplate


def all_fused_templates() -> Iterable[FusedToolTemplate]:
    yield WarmGradeTemplate()
    yield CoolGradeTemplate()
    yield ExposureBalanceTemplate()
    yield SkyRecoveryTemplate()
    yield PortraitGlowTemplate()
    yield BwCinematicTemplate()
    yield CastCorrectTemplate()
    yield TealOrangeTemplate()
    yield SubjectPopTemplate()
