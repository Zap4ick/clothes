# 👗 AI Clothing Consultant

Version 0.0.14

A CLI tool that suggests outfits from your wardrobe using either Google Sheets or local wardrobe files as a clothes database and a local LLM.

## Features

- Reads your wardrobe from Google Sheets or local wardrobe files (tabs: Shoes, Tops, Pants)
- Fetches live weather forecast automatically based on your location
- Uses your personal style preferences as context
- Interactive multi-turn chat — ask follow-up questions naturally
- Runs fully locally via LM Studio or other local AI endpoint (no cloud AI costs)
- Saves the latest assistant suggestion to `output/suggestions.md` only for suggestion-style answers (not casual conversation)

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [LM Studio](https://lmstudio.ai/) with a model downloaded and the local server running
- If you use Google Sheets: a Google Cloud project with the **Google Sheets API** enabled and a Google Sheet with your wardrobe
- If you use local files: a `wardrobe/` folder with CSV/XLS files or a `wardrobe.xlsx` workbook

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Choose Your Wardrobe Source

#### Option A: Google Sheets

Your sheet should have three tabs: **Shoes**, **Tops**, **Pants**, **Accessories**.  
Each tab has a header row with columns: `name | type | color | condition | fit | notes`

Example:
| name | type | color | condition | fit | notes |
|------|------|-------|-----------|-----|-------|
| White Oxford Shirt | button-up | white | good | slim | slim fit |
| Navy Chinos | trousers | navy | okay | regular | |

#### Option B: Local Files

Set `WARDROBE_SOURCE=local` in `.env` to use local files instead of Google Sheets.

Supported layouts:

- A single `wardrobe/wardrobe.xlsx` or `wardrobe/wardrobe.xls` file with **Shoes**, **Tops**, **Pants** sheets
- Separate `wardrobe/Shoes.csv` or `wardrobe/Shoes.xlsx`, `wardrobe/Tops.csv` or `wardrobe/Tops.xlsx`, and `wardrobe/Pants.csv` or `wardrobe/Pants.xlsx`

Local files use the same columns as Google Sheets: `name | type | color | condition | fit | notes`

### 3. Option A: LM Studio

1. Download a model (e.g. `gemma-4-e4b`, `llama-3.1-8b-instruct`)
2. Go to the **Developer** tab → load the model → click **Start Server**
3. Note the model name shown in the UI

Any openai-compatible endpoint will do.

### 3. Option B: Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → enable **Google Sheets API**
3. Create a **Service Account** → generate a **JSON key**
4. Save the key as `credentials/service-account.json`
5. Share your Google Sheet with the service account email (Viewer access)

Only local or only external endpoint can be used.

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`. LM Studio is the default — no model name needed:

```env
# Local AI (default — LM Studio, Ollama, llama.cpp, etc.)
LOCAL_AI_BASE_URL=http://localhost:1234/v1
# LOCAL_AI_BASE_URLS=http://192.168.0.36:1234/v1,http://localhost:1234/v1
# LOCAL_AI_MODEL=google/gemma-4-e4b   # optional: pin a specific model
# AI_AVAILABILITY_TIMEOUT_MS=12000      # model availability checks (startup + ask)
# AI_RESPONSE_TIMEOUT_MS=45000          # full model response timeout
# AI_TIMEOUT_MS=45000                   # legacy fallback for both values

# External endpoint (optional fallback after local endpoints)
# EXTERNAL_AI_BASE_URL=https://models.inference.ai.azure.com
# EXTERNAL_AI_BASE_URLS=https://models1.example.com/v1,https://models2.example.com/v1
# EXTERNAL_AI_API_KEY=your_api_key_here
# EXTERNAL_AI_MODEL=gpt-4o

SHEET_ID=your_google_sheet_id_here
GOOGLE_CREDENTIALS_PATH=./credentials/service-account.json
```

When `EXTERNAL_AI_BASE_URL` is set, the app still tries local endpoints first and then falls back to the external ones if local requests fail. Works with any OpenAI-compatible API: OpenAI, GitHub Models, Ollama, etc.

### 5. Style preferences

Copy `style-preferences.template.md` to `style-preferences.md` and edit the copy to describe your personal style — the AI uses this as context for every suggestion. The local `style-preferences.md` file is gitignored so your personal notes stay private.

## Usage

Make sure LM Studio's local server is running, then:

```bash
npm start
```

For a one-shot request (single command, no interactive prompt):

```bash
npm start -- "what should I wear in Gdansk tomorrow?"
```

On startup the app will:

- Load your wardrobe from the configured source
- Fetch today's and tomorrow's weather forecast
- Start an interactive chat session

After suggestion-style assistant responses, the app overwrites `output/suggestions.md` with the latest suggestion and logs where it was saved.

**Example prompts:**

- `what should I wear today?`
- `suggest something for a casual dinner tonight`
- `what about tomorrow? it's a job interview`
- `something warmer, it's cold outside`

Type `exit` or press `Ctrl+C` to quit.

## Project Structure

```
clothes/
├── src/
│   ├── index.ts              # Entry point & chat loop
│   ├── sheets.ts             # Google Sheets wardrobe reader
│   ├── local-reader.ts       # Local wardrobe file reader
│   ├── ai.ts                 # LM Studio client
│   ├── prompts.ts            # System prompt builder
│   └── weather.ts            # Weather forecast fetcher
├── style-preferences.template.md # Starter template for your personal style notes
├── style-preferences.md      # Your local personal style notes (gitignored)
├── credentials/              # service-account.json (gitignored)
├── .env                      # Your config (gitignored)
├── .env.example              # Config template
├── package.json
└── tsconfig.json
```
