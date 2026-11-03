/**
 * Taak-specifieke modelkeuze: het zwaarste redeneerwerk krijgt het sterkste model,
 * korte/structurele taken het snellere en goedkopere model.
 */
export type AiTask = "notes" | "chat" | "actions" | "title" | "speakers";

export type AiProviderMode = "openai" | "anthropic" | "auto";

export type ResolvedRoute =
  | { provider: "openai"; model: string }
  | { provider: "anthropic"; model: string };

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

/** Standaardmodellen (overschrijfbaar via env per taak). */
const OPENAI_DEFAULTS: Record<AiTask, string> = {
  /** Lang verslag + JSON — sterk multimodaal model */
  notes: env("OPENAI_MODEL_NOTES", "gpt-4o"),
  chat: env("OPENAI_MODEL_CHAT", "gpt-4o"),
  actions: env("OPENAI_MODEL_ACTIONS", "gpt-4o-mini"),
  title: env("OPENAI_MODEL_TITLE", "gpt-4o-mini"),
  /** Namen aan sprekers koppelen — fouten vervuilen stemprofielen, dus sterk model */
  speakers: env("OPENAI_MODEL_SPEAKERS", "gpt-4o"),
};

const ANTHROPIC_DEFAULTS: Record<AiTask, string> = {
  /** Lang verslag + JSON — Sonnet (streaming, snelle feedback) */
  notes: env("ANTHROPIC_MODEL_NOTES", "claude-sonnet-4-6"),
  /** Snelle, nauwkeurige dialoog — Sonnet */
  chat: env("ANTHROPIC_MODEL_CHAT", "claude-sonnet-4-6"),
  /** JSON / extractie — Haiku (snel, goedkoop) */
  actions: env("ANTHROPIC_MODEL_ACTIONS", "claude-haiku-4-5"),
  title: env("ANTHROPIC_MODEL_TITLE", "claude-haiku-4-5"),
  /** Namen aan sprekers koppelen — fouten vervuilen stemprofielen, dus Sonnet */
  speakers: env("ANTHROPIC_MODEL_SPEAKERS", "claude-sonnet-4-6"),
};

function mode(): AiProviderMode {
  const m = (process.env.AI_PROVIDER || "auto").toLowerCase();
  if (m === "openai" || m === "anthropic" || m === "auto") return m;
  return "auto";
}

export function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Bepaalt welke provider + model voor een taak.
 * - `auto`: kiest per taak het beste beschikbare (Anthropic voor tekst als sleutel aanwezig is, anders OpenAI).
 * - `openai` / `anthropic`: dwingt die provider voor alle teksttaken.
 */
export function resolveRoute(task: AiTask): ResolvedRoute {
  const m = mode();
  const openai = hasOpenAiKey();
  const anthropic = hasAnthropicKey();

  const pickOpenAi = (): ResolvedRoute => {
    if (!openai) {
      throw new Error(
        "OPENAI_API_KEY ontbreekt. Zet de sleutel in .env of kies AI_PROVIDER=anthropic als je alleen Anthropic gebruikt."
      );
    }
    return { provider: "openai", model: OPENAI_DEFAULTS[task] };
  };

  const pickAnthropic = (): ResolvedRoute => {
    if (!anthropic) {
      throw new Error(
        "ANTHROPIC_API_KEY ontbreekt. Zet de sleutel in .env of gebruik AI_PROVIDER=openai."
      );
    }
    return { provider: "anthropic", model: ANTHROPIC_DEFAULTS[task] };
  };

  if (m === "openai") return pickOpenAi();
  if (m === "anthropic") return pickAnthropic();

  /* auto */
  if (anthropic) return pickAnthropic();
  if (openai) return pickOpenAi();

  throw new Error(
    "Geen AI-sleutel: zet minimaal ANTHROPIC_API_KEY of OPENAI_API_KEY in .env (voor transcriptie is ook OPENAI nodig — Whisper)."
  );
}
