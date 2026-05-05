import { input, confirm } from "@inquirer/prompts";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const MODEL = "llama3";
const GENERATE_URL = `${OLLAMA_BASE_URL}/api/generate`;

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

function sectionHeader(title: string): void {
  const line = "─".repeat(60);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m  ${title}\x1b[0m`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
}

function info(msg: string): void {
  console.log(`\x1b[90m› ${msg}\x1b[0m`);
}

function success(msg: string): void {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

function warn(msg: string): void {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

function error(msg: string): void {
  console.log(`\x1b[31m✖ ${msg}\x1b[0m`);
}

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

async function callOllama(prompt: string, system?: string): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt,
    stream: false,
  };

  if (system) {
    body.system = system;
  }

  const res = await fetch(GENERATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Ollama API error (${res.status}): ${text}`
    );
  }

  const data = (await res.json()) as OllamaGenerateResponse;
  return data.response;
}

// Try to extract a JSON array from LLM output, handling markdown fences and extra text
function parseJsonArray(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* not plain JSON */ }

  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* bad fence content */ }
  }

  const bracketStart = raw.indexOf("[");
  const bracketEnd = raw.lastIndexOf("]");
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    try {
      const parsed = JSON.parse(raw.slice(bracketStart, bracketEnd + 1));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* give up */ }
  }

  return null;
}

async function collectInitialInput(): Promise<string> {
  sectionHeader("📝  What did you do today?");

  const answer = await input({
    message: "Describe what you worked on today:",
    validate: (val) =>
      val.trim().length > 0 || "Please provide at least a brief description.",
  });

  return answer.trim();
}

async function generateFollowUpQuestions(
  initialInput: string
): Promise<string[]> {
  sectionHeader("🤖  Generating follow-up questions...");
  info("Sending your input to the local LLM. This may take a moment...\n");

  const systemPrompt = `You are a senior tech-focused interviewer preparing content for a LinkedIn post. 
Your job is to ask exactly 3 specific follow-up questions that will extract:
  - Deeper technical details about what was done
  - Challenges encountered and how they were solved
  - Key lessons learned or insights gained

Rules:
  - Return ONLY a JSON array of 3 strings. No preamble, no explanation.
  - Each string is one question.
  - Questions should be open-ended and encourage detailed answers.
  - Focus on the technical substance, not generic fluff.

Example output:
["What specific technical approach did you use and why?", "What was the biggest challenge you faced and how did you overcome it?", "What key takeaway would you share with other developers?"]`;

  const prompt = `Here is what someone did today:\n\n"${initialInput}"\n\nGenerate exactly 3 follow-up questions as a JSON array of strings.`;

  const raw = await callOllama(prompt, systemPrompt);
  const questions = parseJsonArray(raw);

  if (!questions || questions.length === 0) {
    warn(
      "Could not parse questions from the LLM response. Using fallback questions."
    );
    warn(`Raw LLM response was:\n${raw}\n`);
    return [
      "Can you go deeper into the technical approach you used and why you chose it?",
      "What was the most challenging part, and how did you work through it?",
      "What's the biggest lesson or insight you'd want to share with other developers?",
    ];
  }

  const finalQuestions = questions.slice(0, 3);
  while (finalQuestions.length < 3) {
    finalQuestions.push(
      "Is there anything else technically interesting you'd like to highlight?"
    );
  }

  success("Follow-up questions generated!\n");
  return finalQuestions;
}

async function conductQA(questions: string[]): Promise<string[]> {
  sectionHeader("💬  Tell us more!");

  const answers: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const answer = await input({
      message: `Q${i + 1}: ${questions[i]}`,
      validate: (val) =>
        val.trim().length > 0 || "Please provide an answer to continue.",
    });
    answers.push(answer.trim());
    console.log();
  }

  success("All answers collected!\n");
  return answers;
}

async function collectMedia(): Promise<string[]> {
  sectionHeader("🖼️  Media Collection");

  const wantsMedia = await confirm({
    message: "Do you want to attach any images or videos?",
    default: false,
  });

  if (!wantsMedia) {
    info("No media attached. Moving on...\n");
    return [];
  }

  const pathsRaw = await input({
    message:
      "Enter the absolute file path(s) — separate multiple paths with commas:",
    validate: (val) =>
      val.trim().length > 0 || "Please enter at least one file path, or press Ctrl+C to skip.",
  });

  const paths = pathsRaw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => resolve(p));

  const validPaths: string[] = [];

  for (const filePath of paths) {
    if (existsSync(filePath)) {
      validPaths.push(filePath);
      success(`Found: ${filePath}`);
    } else {
      warn(`File not found (skipping): ${filePath}`);
    }
  }

  if (validPaths.length === 0) {
    warn("No valid media files found. Continuing without media.\n");
  } else {
    success(`${validPaths.length} media file(s) ready to attach.\n`);
  }

  return validPaths;
}

