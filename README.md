# FlowCraft - AI-Powered App Builder

Describe an app in natural language and FlowCraft generates a working Flutter application.

## Architecture

- **AI agents never generate source code directly** — they only produce a structured `AppState` model
- Flutter code is generated **deterministically** from `AppState` using a template-based code generator

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env   # Add your OpenAI API key
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | React + Vite + TypeScript + Tailwind |
| Backend   | Node.js + Express + TypeScript      |
| AI        | OpenAI GPT-4 (Structured Output)    |
| Validation| Zod                                 |
| Templates | Handlebars                          |
| Preview   | DartPad embed                       |
