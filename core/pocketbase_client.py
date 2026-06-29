import asyncio
import random
import logging
from datetime import datetime, timezone
import httpx
import ujson
from core import config

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class PocketbaseClient:
    """
    Asynchronous client for interacting with a local Pocketbase instance.
    Handles admin authentication and raw job record insertions with retry and backoff.
    Uses ujson for fast deserialization.
    """
    
    def __init__(self, base_url: str = None, email: str = None, password: str = None):
        self.base_url = (base_url or config.POCKETBASE_URL).rstrip("/")
        self.email = email or config.POCKETBASE_ADMIN_EMAIL
        self.password = password or config.POCKETBASE_ADMIN_PASSWORD
        self.token = None
        self.headers = {"Content-Type": "application/json"}
        # Initialize HTTPX AsyncClient with a reasonable default timeout
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        """Closes the underlying async HTTP client session."""
        await self.client.aclose()

    async def authenticate(self, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Authenticates with Pocketbase as a superuser.
        """
        if not self.email or not self.password:
            logger.warning("Pocketbase email or password not configured. Skipping admin authentication.")
            return False

        auth_url = f"{self.base_url}/api/collections/_superusers/auth-with-password"
        payload = {
            "identity": self.email,
            "password": self.password
        }

        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"Authenticating with Pocketbase admin API (attempt {attempt}/{max_retries})...")
                response = await self.client.post(auth_url, json=payload)
                
                if response.status_code == 200:
                    data = ujson.loads(response.text)
                    self.token = data.get("token")
                    self.headers["Authorization"] = f"Bearer {self.token}"
                    logger.info("Pocketbase authentication successful.")
                    return True
                else:
                    logger.error(f"Pocketbase authentication returned status {response.status_code}: {response.text}")
                    # Fast fail on non-transient 4xx errors
                    if 400 <= response.status_code < 500:
                        raise ValueError(f"Invalid Pocketbase admin credentials: {response.text}")
            
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during authentication: {type(exc).__name__}: {exc}")
            
            # Wait with exponential backoff and jitter
            if attempt < max_retries:
                sleep_time = delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                logger.info(f"Waiting {sleep_time:.2f} seconds before retrying Pocketbase authentication...")
                await asyncio.sleep(sleep_time)

        raise ConnectionError("Pocketbase admin authentication failed after max retries.")

    async def insert_raw_job(self, source: str, raw_payload: dict, payload_hash: str = None, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Inserts a raw job payload dictionary into the 'raw_jobs' Pocketbase collection.
        Sets default status to 'raw'.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        insert_url = f"{self.base_url}/api/collections/raw_jobs/records"
        record_data = {
            "source": source,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "raw_payload": raw_payload,
            "status": "raw"
        }
        if payload_hash:
            record_data["payload_hash"] = payload_hash

        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                logger.debug(f"Inserting {source} record into Pocketbase 'raw_jobs' (attempt {attempt}/{max_retries})...")
                response = await self.client.post(insert_url, json=record_data, headers=self.headers)

                # If unauthorized, try to re-authenticate (token might have expired)
                if response.status_code == 401 and self.email and self.password:
                    logger.warning("Pocketbase token expired/invalid. Re-authenticating...")
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    # Retry insert request
                    response = await self.client.post(insert_url, json=record_data, headers=self.headers)

                if response.status_code in (200, 201):
                    logger.debug(f"Successfully inserted {source} record into Pocketbase.")
                    return True
                else:
                    logger.error(f"Pocketbase record creation returned status {response.status_code}: {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase validation/client error: {response.text}")
            
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during record insertion: {type(exc).__name__}: {exc}")

            if attempt < max_retries:
                sleep_time = delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                logger.info(f"Waiting {sleep_time:.2f} seconds before retrying record insertion...")
                await asyncio.sleep(sleep_time)

        raise ConnectionError(f"Failed to insert raw job record for {source} after max retries.")

    async def fetch_raw_jobs(self, max_retries: int = 5, base_delay: float = 1.0) -> list:
        """
        Fetches all records from 'raw_jobs' collection using pagination.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        all_records = []
        page = 1
        per_page = 500

        while True:
            url = f"{self.base_url}/api/collections/raw_jobs/records?page={page}&perPage={per_page}"
            
            delay = base_delay
            success = False
            for attempt in range(1, max_retries + 1):
                try:
                    response = await self.client.get(url, headers=self.headers)
                    
                    if response.status_code == 401 and self.email and self.password:
                        await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                        response = await self.client.get(url, headers=self.headers)
                        
                    if response.status_code == 200:
                        data = ujson.loads(response.text)
                        items = data.get("items", [])
                        all_records.extend(items)
                        
                        total_pages = data.get("totalPages", 1)
                        if page >= total_pages or not items:
                            return all_records
                            
                        page += 1
                        success = True
                        break
                    else:
                        logger.error(f"Failed to fetch raw jobs page {page}: status {response.status_code} - {response.text}")
                        if 400 <= response.status_code < 500 and response.status_code != 401:
                            raise ValueError(f"Pocketbase client error: {response.text}")
                except (httpx.RequestError, httpx.TimeoutException) as exc:
                    logger.warning(f"Network error during fetch page {page}: {type(exc).__name__}: {exc}")
                    
                if attempt < max_retries:
                    await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
            
            if not success:
                raise ConnectionError(f"Failed to fetch raw jobs page {page} after max retries.")

    async def fetch_raw_jobs_page(self, page: int = 1, per_page: int = 50, filter_str: str = "", max_retries: int = 5, base_delay: float = 1.0) -> dict:
        """
        Fetches a page of records from 'raw_jobs' collection with optional filter.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/raw_jobs/records?page={page}&perPage={per_page}"
        if filter_str:
            # Pocketbase expects url encoded filters
            import urllib.parse
            encoded_filter = urllib.parse.quote(filter_str)
            url += f"&filter={encoded_filter}"
            
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.get(url, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.get(url, headers=self.headers)
                    
                if response.status_code == 200:
                    return ujson.loads(response.text)
                else:
                    logger.error(f"Failed to fetch raw jobs page: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during fetch page: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError("Failed to fetch raw jobs page after max retries.")

    async def update_raw_job(self, record_id: str, patch_data: dict, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Patches a record in the 'raw_jobs' collection.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/raw_jobs/records/{record_id}"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.patch(url, json=patch_data, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.patch(url, json=patch_data, headers=self.headers)
                    
                if response.status_code in (200, 204):
                    return True
                else:
                    logger.error(f"Failed to update raw job {record_id}: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during update: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError(f"Failed to update raw job {record_id} after max retries.")

    async def delete_raw_job(self, record_id: str, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Deletes a record from the 'raw_jobs' collection.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/raw_jobs/records/{record_id}"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.delete(url, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.delete(url, headers=self.headers)
                    
                if response.status_code in (200, 204):
                    return True
                else:
                    logger.error(f"Failed to delete raw job {record_id}: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during delete: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError(f"Failed to delete raw job {record_id} after max retries.")

    async def insert_raw_job_record(self, record_data: dict, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Inserts a pre-formatted record dictionary into the 'raw_jobs' collection.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/raw_jobs/records"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.post(url, json=record_data, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.post(url, json=record_data, headers=self.headers)
                    
                if response.status_code in (200, 201):
                    return True
                else:
                    logger.error(f"Failed to insert record: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during insert: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError("Failed to insert record after max retries.")

    async def job_listing_exists(self, raw_job_id: str) -> bool:
        """Checks if a job listing already exists for this raw_job_id to prevent duplicates."""
        if self.email and self.password and not self.token:
            await self.authenticate()

        url = f"{self.base_url}/api/collections/job_listings/records?filter=(raw_job_id='{raw_job_id}')"
        try:
            response = await self.client.get(url, headers=self.headers)
            if response.status_code == 200:
                data = ujson.loads(response.text)
                return len(data.get("items", [])) > 0
            return False
        except Exception as e:
            logger.warning(f"Error checking existence for raw_job_id {raw_job_id}: {e}")
            return False
    
    async def insert_job_listing(self, record_data: dict, max_retries: int = 5, base_delay: float = 1.0) -> str:
        """
        Inserts a clean job listing into the 'job_listings' collection and returns its generated ID.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/job_listings/records"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.post(url, json=record_data, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.post(url, json=record_data, headers=self.headers)
                    
                if response.status_code in (200, 201):
                    return ujson.loads(response.text)["id"]
                else:
                    logger.error(f"Failed to insert job listing: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during insert: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError("Failed to insert job listing after max retries.")

    async def update_job_listing(self, record_id: str, patch_data: dict, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Patches a record in the 'job_listings' collection.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/job_listings/records/{record_id}"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.patch(url, json=patch_data, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.patch(url, json=patch_data, headers=self.headers)
                    
                if response.status_code in (200, 204):
                    return True
                else:
                    logger.error(f"Failed to update job listing {record_id}: status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during update job listing: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError(f"Failed to update job listing {record_id} after max retries.")

    async def create_collection(self, collection_data: dict, max_retries: int = 5, base_delay: float = 1.0) -> bool:
        """
        Creates a collection in Pocketbase.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections"
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.post(url, json=collection_data, headers=self.headers)
                
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.post(url, json=collection_data, headers=self.headers)
                    
                if response.status_code in (200, 201):
                    logger.info(f"Successfully created collection '{collection_data.get('name')}'")
                    return True
                else:
                    logger.error(f"Failed to create collection '{collection_data.get('name')}': status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during collection creation: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError(f"Failed to create collection '{collection_data.get('name')}' after max retries.")


    async def fetch_all_payload_hashes(self, max_retries: int = 5, base_delay: float = 1.0) -> set:
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        hashes = set()
        page = 1
        per_page = 500

        while True:
            url = f"{self.base_url}/api/collections/job_listings/records?page={page}&perPage={per_page}&fields=payload_hash"
            
            delay = base_delay
            success = False
            for attempt in range(1, max_retries + 1):
                try:
                    response = await self.client.get(url, headers=self.headers)
                    if response.status_code == 401 and self.email and self.password:
                        await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                        response = await self.client.get(url, headers=self.headers)
                        
                    if response.status_code == 200:
                        data = ujson.loads(response.text)
                        items = data.get("items", [])
                        for item in items:
                            if h := item.get("payload_hash"):
                                hashes.add(h)
                            
                        total_pages = data.get("totalPages", 1)
                        if page >= total_pages or not items:
                            return hashes
                            
                        page += 1
                        success = True
                        break
                    else:
                        logger.error(f"Failed to fetch hashes page {page}: status {response.status_code} - {response.text}")
                        if 400 <= response.status_code < 500 and response.status_code != 401:
                            raise ValueError(f"Pocketbase client error: {response.text}")
                except (httpx.RequestError, httpx.TimeoutException) as exc:
                    logger.warning(f"Network error during fetch hashes page {page}: {type(exc).__name__}: {exc}")
                    
                if attempt < max_retries:
                    import asyncio
                    import random
                    await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
            
            if not success:
                raise ConnectionError(f"Failed to fetch hashes page {page} after max retries.")

    async def fetch_all_companies(self, max_retries: int = 5, base_delay: float = 1.0) -> dict[str, str]:
        """
        Queries the companies collection to retrieve an in-memory dictionary of
        existing company names (lowercase) and their corresponding unique Pocketbase record IDs.
        Uses paginated requests to ensure all entities are loaded when database grows.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        companies_dict = {}
        page = 1
        per_page = 500

        while True:
            url = f"{self.base_url}/api/collections/companies/records?page={page}&perPage={per_page}"
            
            delay = base_delay
            success = False
            for attempt in range(1, max_retries + 1):
                try:
                    response = await self.client.get(url, headers=self.headers)
                    if response.status_code == 401 and self.email and self.password:
                        await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                        response = await self.client.get(url, headers=self.headers)
                        
                    if response.status_code == 200:
                        data = ujson.loads(response.text)
                        items = data.get("items", [])
                        for item in items:
                            name_key = item["name"].lower().strip()
                            companies_dict[name_key] = item["id"]
                            
                        total_pages = data.get("totalPages", 1)
                        if page >= total_pages or not items:
                            return companies_dict
                            
                        page += 1
                        success = True
                        break
                    else:
                        logger.error(f"Failed to fetch companies page {page}: status {response.status_code} - {response.text}")
                        if 400 <= response.status_code < 500 and response.status_code != 401:
                            raise ValueError(f"Pocketbase client error: {response.text}")
                except (httpx.RequestError, httpx.TimeoutException) as exc:
                    logger.warning(f"Network error during fetch companies page {page}: {type(exc).__name__}: {exc}")
                    
                if attempt < max_retries:
                    await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
            
            if not success:
                raise ConnectionError(f"Failed to fetch companies page {page} after max retries.")

    async def insert_company(self, name: str, hq_location: str = None, max_retries: int = 5, base_delay: float = 1.0) -> str:
        """
        Provisions a new corporate entity in the companies collection and returns its generated ID.
        """
        if self.email and self.password and not self.token:
            await self.authenticate(max_retries=max_retries, base_delay=base_delay)

        url = f"{self.base_url}/api/collections/companies/records"
        record_data = {
            "name": name,
            "hq_location": hq_location or ""
        }
        
        delay = base_delay
        for attempt in range(1, max_retries + 1):
            try:
                response = await self.client.post(url, json=record_data, headers=self.headers)
                if response.status_code == 401 and self.email and self.password:
                    await self.authenticate(max_retries=max_retries, base_delay=base_delay)
                    response = await self.client.post(url, json=record_data, headers=self.headers)
                    
                if response.status_code in (200, 201):
                    return ujson.loads(response.text)["id"]
                else:
                    logger.error(f"Failed to insert company '{name}': status {response.status_code} - {response.text}")
                    if 400 <= response.status_code < 500 and response.status_code != 401:
                        raise ValueError(f"Pocketbase client error: {response.text}")
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                logger.warning(f"Network error during insert company: {type(exc).__name__}: {exc}")
                
            if attempt < max_retries:
                await asyncio.sleep(delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5))
                
        raise ConnectionError(f"Failed to insert company '{name}' after max retries.")
