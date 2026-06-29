# Permissive Cloudflare Worker CORS Proxy

This directory contains the code to set up a private CORS proxy on Cloudflare Workers. It resolves browser CORS limitations when performing client-side job scrapes and RSS feed parsing.

## 1-Click Deployment Guide

Follow these steps to deploy your proxy in 2 minutes:

1. Sign up for a free [Cloudflare Account](https://dash.cloudflare.com) if you don't have one.
2. Navigate to **Workers & Pages** -> **Overview** in the sidebar.
3. Click **Create Application**, select **Create Worker**.
4. Give your worker a name (e.g. `job-search-cors-proxy`), and click **Deploy**.
5. Once deployed, click **Edit Code**.
6. Copy the contents of [worker.js](file:///c:/job_search_project/cors-proxy/worker.js) and paste it into the editor (overwriting the default hello-world script).
7. Click **Save and Deploy**.
8. Note the URL of your deployed worker (e.g. `https://job-search-cors-proxy.<subdomain>.workers.dev`).

## Configuring in PWA

1. Copy your Worker URL.
2. In the dashboard, click **Settings** -> **Edit Setup Parameters** (or during the initial run).
3. Paste the URL into the **Custom CORS Proxy URL** input field (be sure to include `/?url=` at the end, e.g. `https://my-proxy.workers.dev/?url=`).
4. Click **Complete Setup** to save.
