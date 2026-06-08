from typing import Iterable

from app.tools.fused_framework import FusedToolTemplate

from .atmospheres import (
    BlueHourTemplate,
    FoggyTemplate,
    GoldenHourTemplate,
    OvercastTemplate,
)
from .bw_cinematic import BwCinematicTemplate
from .bw_variants import BwHighContrastTemplate, BwLowKeyTemplate
from .cast_correct import CastCorrectTemplate
from .colour_theory import (
    AnalogousGradeTemplate,
    ComplementaryGradeTemplate,
    MonochromeTintTemplate,
)
from .contrast import (
    ContrastDropTemplate,
    DetailPopTemplate,
    LevelsStretchTemplate,
)
from .cool_grade import CoolGradeTemplate
from .exposure_balance import ExposureBalanceTemplate
from .finishing import MicroContrastTemplate, TintedGradeTemplate
from .light_surgery import (
    ContrastPunchTemplate,
    DeepenBlacksTemplate,
    LiftShadowsTemplate,
    RecoverHighlightsTemplate,
)
from .moods import (
    DreamyTemplate,
    GrittyTemplate,
    MatteFilmTemplate,
    MoodyTemplate,
    VintageTemplate,
)
from .portrait_glow import PortraitGlowTemplate
from .sky_recovery import SkyRecoveryTemplate
from .subject_pop import SubjectPopTemplate
from .teal_orange import TealOrangeTemplate
from .tone_band import all_tone_band_templates
from .warm_grade import WarmGradeTemplate


def all_fused_templates() -> Iterable[FusedToolTemplate]:
    # Original nine (legacy hand-written resolvers).
    yield WarmGradeTemplate()
    yield CoolGradeTemplate()
    yield ExposureBalanceTemplate()
    yield SkyRecoveryTemplate()
    yield PortraitGlowTemplate()
    yield BwCinematicTemplate()
    yield CastCorrectTemplate()
    yield TealOrangeTemplate()
    yield SubjectPopTemplate()

    # New: 8 per-band HSL tone templates.
    yield from all_tone_band_templates()

    # New: 5 tonal mood grades.
    yield MoodyTemplate()
    yield DreamyTemplate()
    yield VintageTemplate()
    yield MatteFilmTemplate()
    yield GrittyTemplate()

    # New: 4 time-of-day atmospheres.
    yield GoldenHourTemplate()
    yield BlueHourTemplate()
    yield OvercastTemplate()
    yield FoggyTemplate()

    # New: 4 per-channel light surgery tools.
    yield LiftShadowsTemplate()
    yield DeepenBlacksTemplate()
    yield RecoverHighlightsTemplate()
    yield ContrastPunchTemplate()

    # New: 3 contrast/detail tools.
    yield DetailPopTemplate()
    yield ContrastDropTemplate()
    yield LevelsStretchTemplate()

    # New: 2 B&W variants (alongside the existing bw_cinematic LUT stock).
    yield BwHighContrastTemplate()
    yield BwLowKeyTemplate()

    # New: 2 finishing/polish tools.
    yield TintedGradeTemplate()
    yield MicroContrastTemplate()

    # New: 3 colour-theory grades.
    yield ComplementaryGradeTemplate()
    yield AnalogousGradeTemplate()
    yield MonochromeTintTemplate()

