import re

# ======================================================================
# KILL SWITCH — Exclusion Taxonomy
# ======================================================================
# Each category's terms use simple keyword matching (word-boundary where
# the term starts/ends with alphanumeric chars).  The new
# "Hard-Personal-Disqualifier" category uses full regex strings because
# its patterns are naturally complex multi-word constructions.
# ======================================================================

# NOTE: "Entry-Level/Support" category removed per Item 4.
# Any seniority level is now permitted through the kill switch.
# Seniority is still detected and stored as seniority_level (display only).

EXCLUSION_LIST = {
    "MLM/Predatory": {
        "100% commission", "no experience necessary", "immediate hire",
        "door-to-door", "event marketing", "brand ambassador"
    },
    "Regulated/Non-Relevant": {
        "cpa", "rn", "java developer", "unity developer", ".net"
    },
    "Trades/Labor": {
        "cdl", "forklift", "hvac", "welder"
    },
    "Clinical": {
        "phlebotomy", "lpn", "dental hygienist", "medical assistant"
    }
}

# Pre-compile keyword-based patterns at module level (ARM64 perf)
EXCLUSION_PATTERNS = {}
for category, terms in EXCLUSION_LIST.items():
    parts = []
    for term in terms:
        escaped = re.escape(term)
        sb = r"\b" if term[0].isalnum() else ""
        eb = r"\b" if term[-1].isalnum() else ""
        parts.append(f"{sb}{escaped}{eb}")
    EXCLUSION_PATTERNS[category] = re.compile("|".join(parts), re.IGNORECASE)


_TRADES_COMPLEX_PATTERNS = [
    r"\bassembly\s+(?:line|technician|worker|operator|floor)\b",
    r"\bassembler\b",
    r"\bwarehouse\s+(?:worker|associate|staff|operator|picker|packer)\b"
]

EXCLUSION_PATTERNS["Trades/Labor_Complex"] = re.compile(
    "|".join(_TRADES_COMPLEX_PATTERNS), re.IGNORECASE
)

# -----------------------------------------------------------------------
# Hard-Personal-Disqualifier  (Item 5)
# These are fully-specified regex patterns — compiled directly, no escaping.
# -----------------------------------------------------------------------
_HARD_PERSONAL_PATTERNS = [
    # — Degree mandate —
    r"bachelor'?s\s+degree\s+required",
    r"\bdegree\s+required\b",
    r"\bmust\s+have\s+a\s+degree\b",
    r"\bb\.?s\.?\s+required\b",
    r"\bb\.?a\.?\s+required\b",
    r"\b4.year\s+degree\b",
    r"\bcollege\s+degree\s+required\b",
    r"\bminimum.*degree\b",
    r"\bdegree.*required\b",

    # — Travel requirement —
    r"\btravel\s+required\b",
    r"\btravel\s+up\s+to\b",
    r"\bmust\s+be\s+willing\s+to\s+travel\b",
    r"\bfrequent\s+travel\b",
    r"\b\d{2,3}%\s*travel\b",
    r"\btravel\s+regularly\b",
    r"\bextensive\s+travel\b",
    r"\btravel\s+is\s+required\b",

    # — Government / public sector —
    r"\bgovernment\s+contractor\b",
    r"\bfederal\s+agency\b",
    r"\bdod\b",
    r"\bdepartment\s+of\s+homeland\b",
    r"\bsecurity\s+clearance\b",
    r"\btop\s+secret\b",
    r"\bpublic\s+sector\b",
    r"\bmunicipal\b",
    r"\bcounty\s+government\b",
    r"\bstate\s+agency\b",
    r"\bgsa\s+schedule\b",
]

EXCLUSION_PATTERNS["Hard-Personal-Disqualifier"] = re.compile(
    "|".join(_HARD_PERSONAL_PATTERNS), re.IGNORECASE
)


def evaluate_eligibility(text: str) -> tuple[bool, str | None]:
    """
    Ingests a job description and performs deterministic "Kill Switch" checks
    using module-level compiled regexes.

    Args:
        text (str): The raw (untruncated) job description text.

    Returns:
        tuple[bool, str | None]: (is_eligible, discard_reason)
            discard_reason is None when is_eligible is True.
    """
    if not text:
        return False, "Empty Description"

    for category, pattern in EXCLUSION_PATTERNS.items():
        if pattern.search(text):
            return False, category

    return True, None
