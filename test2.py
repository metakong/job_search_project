import urllib.request, json, urllib.parse
filter_str = urllib.parse.quote("location_type='hybrid' || location_type='on_site'")
url = f'http://127.0.0.1:8090/api/collections/job_listings/records?perPage=50&fields=title,location_type,days_since_posted,recency_multiplier&filter={filter_str}'
req = urllib.request.Request(url)
req.add_header('User-Agent', 'Mozilla/5.0')
resp = urllib.request.urlopen(req).read()
print(json.dumps(json.loads(resp), indent=2))
