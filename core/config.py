import os
import re
from pathlib import Path
from dotenv import load_dotenv

# Load env variables from .env if it exists
load_dotenv()

# Pocketbase configuration
POCKETBASE_URL = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090").rstrip("/")
POCKETBASE_ADMIN_EMAIL = os.getenv("POCKETBASE_ADMIN_EMAIL")
POCKETBASE_ADMIN_PASSWORD = os.getenv("POCKETBASE_ADMIN_PASSWORD")
# Feature flags
ENABLE_GOOGLE_JOBS = os.getenv("ENABLE_GOOGLE_JOBS", "true").lower() == "true"
LINKEDIN_FETCH_FULL_DESC = os.getenv("LINKEDIN_FETCH_FULL_DESC", "true").lower() == "true"


# API keys file path
KEYS_FILE_PATH = Path(__file__).parent.parent / "three_api_keys_info.txt"

class ConfigError(Exception):
    """Exception raised for errors in the configuration or API keys file parsing."""
    pass

def load_api_keys() -> dict:
    """
    Parses the local file 'three_api_keys_info.txt' to securely extract API credentials
    for Jooble, Adzuna, and JSearch.
    
    Returns:
        dict: A dictionary containing JOOBLE_KEY, ADZUNA_APP_ID, ADZUNA_APP_KEY, and JSEARCH_KEY.
    """
    if not KEYS_FILE_PATH.exists():
        raise ConfigError(f"API keys file not found at: {KEYS_FILE_PATH}")
    
    try:
        content = KEYS_FILE_PATH.read_text(encoding="utf-8")
    except Exception as e:
        raise ConfigError(f"Failed to read API keys file: {e}")
    
    # 1. Parse Jooble Key
    # Format: Your unique API key is: "12c2e255-a1af-4412-81ba-12d001bc5812"
    jooble_match = re.search(r'Your unique API key is:\s*"([^"]+)"', content)
    if not jooble_match:
        raise ConfigError("Could not find Jooble API Key in the keys file.")
    jooble_key = jooble_match.group(1).strip()
    
    # 2. Parse Adzuna App ID and App Key
    # Find App ID below "Application ID" header
    id_start = content.find("Application ID")
    if id_start == -1:
        raise ConfigError("Could not find Adzuna 'Application ID' header in the keys file.")
    
    # Search for the 8-character hex string in the text following the header
    adzuna_id_match = re.search(r'\b([a-f0-9]{8})\b', content[id_start:])
    if not adzuna_id_match:
        raise ConfigError("Could not parse Adzuna Application ID.")
    adzuna_app_id = adzuna_id_match.group(1).strip()
    
    # Find App Key below "Application Keys" header
    key_start = content.find("Application Keys")
    if key_start == -1:
        raise ConfigError("Could not find Adzuna 'Application Keys' header in the keys file.")
        
    # Search for the 32-character hex string in the text following the header
    adzuna_key_match = re.search(r'\b([a-f0-9]{32})\b', content[key_start:])
    if not adzuna_key_match:
        raise ConfigError("Could not parse Adzuna Application Key.")
    adzuna_app_key = adzuna_key_match.group(1).strip()
    
    # 3. Parse JSearch Key (RapidAPI Key)
    # Search for 50-character alphanumeric RapidAPI key under "X-RapidAPI-Key"
    jsearch_key = None
    jsearch_header_start = content.find("X-RapidAPI-Key")
    if jsearch_header_start != -1:
        jsearch_match = re.search(r'\b([a-zA-Z0-9]{50})\b', content[jsearch_header_start:])
        if jsearch_match:
            jsearch_key = jsearch_match.group(1).strip()
            
    # Fallback to searching for header 'x-rapidapi-key: ...'
    if not jsearch_key:
        jsearch_match = re.search(r"x-rapidapi-key:\s*'([a-zA-Z0-9]{50})'", content)
        if jsearch_match:
            jsearch_key = jsearch_match.group(1).strip()
            
    if not jsearch_key:
        raise ConfigError("Could not parse JSearch API Key (RapidAPI Key).")
        
    return {
        "JOOBLE_KEY": jooble_key,
        "ADZUNA_APP_ID": adzuna_app_id,
        "ADZUNA_APP_KEY": adzuna_app_key,
        "JSEARCH_KEY": jsearch_key
    }

# Expose parsed keys dictionary
try:
    API_KEYS = load_api_keys()
except ConfigError as e:
    import sys
    sys.exit(f"CRITICAL CONFIGURATION ERROR: {e}")
