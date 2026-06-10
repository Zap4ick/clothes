# 👗 AI Clothing Consultant

Version 0.0.5

A CLI tool that suggests outfits from your wardrobe using your Google Sheets as a clothes database and a local LLM via LM Studio.

## Features

- Reads your wardrobe from a Google Sheet (tabs: Shoes, Tops, Pants)
- Fetches live weather forecast automatically based on your location
- Uses your personal style preferences as context
- Interactive multi-turn chat — ask follow-up questions naturally
- Runs fully locally via LM Studio (no cloud AI costs)
- Saves the latest assistant suggestion to `output/suggestions.md` on every request

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [LM Studio](https://lmstudio.ai/) with a model downloaded and the local server running
- A Google Cloud project with the **Google Sheets API** enabled
- A Google Sheet with your wardrobe (see structure below)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Google Sheets

Your sheet should have three tabs: **Shoes**, **Tops**, **Pants**.  
Each tab has a header row with columns: `name | type | color | notes`

Example:
| name | type | color | notes |
|------|------|-------|-------|
| White Oxford Shirt | button-up | white | slim fit |
| Navy Chinos | trousers | navy | |

### 3. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → enable **Google Sheets API**
3. Create a **Service Account** → generate a **JSON key**
4. Save the key as `credentials/service-account.json`
5. Share your Google Sheet with the service account email (Viewer access)

### 4. LM Studio

1. Download a model (e.g. `gemma-4-e4b`, `llama-3.1-8b-instruct`)
2. Go to the **Developer** tab → load the model → click **Start Server**
3. Note the model name shown in the UI

### 5. Configure environment

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

### 6. Style preferences

Edit `style-preferences.md` to describe your personal style — the AI uses this as context for every suggestion. Write it in plain language, as detailed or brief as you like.

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

- Load your wardrobe from Google Sheets
- Fetch today's and tomorrow's weather forecast
- Start an interactive chat session

After every assistant response, the app overwrites `output/suggestions.md` with the latest suggestion and logs where it was saved.

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
│   ├── sheets.ts             # Google Sheets reader
│   ├── ai.ts                 # LM Studio client
│   ├── prompts.ts            # System prompt builder
│   └── weather.ts            # Weather forecast fetcher
├── style-preferences.md      # Your personal style notes
├── credentials/              # service-account.json (gitignored)
├── .env                      # Your config (gitignored)
├── .env.example              # Config template
├── package.json
└── tsconfig.json
```
