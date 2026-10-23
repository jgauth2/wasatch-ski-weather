# Wasatch Ski Weather — Direct & Serverless Architecture (No Google Sheet!)

This bundle upgrades **Wasatch Ski Weather** to eliminate the Google Sheet middleman, move public National Weather Service (NWS) requests directly into the browser, and add full support, filtering, and sorting for **all 8 Wasatch resorts + Spruces** (**Alta**, **Snowbird**, **Brighton**, **Solitude**, **Park City**, **Deer Valley**, **Snowbasin**, **Powder Mountain**, and **Spruces**).

## What Changed

1. **Zero Google Sheet Dependency**:
   - The frontend (`index.html`) now queries `api.weather.gov` directly from the browser for the **Salt Lake Valley Forecast**, **Active Weather Alerts**, and the **24h / 48h / 72h Resort Snowfall Forecasts** across all 8 resorts + Spruces.
   - Non-CORS sources (SnowObs Weather Stations, Ski Utah Resort Reports & Webcams, UAC Avalanche Advisory, UDOT 511 Road Conditions & Signs, TUNA/MTF XC Grooming, and Wasatch Weather Weenies + Gemini AI Summary) are handled by a single stateless Netlify Function (`netlify/functions/api.js`) with a 15-minute memory & CDN cache.

2. **Full Coverage for Deer Valley, Snowbird, Brighton, & Powder Mountain**:
   - **Mountain Conditions & Telemetry**: Base and Summit temperature, wind speed/direction/gusts, 24h snowfall, and base snow depth for all 8 resorts + Spruces, with automatic Ski Utah resort report supplementation in blue when a sensor goes offline.
   - **Mountain Forecast & Triple-Barrel Snowfall (24h / 48h / 72h)**: Combines the NWS Avalanche Weather Guidance (AVG) and live NWS gridpoint 24h/48h/72h snowfall accumulation ranges for every resort.
   - **Resort Webcams & Snow Stakes**: Live snow stake and mountain webcams for all 8 resorts, filtered dynamically when you select a resort or canyon.
   - **Road Conditions & Parking**: Added **SR-158 (Powder Mountain Rd)** and **SR-224 (Park City / Deer Valley)** alongside **SR-190 (BCC)**, **SR-210 (LCC)**, and **I-80 (Parleys Canyon)**, plus complete 2025/2026 parking reservation and carpool rules for all resorts (including Powder Mountain's $12 weekend/holiday lot system and 3+ carpool rule).

3. **Interactive Resort Filter & Sort Controls**:
   - **Filter by Region**: *All Wasatch*, *Little Cottonwood (LCC)*, *Big Cottonwood (BCC)*, *Park City Area*, or *Ogden Valley*.
   - **Filter by Specific Resort**: Click any resort pill (*Alta*, *Snowbird*, *Brighton*, *Solitude*, *Spruces*, *Park City*, *Deer Valley*, *Snowbasin*, *Powder Mountain*) to focus on specific mountains.
   - **Sort By**: *Most 24h Snowfall*, *Most 48h Forecast Snow*, *Most 72h Forecast Snow*, *Deepest Base Depth*, *Coldest Summit Temp*, *Calmest Summit Wind*, or *Default Canyon Order*.

## How to Deploy on Netlify

1. Drop the contents of this folder (`index.html`, `logo.png`, `netlify.toml`, and `netlify/functions/api.js`) into your Netlify repository or drag-and-drop the folder into Netlify.
2. In your Netlify dashboard under **Site Configuration → Environment Variables**, add:
   - `GEMINI_API_KEY`: Your Google Gemini API key (so your key is never exposed in public code).
   - `UDOT_API_KEY`: *(Optional)* Your UDOT 511 key (already defaults to your existing key if omitted).
3. You can safely delete or archive the old Google Sheet and disable its Apps Script triggers!
