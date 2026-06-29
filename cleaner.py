import re
import html

# ======================================================================
# Boilerplate / Noise phrase patterns — truncate at first match
# ======================================================================
TRUNCATION_PHRASES = [
    r"equal opportunity employer",
    r"affirmative action",
    r"protected veteran status",
    r"\bdisabilit(y|ies)\b",
    r"race, color, religion, sex",
    r"applicants will receive consideration",
    r"comprehensive benefits package",
    r"\b401\(k\)\b",
    r"\bhealth,\s*dental\s*(?:,|\band\b|&)\s*vision\b",
    r"paid time off",
    r"\bpto\b",
    r"join our fast-paced",
    r"world-class culture",
    r"looking for a self-motivated rockstar"
]

# Pre-compile at module level for ARM64 performance
TRUNCATE_PATTERN = re.compile("|".join(TRUNCATION_PHRASES), re.IGNORECASE)
HTML_TAG_RE      = re.compile(r'<[^>]*>')
WHITESPACE_RE    = re.compile(r'\s+')
BODY_RE          = re.compile(r'<body[^>]*>(.*?)</body>', re.DOTALL | re.IGNORECASE)

MAX_DESC_LEN = 20_000


def scrub_boilerplate(text: str) -> str:
    """
    Strips noise, legal compliance boilerplate, and marketing puffery.
    Decodes HTML entities, strips tags, and truncates at the first
    compliance or marketing phrase.

    Returns a plain-text string (the 'scored' version of the description).
    Original signature preserved for backward compatibility with test_phase_2.py.
    """
    if not text:
        return ""

    # 1. Decode HTML entities
    text = html.unescape(text)

    # 2. Extract body content if full HTML document
    body_match = BODY_RE.search(text)
    if body_match:
        text = body_match.group(1)

    # 3. Guard against enormous payloads
    if len(text) > MAX_DESC_LEN:
        text = text[:MAX_DESC_LEN]

    # 4. Truncate at first compliance/marketing phrase
    match = TRUNCATE_PATTERN.search(text)
    if match:
        text = text[:match.start()]

    # 5. Strip HTML tags
    text = HTML_TAG_RE.sub(' ', text)

    # 6. Standardise whitespace
    text = WHITESPACE_RE.sub(' ', text).strip()

    return text


def split_description(text: str) -> tuple[str, str]:
    """
    Returns a tuple of (description_full, description_scored):

      description_full    — the input string COMPLETELY UNCHANGED.
                            No HTML stripping, no truncation.
                            Stored verbatim for audit / future re-scoring.

      description_scored  — scrub_boilerplate(text): cleaned and truncated
                            version used by the skill/toxicity scoring modules.

    Use this function in phase_2_cleansing.py to write both PocketBase fields.
    """
    return (text, scrub_boilerplate(text))