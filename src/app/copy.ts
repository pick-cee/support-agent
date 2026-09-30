// Every string a person hears or reads lives here (CLAUDE.md). No em dashes:
// toSpeech() strips them from model text, and these are written without them.

// ---------------------------------------------------------------------------
// Spoken
// ---------------------------------------------------------------------------

export const FIRST_MESSAGE = "Hi, this is RelayPay support. I'm an AI assistant. How can I help today?";

/** Spoken at most once per turn while the agent works. It never claims anything. */
export const FILLER_PHRASES = ["One moment while I check that.", "Just a moment while I check that."] as const;

// A fallback may only offer what the system can do at that moment. When the
// agent itself is failing, it cannot take details for a callback, so those
// lines point to the dashboard, which the knowledge base names as the official
// support channel; the call is still recorded and a failed call opens a ticket.
export const SPOKEN = {
  didNotCatch: "Sorry, I didn't catch that. Could you say it again?",
  systemTrouble: "I'm having trouble reaching our systems right now. Please try again in a few minutes, or use the support options in your RelayPay dashboard.",
  databaseDown: "I can't reach our systems right now. Please try again shortly, or use the support options in your RelayPay dashboard.",
  busy: "Our support line is very busy right now. Please try again a little later, or use the support options in your RelayPay dashboard.",
  tooManyTurns: "We've covered a lot on this call. To make sure nothing gets missed, please continue through the support options in your RelayPay dashboard.",
  fallbackDecline: "I can't answer that confidently. I can arrange for a specialist to follow up, or you can use the support options in your RelayPay dashboard.",
  fallbackClarify: "Could you tell me a little more about what you need help with?",
  fallbackLookup: "I couldn't confirm the details of that record just now. Could you read me the reference again?",
  fallbackEscalate: "A specialist needs to help with this. Could I take your name so they can follow up?",
  fallbackCollect: "Sorry, could you say that once more for me?",
  // The sentences code writes from a tool result (DESIGN §6.4).
  staleEta: (arrival: string, statusPhrase: string) => `The record showed an estimated arrival of ${arrival}, which has passed, and it's still ${statusPhrase}.`,
  stalePayout: (scheduled: string, statusPhrase: string) => `The payout was scheduled for ${scheduled}, which has passed, and it's still ${statusPhrase}.`,
  ticketOpened: (reference: string) => `I've opened a ticket for this. Your reference is ${reference}.`,
  callbackBooked: (when: string) => `A specialist will call you on ${when}. You'll get a confirmation email from our booking system.`,
  callbackByEmail: "A specialist will email you to arrange a time.",
  escalatedAlready: "Your case is with a specialist, who will cover this with you.",
  /** Appended by code to every closing reply, and listed in the assistant's endCallPhrases, so the call ends on it. */
  goodbye: "Goodbye, and thanks for calling RelayPay.",
  /** Said by Vapi after CALL_SILENCE_TIMEOUT_S of silence, before it ends the call. */
  silenceGoodbye: "I haven't heard anything for a while, so I'll end the call now. You can call back any time.",
} as const;

/**
 * Typed messages on the page (DESIGN §13). Only the lines whose voice wording
 * would be wrong on screen differ; everything else is the same sentence. The
 * turn runner swaps each voice line for its text version.
 */
export const TYPED = {
  greeting: "Hi, I'm RelayPay's AI support assistant. Ask me about payments, payouts, invoices or your account.",
  didNotCatch: "Please type your question and I'll take a look.",
  fallbackCollect: "Sorry, could you type that once more for me?",
  tooManyTurns: "We've covered a lot in this conversation. To make sure nothing gets missed, please continue through the support options in your RelayPay dashboard.",
  goodbye: "Thanks for contacting RelayPay support.",
} as const;

export const VOICE_TO_TYPED: [string, string][] = [
  [SPOKEN.didNotCatch, TYPED.didNotCatch],
  [SPOKEN.fallbackCollect, TYPED.fallbackCollect],
  [SPOKEN.tooManyTurns, TYPED.tooManyTurns],
  [SPOKEN.goodbye, TYPED.goodbye],
];

/** How each unfinished status reads inside the stale-estimate sentence. */
export const STATUS_PHRASES: Record<string, string> = {
  processing: "processing",
  delayed: "marked as delayed",
  scheduled: "scheduled",
  "review required": "under review",
};

// ---------------------------------------------------------------------------
// The web voice page (DESIGN §13)
// ---------------------------------------------------------------------------

