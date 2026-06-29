"""
One-Time Backfill Utility: Enriches existing Adzuna/Jooble job_listings
with full description text via JIT scraping.

Targets records where description_clean is truncated (< 300 chars),
fetches the full body from apply_url, re-runs scrub_boilerplate(), and
updates the record in PocketBase.

Usage:
    py scripts/backfill_descriptions.py [--dry-run] [--batch-size N]
"""

import asyncio
import argparse
import logging
import sys
import os

# Add the project root to sys.path so core/ and cleaner imports resolve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.pocketbase_client import PocketbaseClient
from core.jit_scraper import fetch_full_description, close_client as close_jit_client, JIT_FETCH_DELAY
from cleaner import scrub_boilerplate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("backfill_descriptions")

# Minimum description_clean length threshold: records shorter than this
# are considered truncated snippets needing backfill.
SNIPPET_THRESHOLD = 300


async def fetch_listings_page(client: PocketbaseClient, page: int, per_page: int) -> dict:
    """
    Fetches a page of job_listings from PocketBase with a filter for
    short descriptions that have an apply_url available.
    
    Note: The job_listings schema does not store 'source' directly — the source
    lives on the related raw_jobs record. We filter by description length as
    the primary indicator of snippet-based records.
    """
    # PocketBase does not support string length filters natively,
    # so we fetch eligible records with apply_url and filter client-side.
    filter_str = "is_eligible = true && apply_url != ''"
    
    url = (
        f"{client.base_url}/api/collections/job_listings/records"
        f"?page={page}&perPage={per_page}"
        f"&filter={filter_str}"
        f"&fields=id,description_clean,apply_url,raw_job_id"
        f"&expand=raw_job_id"
    )
    
    response = await client.client.get(url, headers=client.headers)
    
    if response.status_code == 401 and client.email and client.password:
        await client.authenticate()
        response = await client.client.get(url, headers=client.headers)
    
    response.raise_for_status()
    import ujson
    return ujson.loads(response.text)


async def main():
    parser = argparse.ArgumentParser(description="Backfill truncated job descriptions via JIT scraping.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview which records would be updated without writing changes."
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Number of records to fetch per page (default: 50)."
    )
    args = parser.parse_args()

    client = PocketbaseClient()
    await client.authenticate()

    page = 1
    per_page = args.batch_size
    total_processed = 0
    total_updated = 0
    total_failed = 0
    total_skipped = 0

    logger.info(f"Starting backfill scan (threshold: {SNIPPET_THRESHOLD} chars, dry_run: {args.dry_run})...")

    try:
        while True:
            logger.info(f"Fetching page {page} (batch size {per_page})...")
            page_data = await fetch_listings_page(client, page, per_page)
            records = page_data.get("items", [])

            if not records:
                logger.info("No more records to process.")
                break

            for record in records:
                record_id = record["id"]
                description_clean = record.get("description_clean", "")
                apply_url = record.get("apply_url", "")

                # Check if the raw_job source is Adzuna or Jooble
                raw_job_expand = record.get("expand", {}).get("raw_job_id")
                source = ""
                if raw_job_expand:
                    if isinstance(raw_job_expand, list) and len(raw_job_expand) > 0:
                        source = raw_job_expand[0].get("source", "")
                    elif isinstance(raw_job_expand, dict):
                        source = raw_job_expand.get("source", "")

                total_processed += 1

                # Skip if description is already long enough
                if len(description_clean) >= SNIPPET_THRESHOLD:
                    total_skipped += 1
                    continue

                # Skip if source is not Adzuna/Jooble (JSearch already has full text)
                if source and source not in ("Adzuna", "Jooble"):
                    total_skipped += 1
                    continue

                # Skip if no apply_url
                if not apply_url or apply_url == '#':
                    total_skipped += 1
                    logger.debug(f"Skipping {record_id}: no apply_url.")
                    continue

                if args.dry_run:
                    logger.info(
                        f"[DRY-RUN] Would backfill record {record_id} "
                        f"(source={source or 'unknown'}, current length={len(description_clean)}, url={apply_url[:60]}...)"
                    )
                    total_updated += 1
                    continue

                # JIT Fetch
                try:
                    full_text = await fetch_full_description(apply_url)

                    if full_text:
                        new_description_clean = scrub_boilerplate(full_text)
                        await client.update_job_listing(record_id, {
                            "description_clean": new_description_clean
                        })
                        total_updated += 1
                        logger.info(
                            f"Updated record {record_id}: {len(description_clean)} -> {len(new_description_clean)} chars"
                        )
                    else:
                        total_failed += 1
                        logger.warning(
                            f"JIT scrape returned no usable text for {record_id} ({apply_url[:60]}...)"
                        )
                except Exception as e:
                    total_failed += 1
                    logger.error(f"Failed to backfill record {record_id}: {e}")

                # Rate-limit between fetches
                await asyncio.sleep(JIT_FETCH_DELAY)

            total_pages = page_data.get("totalPages", 1)
            if page >= total_pages:
                break
            page += 1

    finally:
        await close_jit_client()
        await client.close()

    logger.info("=" * 60)
    logger.info("BACKFILL SUMMARY")
    logger.info(f"  Records scanned:  {total_processed}")
    logger.info(f"  Records updated:  {total_updated}")
    logger.info(f"  Records failed:   {total_failed}")
    logger.info(f"  Records skipped:  {total_skipped}")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
