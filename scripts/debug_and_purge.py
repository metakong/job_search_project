import sys
import os
import asyncio
from pprint import pprint

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.pocketbase_client import PocketbaseClient

async def debug_and_purge():
    client = PocketbaseClient()
    
    # 1. Print available methods so we never guess again
    print("\n--- AVAILABLE METHODS IN PocketbaseClient ---")
    pprint([m for m in dir(client) if not m.startswith('_')])
    print("---------------------------------------------\n")
    
    # 2. Stop here to see the output. 
    # Once you see the correct method for listing/deleting, we can purge.
    await client.close()

if __name__ == "__main__":
    asyncio.run(debug_and_purge())