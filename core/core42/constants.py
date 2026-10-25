"""42 identifiers and settings shared by the analysis and the web app."""
from zoneinfo import ZoneInfo

MAIN_CURSUS = 21
# the quests that place someone in the Common Core: "Common Core" and "Common Core Rank 00"…"05" (42cursus, checked 2026-10-25)
COMMON_CORE_QUESTS = (37, 44, 45, 46, 47, 48, 49)
PISCINE_CURSUS = 9
MADRID_CAMPUS = 22
# the four coalitions of the 42 Madrid main cursus, in the order that wins when a user has several
MAIN_COALITIONS = ("zefiria", "marventis", "ignisaria", "tiamant")
TIMEZONE = ZoneInfo("Europe/Madrid")