export const PAGE = {
  title: "RelayPay Support",
  description: "Talk to RelayPay's AI support assistant, or type your question, about payments, payouts, invoices or your account.",
  logoAlt: "RelayPay",
  headerLabel: "Customer support",
  eyebrow: "RelayPay support",
  heading: "How can we help today?",
  lead: "Speak with our AI support assistant or type your question. It answers from RelayPay's approved help content and brings in a specialist when a person needs to help.",
  points: [
    {
      title: "Answers you can rely on",
      body: "Replies come from RelayPay's approved help content. When something isn't covered, the assistant says so instead of guessing.",
    },
    {
      title: "Checks on your payments",
      body: "Share a transaction or payout reference to hear its status. Account details need two facts that match your account.",
    },
    {
      title: "A specialist when you need one",
      body: "For a restricted account, a dispute, a refund or anything urgent, the assistant books a callback with our support team.",
    },
  ],
  disclosure: "You're talking to an AI assistant. Conversations are logged for quality and follow-up.",
  englishOnly: "Support is available in English.",
  footer: "RelayPay customer support",
  modes: { label: "How would you like to get help?", voice: "Voice call", text: "Type a message" },
  voice: {
    heading: "Talk to the assistant",
    body: "Use your microphone and speak naturally. You can say a reference such as TXN-9001 out loud.",
    startCall: "Start voice call",
    endCall: "End call",
    retry: "Try again",
    lastSaidLabel: "The assistant said",
    status: {
      idle: "Press Start voice call and speak when you hear the greeting.",
      askingMic: "Allow microphone access to start the call.",
      connecting: "Connecting you to RelayPay support.",
      listening: "Listening",
      speaking: "The assistant is speaking",
      ending: "Ending the call.",
      ended: "The call has ended.",
    },
    micBlocked: {
      heading: "Your microphone is blocked",
      body: "To talk to support, allow microphone access for this site in your browser's address bar, then press Try again. You can also type your question instead.",
    },
    connectFailed: {
      heading: "We couldn't connect the call",
      body: "Please check your connection and try again, or type your question instead.",
    },
    dropped: {
      heading: "The call dropped",
      body: "Everything said up to this point was saved.",
    },
    notConfigured: {
      heading: "Voice calls aren't available here yet",
      body: "You can type your question instead, and get the same help.",
      action: "Type a message",
    },
  },
  text: {
    logLabel: "Your conversation with RelayPay support",
    you: "You",
    assistant: "RelayPay assistant",
    inputLabel: "Your message",
    placeholder: "Type your question",
    send: "Send",
    thinking: "Checking",
    hint: "Enter to send. Shift and Enter for a new line.",
    suggestionsLabel: "You could ask",
    suggestions: ["What fees apply to international payments?", "Can you check transaction TXN-9001?", "My account was restricted and I need help."],
    counter: (used: number, max: number) => `${used} of ${max} characters`,
    end: "End conversation",
    restart: "Start a new conversation",
    ended: "This conversation has ended.",
    errors: {
      rate_limited: "You've sent a lot of messages in a short time. Please wait a few minutes, then try again.",
      busy: "Still working on your last message. Please wait for the reply.",
      too_long: (max: number) => `Please keep your message under ${max.toLocaleString("en-GB")} characters.`,
      ended: "This conversation has ended. Start a new one to continue.",
      not_found: "We couldn't find this conversation. Please start a new one.",
      empty: "Please type your question first.",
      unavailable: "We can't reach our systems right now. Please try again shortly, or use the support options in your RelayPay dashboard.",
      network: "We couldn't send that. Check your connection and try again.",
      bad_request: "Something went wrong sending that. Please try again.",
    },
  },
  summary: {
    heading: "What happens next",
    ticket: (reference: string) => `Your ticket reference is ${reference}.`,
    escalation: (reference: string) => `Your case reference is ${reference}.`,
    booked: (when: string) => `A specialist will call you on ${when}. Look out for the confirmation email from our booking system.`,
    byEmail: "A specialist will email you to arrange a time.",
    nothing: "No ticket or callback was needed. Thanks for contacting RelayPay support.",
    unavailable: "We couldn't load the summary. Anything agreed in the conversation was saved.",
  },
} as const;

// ---------------------------------------------------------------------------
// The support console (DESIGN §14)
// ---------------------------------------------------------------------------

