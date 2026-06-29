import sys
import os
import asyncio
import ujson

# Fix path to include project root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.pocketbase_client import PocketbaseClient

async def purge():
    client = PocketbaseClient()
    # Ensure authenticated
    await client.authenticate()
    
    seen = set()
    to_delete = []
    page = 1
    
    print("Scanning job_listings for duplicates (using raw direct client)...")
    
    while True:
        # Direct API call to job_listings using the underlying httpx client
        url = f"{client.base_url}/api/collections/job_listings/records?page={page}&perPage=100"
        response = await client.client.get(url, headers=client.headers)
        
        if response.status_code != 200:
            print(f"Error fetching page {page}: {response.text}")
            break
            
        data = ujson.loads(response.text)
        items = data.get("items", [])
        
        if not items:
            break
            
        for item in items:
            rid = item.get("raw_job_id")
            if rid in seen:
                to_delete.append(item["id"])
            else:
                seen.add(rid)
        
        print(f"Scanned {len(items)} records on page {page}...")
        page += 1
            
    print(f"Purging {len(to_delete)} duplicate records...")
    
    for uid in to_delete:
        del_url = f"{client.base_url}/api/collections/job_listings/records/{uid}"
        try:
            await client.client.delete(del_url, headers=client.headers)
        except Exception as e:
            print(f"Failed to delete {uid}: {e}")
        
    await client.close()
    print("Cleanup complete.")

if __name__ == "__main__":
    asyncio.run(purge())