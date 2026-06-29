import asyncio
import httpx
import logging
from core.pocketbase_client import PocketbaseClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("setup_pocketbase")

async def init_database():
    client = PocketbaseClient()
    await client.authenticate()

    # ------------------------------------------------------------------ #
    # 1.  Discover existing collections so we can drop and recreate them  #
    # ------------------------------------------------------------------ #
    response = await client.client.get(f"{client.base_url}/api/collections", headers=client.headers)
    response.raise_for_status()
    existing_collections = {col["name"]: col["id"] for col in response.json().get("items", [])}

    ALL_MANAGED = [
        "job_listings", "companies", "raw_jobs",
        "blacklisted_companies", "filter_profiles", "ats_watchlist"
    ]

    # Drop in reverse-dependency order (job_listings references companies + raw_jobs)
    drop_order = ["job_listings", "blacklisted_companies", "filter_profiles",
                  "ats_watchlist", "companies", "raw_jobs"]
    for name in drop_order:
        if name in existing_collections:
            logger.info(f"Dropping existing '{name}' collection...")
            col_id = existing_collections[name]
            try:
                del_resp = await client.client.delete(
                    f"{client.base_url}/api/collections/{col_id}", headers=client.headers
                )
                del_resp.raise_for_status()
                logger.info(f"  ✓ Dropped '{name}'")
            except Exception as e:
                logger.error(f"  ✗ Failed to drop '{name}': {e}")

    url = f"{client.base_url}/api/collections"

    # ------------------------------------------------------------------ #
    # 2.  raw_jobs                                                        #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'raw_jobs' collection...")
    raw_jobs_schema = {
        "name": "raw_jobs",
        "type": "base",
        "indexes": [
            "CREATE INDEX idx_rj_status ON raw_jobs (status)",
            "CREATE INDEX idx_rj_hash   ON raw_jobs (payload_hash)"
        ],
        "fields": [
            {"name": "source",           "type": "text",   "required": True},
            {"name": "scraped_at",       "type": "date",   "required": False},
            {"name": "raw_payload",      "type": "json",   "required": False},
            {"name": "description_raw",  "type": "text",   "required": False, "max": 200000},
            {"name": "status",           "type": "text",   "required": False},
            {"name": "analysis_metadata","type": "json",   "required": False},
            {"name": "description_clean","type": "text",   "required": False, "max": 100000},
            {"name": "payload_hash",     "type": "text",   "required": False}
        ]
    }
    resp = await client.client.post(url, json=raw_jobs_schema, headers=client.headers)
    resp.raise_for_status()
    raw_jobs_id = resp.json()["id"]
    logger.info(f"  ✓ raw_jobs  (id={raw_jobs_id})")

    # ------------------------------------------------------------------ #
    # 3.  companies                                                       #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'companies' collection...")
    companies_schema = {
        "name": "companies",
        "type": "base",
        "listRule": "",
        "viewRule": "",
        "fields": [
            {"name": "name",              "type": "text", "required": True},
            {"name": "hq_location",       "type": "text", "required": False},
            {"name": "stated_values",     "type": "json", "required": False},
            {"name": "perceived_culture", "type": "json", "required": False},
            {"name": "macro_context",     "type": "json", "required": False}
        ]
    }
    resp = await client.client.post(url, json=companies_schema, headers=client.headers)
    resp.raise_for_status()
    companies_id = resp.json()["id"]
    logger.info(f"  ✓ companies (id={companies_id})")

    # ------------------------------------------------------------------ #
    # 4.  job_listings  (full extended schema)                            #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'job_listings' collection...")
    job_listings_schema = {
        "name": "job_listings",
        "type": "base",
        "listRule":   "",
        "viewRule":   "",
        "createRule": "",   # phase_1 writes directly; dashboard also creates via API
        "updateRule": "",   # dashboard PATCHes application_status, etc.
        "indexes": [
            "CREATE INDEX idx_jl_eligible  ON job_listings (is_eligible)",
            "CREATE INDEX idx_jl_target    ON job_listings (target_status)",
            "CREATE INDEX idx_jl_hash      ON job_listings (payload_hash)",
            "CREATE INDEX idx_jl_appstatus ON job_listings (application_status)",
            "CREATE INDEX idx_jl_stale     ON job_listings (is_stale)"
        ],
        "fields": [
            # ── Relations (kept for backward compat with legacy raw_jobs flow)
            {
                "name": "company_id", "type": "relation",
                "required": False, "collectionId": companies_id,
                "cascadeDelete": False, "maxSelect": 1
            },
            {
                "name": "raw_job_id", "type": "relation",
                "required": False, "collectionId": raw_jobs_id,
                "cascadeDelete": False, "maxSelect": 1
            },

            # ── Core identification (kept from original schema)
            {"name": "title",             "type": "text",   "required": False},
            {"name": "description_clean", "type": "text",   "required": False, "max": 100000},

            # ── New description dual-storage (Item 2 / Phase F)
            {"name": "description_full",   "type": "text",   "required": False, "max": 200000},
            {"name": "description_scored", "type": "text",   "required": False, "max": 100000},

            # ── Eligibility
            {"name": "is_eligible",    "type": "bool", "required": False},
            {"name": "discard_reason", "type": "text", "required": False},

            # ── Timestamps
            {"name": "enriched_at", "type": "date", "required": False},
            {"name": "posted_at",   "type": "date", "required": False},

            # ── Salary (original fields retained; salary_parseable added)
            {"name": "salary_min",       "type": "number", "required": False},
            {"name": "salary_max",       "type": "number", "required": False},
            {"name": "salary_parseable", "type": "bool",   "required": False},

            # ── Recency (Item 9)
            {"name": "days_since_posted",  "type": "number", "required": False},
            {"name": "recency_multiplier", "type": "number", "required": False},
            {"name": "is_stale",           "type": "bool",   "required": False},

            # ── Scoring (original fields retained; final_leverage_ratio added)
            {"name": "toxicity_score",      "type": "number", "required": False},
            {"name": "skill_match_score",   "type": "number", "required": False},
            {"name": "role_title_score",    "type": "number", "required": False},
            {"name": "leverage_ratio",      "type": "number", "required": False},
            {"name": "final_leverage_ratio","type": "number", "required": False},
            {"name": "target_status",       "type": "text",   "required": False},

            # ── Percentile + ATS alignment (Items 11, 23)
            {"name": "match_percentile",    "type": "number", "required": False},
            {"name": "ats_alignment_score", "type": "number", "required": False},

            # ── Classification fields (Items 12, 13, 14)
            {"name": "location_type",  "type": "text", "required": False},  # remote/hybrid/on_site/unknown
            {"name": "seniority_level","type": "text", "required": False},  # director/manager/senior/entry/unspecified
            {"name": "industry",       "type": "text", "required": False},

            # ── Application lifecycle (Items 15, 24)
            {"name": "application_status", "type": "text", "required": False},  # unseen/bookmarked/applied/…
            {"name": "apply_type",         "type": "text", "required": False},  # easy_apply/external_ats/unknown

            # ── Flag fields (Items 21, 22)
            {"name": "is_ghost_job", "type": "bool", "required": False},
            {"name": "is_duplicate", "type": "bool", "required": False},

            # ── Ingestion metadata (Phase D)
            {"name": "apply_url",        "type": "url",  "required": False},
            {"name": "source_platform",  "type": "text", "required": False},
            {"name": "job_location",     "type": "text", "required": False},
            {"name": "company_name",     "type": "text", "required": False},  # denormalised for dedup + display
            {"name": "employment_type",  "type": "text", "required": False},
            {"name": "payload_hash",     "type": "text", "required": False}
        ]
    }
    resp = await client.client.post(url, json=job_listings_schema, headers=client.headers)
    resp.raise_for_status()
    logger.info(f"  ✓ job_listings (id={resp.json()['id']})")

    # ------------------------------------------------------------------ #
    # 5.  blacklisted_companies                                           #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'blacklisted_companies' collection...")
    blacklist_schema = {
        "name": "blacklisted_companies",
        "type": "base",
        "listRule":   "",
        "viewRule":   "",
        "createRule": "",
        "updateRule": "",
        "deleteRule": "",
        "fields": [
            {"name": "name",       "type": "text", "required": True},
            {"name": "reason",     "type": "text", "required": False},
            {"name": "date_added", "type": "date", "required": False}
        ]
    }
    resp = await client.client.post(url, json=blacklist_schema, headers=client.headers)
    resp.raise_for_status()
    logger.info(f"  ✓ blacklisted_companies (id={resp.json()['id']})")

    # ------------------------------------------------------------------ #
    # 6.  filter_profiles                                                 #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'filter_profiles' collection...")
    filter_profiles_schema = {
        "name": "filter_profiles",
        "type": "base",
        "listRule":   "",
        "viewRule":   "",
        "createRule": "",
        "updateRule": "",
        "deleteRule": "",
        "fields": [
            {"name": "profile_name",     "type": "text", "required": True},
            {"name": "filter_state_json","type": "json", "required": True}
        ]
    }
    resp = await client.client.post(url, json=filter_profiles_schema, headers=client.headers)
    resp.raise_for_status()
    logger.info(f"  ✓ filter_profiles (id={resp.json()['id']})")

    # ------------------------------------------------------------------ #
    # 7.  ats_watchlist                                                   #
    # ------------------------------------------------------------------ #
    logger.info("Creating 'ats_watchlist' collection...")
    ats_watchlist_schema = {
        "name": "ats_watchlist",
        "type": "base",
        "listRule":   "",
        "viewRule":   "",
        "createRule": "",
        "updateRule": "",
        "deleteRule": "",
        "fields": [
            {"name": "company_name", "type": "text", "required": True},
            {"name": "ats_type",     "type": "text", "required": False},  # greenhouse/lever/workday
            {"name": "company_slug", "type": "text", "required": False},
            {"name": "active",       "type": "bool", "required": False}
        ]
    }
    resp = await client.client.post(url, json=ats_watchlist_schema, headers=client.headers)
    resp.raise_for_status()
    logger.info(f"  ✓ ats_watchlist (id={resp.json()['id']})")

    await client.close()
    logger.info("\n✅  All collections created successfully.")
    logger.info("    Collections: raw_jobs · companies · job_listings · blacklisted_companies · filter_profiles · ats_watchlist")

if __name__ == "__main__":
    asyncio.run(init_database())