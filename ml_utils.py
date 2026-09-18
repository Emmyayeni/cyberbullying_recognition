import html
import re
from typing import Dict, List, Tuple

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
MENTION_RE = re.compile(r"@\w+")
WHITESPACE_RE = re.compile(r"\s+")

# Lexicon of cyberbullying cues (insults, slurs, harassment, threats, body shaming, and intimidation)
# Used for: (1) highlighting explainability in messages, (2) providing baseline fallback classification
HIGH_SEVERITY_PATTERNS = [
    r"\b(kill|die|hang)\s+(your\s*self|ur\s*self)\b",
    r"\bgo\s+die\b",
    r"\bi('ll|\s*will)\s+(hunt|find|beat|hurt|destroy|kill)\s+you\b",
    r"\b(nobody|no\s*one)\s+(likes|wants|cares\s+about)\s+you\b",
    r"\byou\s+deserve\s+to\s+(die|suffer|be\s+hurt)\b",
    r"\bu\s+r\s+(worthless|pathetic|trash|garbage|disgusting)\b",
    r"\byou('re|\s+are)\s+(worthless|pathetic|disgusting|trash|garbage|a\s+waste\s+of\s+space)\b",
]

MODERATE_SEVERITY_PATTERNS = [
    r"\b(loser|idiot|moron|stupid|dumbass|ugly|fat|creep|freak|bitch|bastard|asshole|retard|scum)\b",
    r"\bshut\s+(the\s*fuck\s*)?up\b",
    r"\byou('re|\s+are)\s+(so\s+)?(dumb|stupid|annoying|useless|pathetic|fake)\b",
    r"\bget\s+lost\b",
    r"\beveryone\s+hates\s+you\b",
    r"\bdelete\s+your\s+account\b",
    r"\bfuck\s+(off|you|u)\b",
    r"\bstop\s+talking\b",
]

MILD_TENSION_PATTERNS = [
    r"\bwhatever\b",
    r"\byou('re|\s+are)\s+wrong\b",
    r"\bannoying\b",
    r"\bterrible\b",
    r"\bworst\b",
    r"\bcringe\b",
]

COMPILED_HIGH = [re.compile(p, re.IGNORECASE) for p in HIGH_SEVERITY_PATTERNS]
COMPILED_MODERATE = [re.compile(p, re.IGNORECASE) for p in MODERATE_SEVERITY_PATTERNS]
COMPILED_MILD = [re.compile(p, re.IGNORECASE) for p in MILD_TENSION_PATTERNS]


def clean_text(text: str) -> str:
    """Light normalization that keeps most linguistic signals intact."""
    if text is None:
        return ""
    text = html.unescape(str(text))
    text = text.lower().strip()
    text = URL_RE.sub(" URL ", text)
    text = MENTION_RE.sub(" USER ", text)
    text = WHITESPACE_RE.sub(" ", text)
    return text.strip()


def extract_flagged_terms(text: str) -> List[str]:
    """Finds words or phrases triggering safety alarms for explainability."""
    if not text:
        return []
    flagged = []
    lower = text.lower()

    for pattern in COMPILED_HIGH + COMPILED_MODERATE:
        matches = pattern.findall(lower)
        for m in matches:
            if isinstance(m, tuple):
                m = " ".join([part for part in m if part])
            if m and m not in flagged:
                flagged.append(m)

    return flagged


def highlight_flagged_terms(text: str) -> str:
    """Wraps detected offending terms in <mark> tags for frontend display."""
    if not text:
        return ""
    escaped_text = html.escape(text)

    # Highlight high severity first
    for pattern in COMPILED_HIGH:
        escaped_text = pattern.sub(r'<mark class="flagged-high">\g<0></mark>', escaped_text)

    for pattern in COMPILED_MODERATE:
        escaped_text = pattern.sub(r'<mark class="flagged-mod">\g<0></mark>', escaped_text)

    return escaped_text


def baseline_heuristic_classify(text: str, threshold: float = 0.50) -> Dict:
    """
    Intelligent rule-based classifier used as a fallback when the trained
    scikit-learn pipeline (.pkl) is not yet compiled or uploaded.
    """
    if not text or not text.strip():
        return {
            "classification": "SAFE",
            "confidence": 0.99,
            "bullying_probability": 0.01,
            "blocked": False,
            "category": "Neutral",
            "flagged_terms": [],
            "risk_level": "Safe",
            "nudge": "Message looks good.",
        }

    raw_text = text.strip()
    cleaned = clean_text(raw_text)

    high_matches = []
    for pattern in COMPILED_HIGH:
        m = pattern.findall(cleaned)
        if m:
            high_matches.extend(m)

    mod_matches = []
    for pattern in COMPILED_MODERATE:
        m = pattern.findall(cleaned)
        if m:
            mod_matches.extend(m)

    mild_matches = []
    for pattern in COMPILED_MILD:
        m = pattern.findall(cleaned)
        if m:
            mild_matches.extend(m)

    # Score calculation
    prob = 0.05
    category = "Safe"
    risk_level = "Safe"
    nudge = "Safe & constructive tone."

    if high_matches:
        prob = min(0.98, 0.85 + (len(high_matches) * 0.05))
        category = "Severe Harassment / Threat"
        risk_level = "High Risk"
        nudge = "Warning: Extreme cyberbullying or personal threat detected. Consider rephrasing."
    elif mod_matches:
        prob = min(0.88, 0.60 + (len(mod_matches) * 0.08))
        category = "Insult / Derogatory Attack"
        risk_level = "High Risk"
        nudge = "Warning: Hurtful or aggressive language detected. Please maintain respectful conversation."
    elif mild_matches:
        prob = min(0.45, 0.25 + (len(mild_matches) * 0.06))
        category = "Tense / Borderline"
        risk_level = "Mild Risk"
        nudge = "Tone check: Mild tension detected. Consider keeping it constructive."

    # Factor in excessive uppercase / shouting
    caps_ratio = sum(1 for c in raw_text if c.isupper()) / max(1, len(raw_text))
    if caps_ratio > 0.6 and len(raw_text) > 8:
        prob = min(0.95, prob + 0.15)
        if risk_level == "Safe":
            risk_level = "Mild Risk"
            nudge = "Note: Excessive uppercase text can be interpreted as shouting."

    blocked = prob >= threshold
    flagged = extract_flagged_terms(raw_text)

    return {
        "classification": "CYBERBULLYING" if blocked else "SAFE",
        "confidence": prob if blocked else (1.0 - prob),
        "bullying_probability": round(prob, 4),
        "blocked": blocked,
        "category": category,
        "flagged_terms": flagged,
        "risk_level": risk_level,
        "nudge": nudge,
    }