async function generateLinkedInPost(
  initialInput: string,
  questions: string[],
  answers: string[]
): Promise<string> {
  sectionHeader("✍️  Generating your LinkedIn post...");
  info("Crafting your post with the local LLM. Hang tight...\n");

  const systemPrompt = `You are a world-class LinkedIn copywriter who specializes in posts for software developers and tech professionals.

Your writing style:
  - Authentic, conversational, and relatable — like talking to a smart friend
  - Uses short paragraphs and line breaks for readability
  - Includes a compelling hook in the first line to stop the scroll
  - Weaves in technical substance without being dry
  - Ends with a question or call-to-action to drive engagement
  - Uses 2-3 relevant hashtags at the end

Rules:
  - Do NOT use excessive buzzwords like "revolutionize", "game-changer", "synergy", etc.
  - Do NOT use emojis on every line — 2-4 total is fine
  - Do NOT start with "I'm excited to announce..."
  - Keep it between 150-300 words
  - Write ONLY the post content. No preamble like "Here's your post:" — just the post itself.`;

  const contextParts = [
    `## What they did today:\n${initialInput}`,
    ...questions.map(
      (q, i) => `## Follow-up Q${i + 1}: ${q}\nAnswer: ${answers[i]}`
    ),
  ];

  const prompt = `Using the following context about someone's day, write an engaging LinkedIn post:\n\n${contextParts.join("\n\n")}`;

  const post = await callOllama(prompt, systemPrompt);
  return post.trim();
}

function saveOutput(
  post: string,
  mediaFiles: string[]
): string {
  sectionHeader("📁  Saving Output");

  const projectRoot = resolve(import.meta.dirname, "..");
  const outputBase = join(projectRoot, "output");
  const sessionDir = join(outputBase, `post_${getTimestamp()}`);

  mkdirSync(sessionDir, { recursive: true });
  success(`Created session directory: ${sessionDir}`);

  const postPath = join(sessionDir, "t.txt");
  writeFileSync(postPath, post, "utf-8");
  success(`Saved post to: ${postPath}`);

  if (mediaFiles.length > 0) {
    info("Copying media files...");
    for (const srcPath of mediaFiles) {
      const destPath = join(sessionDir, basename(srcPath));
      try {
        copyFileSync(srcPath, destPath);
        success(`Copied: ${basename(srcPath)}`);
      } catch (err) {
        warn(
          `Failed to copy ${basename(srcPath)}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return sessionDir;
}

async function main(): Promise<void> {
  console.clear();
  console.log(
    "\x1b[1m\x1b[35m" +
      `
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║     🚀  LinkedIn Post Pipeline                   ║
  ║     ─────────────────────────────                ║
  ║     Powered by local LLM via Ollama              ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
` +
      "\x1b[0m"
  );

  try {
    info("Checking Ollama server connectivity...");
    try {
      const healthCheck = await fetch(OLLAMA_BASE_URL, {
        signal: AbortSignal.timeout(5000),
      });
      if (!healthCheck.ok) throw new Error(`Status ${healthCheck.status}`);
      success("Ollama server is running!\n");
    } catch {
      error(
        `Cannot reach Ollama at ${OLLAMA_BASE_URL}. Make sure it's running ("ollama serve").`
      );
      process.exit(1);
    }

    const initialInput = await collectInitialInput();
    const questions = await generateFollowUpQuestions(initialInput);
    const answers = await conductQA(questions);
    const mediaFiles = await collectMedia();
    const post = await generateLinkedInPost(initialInput, questions, answers);
    const outputDir = saveOutput(post, mediaFiles);

    sectionHeader("🎉  Your LinkedIn Post");
    console.log(post);
    console.log(
      `\n\x1b[90m${"─".repeat(60)}\x1b[0m`
    );
    success(`All files saved to: ${outputDir}`);
    console.log();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("User force closed") ||
        err.message.includes("ExitPromptError"))
    ) {
      console.log("\n");
      info("Pipeline cancelled by user. Goodbye! 👋\n");
      process.exit(0);
    }

    error(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
