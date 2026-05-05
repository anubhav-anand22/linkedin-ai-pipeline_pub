# LinkedIn Post Pipeline

A CLI tool that helps you write LinkedIn posts using a local Ollama LLM. It asks you about your day, generates follow-up questions to dig deeper, and drafts a post from your answers. Everything runs locally — nothing leaves your machine.

## Setup

### Prerequisites

- Node.js >= 18
- [Ollama](https://ollama.com/) installed and running

### Install Ollama and pull a model

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the default model
ollama pull llama3

# Start the server (keep this running)
ollama serve
```

### Install and build

```bash
git clone <your-repo-url>
cd linkdin-pipeline
npm install
npm run build
```

## Usage

```bash
npm start

# or build + run in one step
npm run dev
```

The CLI walks you through:

1. Describing what you worked on
2. Answering 3 AI-generated follow-up questions
3. Optionally attaching media files
4. Reviewing the generated post

Output goes to `output/post_YYYYMMDD_HHMMSS/` with the post text (`t.txt`) and any attached media.

## Configuration

Edit the constants at the top of `src/index.ts`:

```typescript
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const MODEL = "llama3"; // change to whatever model you have pulled
```

Rebuild after changes: `npm run build`

## Project Structure

```
├── src/
│   └── index.ts      # main CLI app
├── output/            # generated posts (gitignored)
├── dist/              # compiled JS (gitignored)
├── package.json
└── tsconfig.json
```
