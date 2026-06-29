import asyncio
from core.pocketbase_client import PocketbaseClient

async def reset_jobs():
    client = PocketbaseClient()
    updated_count = 0
    print("Scanning for processed jobs to reset...")
    
    while True:
        data = await client.fetch_raw_jobs_page(page=1, per_page=100, filter_str="status='processed'")
        items = data.get("items", [])
        if not items:
            break
            
        for item in items:
            await client.update_raw_job(item["id"], {"status": "raw"})
            updated_count += 1
            
        print(f"Reset {updated_count} jobs back to 'raw'...")

    await client.close()
    print(f"SUCCESS: {updated_count} total jobs are ready for Phase 4 scoring.")

if __name__ == "__main__":
    asyncio.run(reset_jobs())