export const CONSOLE = {
  title: "RelayPay support console",
  product: "Support console",
  nav: { today: "Today", escalations: "Escalations", conversations: "Conversations", gaps: "Knowledge gaps", alerts: "Alerts", evals: "Evals", logout: "Sign out" },
  login: {
    heading: "Support console",
    intro: "Sign in to see today's conversations, escalations and alerts.",
    password: "Password",
    submit: "Sign in",
    wrong: "That password is not right.",
    locked: "Too many attempts from this network. Try again in 15 minutes.",
    notConfigured: "The console is not configured on this deployment (CONSOLE_PASSWORD_HASH).",
    footer: "For RelayPay's support team only.",
  },
  undeliveredBanner: (count: number) => `${count} alert${count === 1 ? "" : "s"} could not be emailed. Check SUPPORT_INBOX_EMAIL, Resend and the Vercel logs.`,
  today: {
    heading: "Today",
    intro: "Customer conversations since midnight in Lagos. Eval runs are left out.",
    customers: "Customers",
    speedAndCost: "Speed and cost",
    conversations: "Conversations",
    resolved: "Resolved without a person",
    openEscalations: "Open escalations",
    callsBooked: "Upcoming callbacks",
    alerts: "Alerts today",
    firstText: "First reply on a call (p50 / p95)",
    vapiTurn: "Voice turn to first audio (p50 / p95)",
    agentSpend: "Agent spend (SDK estimate)",
    vapiCost: "Vapi cost (billed)",
    costNote: "The SDK figure is an estimate and Vapi's is billing, so they are shown side by side and never added.",
    ofFinished: (resolved: number, finished: number) => `${resolved} of ${finished} finished conversations`,
    none: "No data yet",
    viewAll: "View all escalations",
  },
  escalations: {
    heading: "Escalations",
    intro: "Cases the assistant handed to a person, soonest callback first. Changing a status records who changed it and when.",
    showClosed: "Show closed",
    hideClosed: "Hide closed",
    columns: ["Case", "Category", "Customer", "Why", "Age", "Callback", "Booking", "Email", "Status"],
    notBooked: "Not booked",
    change: "Update",
    empty: "No open escalations. Everything handed to a person has been dealt with.",
  },
  conversations: {
    heading: "Conversations",
    intro: "The latest 100 conversations. Open one to see every turn, tool call and check.",
    all: "All customers",
    columns: ["Started", "Channel", "Turns", "Outcome", "Summary", "Agent spend (est.)", "Vapi cost"],
    noVapiCost: "None",
    open: "Open",
    empty: "No conversations yet.",
  },
  conversation: {
    back: "All conversations",
    caller: "Customer",
    agent: "Assistant",
    tools: "Tools",
    retrieval: "Knowledge searched",
    gates: "Checks",
    cleanups: "Removed by checks",
    stopped: "Stopped by checks, not sent",
    events: "Events",
    tickets: "Tickets",
    escalations: "Escalations",
    turns: "Turns",
    notFound: "No such conversation.",
    meta: {
      turns: "Turns",
      verified: "Verified",
      agentSpend: "Agent spend (est.)",
      vapiCost: "Vapi cost",
      ended: "Ended",
      notVerified: "No",
      notReported: "Not reported",
    },
    turnLabel: (index: number) => `Turn ${index}`,
    firstText: "first reply",
    final: "final",
    estimate: "est.",
    silence: "(silence)",
    repaired: "repaired",
    found: "found",
    notFoundResult: "not found",
    topScore: (score: string) => ` top score ${score}`,
    fullTextOnly: ", full text only",
    cited: (ids: string) => `; cited ${ids}`,
    citedNone: "; cited none",
    escalationLine: (reason: string, booking: string, when: string | null, email: string) => `${reason} Booking ${booking}${when ? ` for ${when}` : ""}, email ${email}.`,
  },
  gaps: {
    heading: "Knowledge gaps",
    intro: "Questions the assistant declined or could not find approved knowledge for, grouped by the nearest knowledge-base section. Each group is an article worth writing once.",
    columns: ["Nearest section", "Questions", "Examples"],
    empty: "No declined questions yet.",
  },
  alerts: {
    heading: "Alerts",
    intro: "Problems the system noticed, counted rather than repeated. Critical and warning alerts are emailed to the support inbox.",
    columns: ["Last seen", "Severity", "Type", "Message", "Count", "First seen", "Emailed"],
    notEmailed: "Not emailed",
    empty: "No alerts.",
  },
  evals: {
    heading: "Evals",
    intro: "Scripted conversations through the real agent, checked against the records. Bookings and emails are sandboxed.",
    runs: "Runs",
    runColumns: ["Started", "Label", "Model", "Side effects", "Passed", "First reply p50 / p95", "Cost (SDK estimate)"],
    matrix: "Benchmark: pass rate per scenario, latest three runs per model",
    matrixColumns: ["Scenario", "Test case", "Model", "Passed / runs"],
    running: "Running",
    stopped: "Stopped",
    empty: "No eval runs yet. Run npm run eval.",
  },
  labels: {
    channel: { web: "Web call", phone: "Phone", text: "Typed", eval: "Eval", mcp_direct: "MCP direct" } as Record<string, string>,
    outcome: {
      resolved: "Resolved",
      ticket_created: "Ticket created",
      escalated: "Escalated",
      abandoned: "Left mid-escalation",
      failed: "Failed",
      open: "In progress",
    } as Record<string, string>,
  },
} as const;
