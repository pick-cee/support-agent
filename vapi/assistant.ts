import type { Vapi } from "@vapi-ai/server-sdk";

import { FIRST_MESSAGE, SPOKEN } from "../src/app/copy";
import { CALL_MAX_DURATION_S, CALL_SILENCE_TIMEOUT_S, VAPI_LLM_TIMEOUT_S } from "../src/lib/constants";

// The whole Vapi assistant, as code (DESIGN §12.1). npm run vapi:sync creates
// or updates it by name; the dashboard is for looking, not editing. Field
// names come from @vapi-ai/server-sdk's types, never guessed.

// Named by Akin (2026-09-29) so it never collides with the account's existing
// "RelayPay Support" assistant, which sync leaves untouched.
export const ASSISTANT_NAME = "Akin's RelayPay Support Agent";

/**
 * Vapi matches end-call phrases against its transcription of the assistant's
 * own audio, not the text we sent: "Goodbye, and thanks for calling RelayPay."
 * came back as "Goodbye. And, uh, thanks for calling RelayPay." and never
 * matched, so calls did not end (2026-09-30). The tail survives transcription.
 */
export const END_CALL_PHRASE = "thanks for calling RelayPay";

// Deepgram key terms, so the names and references callers say survive transcription.
const KEY_TERMS = ["RelayPay", "LagosLedger", "NairobiOps", "AccraStack", "CapeCloud", "KigaliWorks", "TXN", "payout", "KYC"];

export function assistantConfig(input: { baseUrl: string; llmToken: string; serverToken: string }): Vapi.CreateAssistantDto {
  return {
    name: ASSISTANT_NAME,
    firstMessage: FIRST_MESSAGE,
    firstMessageMode: "assistant-speaks-first",
    // Our server is the model. Vapi uses url as the OpenAI client's base URL
    // and calls /chat/completions under it; any other path lands in
    // /api/vapi/[...path] and raises an alert naming it.
    model: {
      provider: "custom-llm",
      url: `${input.baseUrl}/api/vapi`,
      model: "relaypay-support-agent",
      metadataSendMode: "variable",
      timeoutSeconds: VAPI_LLM_TIMEOUT_S,
    },
    // How Vapi authenticates to us; the model's headers option cannot override Authorization.
    credentials: [{ provider: "custom-llm", apiKey: input.llmToken, name: "relaypay-custom-llm" }],
    transcriber: { provider: "deepgram", model: "nova-3", language: "en", keyterm: KEY_TERMS },
    // Chosen in Phase 6 by listening to it say "RelayPay", "T X N 9 0 0 1" and "Lagos time".
    voice: { provider: "vapi", voiceId: "Elliot" },
    server: {
      url: `${input.baseUrl}/api/vapi/events`,
      headers: { Authorization: `Bearer ${input.serverToken}` },
      timeoutSeconds: 20,
    },
    serverMessages: ["status-update", "end-of-call-report", "hang"],
    // The page's live transcript: the caller's words from "transcript", the
    // assistant's exact words from "voice-input" (the text sent to the voice,
    // not a transcription of the audio).
    clientMessages: ["transcript", "voice-input", "status-update", "speech-update"],
    maxDurationSeconds: CALL_MAX_DURATION_S,
    // The closing line code appends to every closing reply: saying it ends the call.
    endCallPhrases: [END_CALL_PHRASE],
    // silenceTimeoutSeconds is a hook in this SDK version (DESIGN §20).
    hooks: [
      {
        on: "customer.speech.timeout",
        options: { timeoutSeconds: CALL_SILENCE_TIMEOUT_S, triggerMaxCount: 1 },
        do: [
          { type: "say", exact: SPOKEN.silenceGoodbye },
          { type: "tool", tool: { type: "endCall" } },
        ],
      },
    ],
    // We keep text records. Recordings of callers are more sensitive than this needs.
    artifactPlan: { recordingEnabled: false },
    // We write our own summary in code (DESIGN §11), with no extra model.
    analysisPlan: { summaryPlan: { enabled: false }, successEvaluationPlan: { enabled: false }, structuredDataPlan: { enabled: false } },
  };
}
