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
  /** Added by code to every inferred answer (DESIGN §8): the agent worked it out, no chunk states it. */
  inferredHedge: "I'm not completely certain about that, so please confirm it in your RelayPay dashboard, or I can arrange for a specialist to check.",
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
  available: "Available now",
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
// Emails to the support team (DESIGN §10.3), all in one template
// ---------------------------------------------------------------------------

export const EMAIL = {
  signature: "RelayPay support system",
  manage: "Change what you receive",
  reasons: {
    escalations: "You are receiving this because you are on RelayPay support's list for escalation handoffs.",
    critical: "You are receiving this because you are on RelayPay support's list for critical alerts.",
    warning: "You are receiving this because you are on RelayPay support's list for warnings.",
    test: "You are receiving this because you were added to RelayPay support's notification list.",
    direct: "The database could not be reached, so this alert was sent straight to the last known list.",
  },
  handoff: {
    subject: (ref: string, category: string, who: string, when: string | null) => `[Escalation ${ref}] ${category} · ${who} · ${when ? `callback ${when}` : "no callback booked"}`,
    unverified: "unverified caller",
    badge: (ref: string) => `Escalation ${ref}`,
    title: (company: string | null) => (company ? `${company} needs a specialist` : "A customer needs a specialist"),
    introBooked: (when: string) => `A callback is booked for ${when}. Everything the specialist needs is below, so the customer never has to repeat themselves.`,
    introNotBooked: "No callback is booked yet. Please email the customer to arrange a time. Everything you need is below.",
    headings: { caller: "Caller", why: "Why", said: "The customer's last words", told: "What we already told them", lookedUp: "What we looked up", booking: "Booking" },
    labels: { name: "Name", email: "Email", account: "Account", note: "Support note", category: "Category", reason: "Reason", ticket: "Ticket", status: "Status", link: "Cal.com", asked: "They asked for" },
    notVerified: "Not verified",
    verified: (id: string, company: string, plan: string, status: string, kyc: string) => `Verified as ${id} (${company}), ${plan} plan, account ${status}, KYC ${kyc}`,
    booked: (when: string) => `Booked for ${when}.`,
    notBooked: (why: string) => `Not booked: ${why}.`,
    noTimeChosen: "no time was chosen",
    nothingTold: "Nothing recorded.",
    noLookups: "No lookups.",
    action: "Open the conversation",
  },
  alert: {
    subject: (severity: string, type: string) => `[RelayPay alert] ${severity}: ${type}`,
    badge: (severity: string) => (severity === "critical" ? "Critical alert" : "Warning"),
    heading: "What the system saw",
    intro: (times: string, first: string, minutes: number) => `Seen ${times} since ${first}. Repeats are counted, not emailed again, for ${minutes} minutes.`,
    labels: { type: "Type", severity: "Severity", seen: "Seen", first: "First seen", last: "Last seen", details: "Details" },
    times: (count: number) => `${count} time${count === 1 ? "" : "s"}`,
    action: "Open alerts in the console",
  },
  test: {
    subject: "RelayPay support: test notification",
    badge: "Test",
    title: "Notifications are working",
    intro: (name: string | null) => `${name ? `Hi ${name}, this` : "This"} is a test from the RelayPay support console. Real emails look like this one.`,
    heading: "You will receive",
    none: "Nothing yet: switch on at least one kind of email in the console.",
    kinds: { escalations: "Escalation handoffs, with the customer's details and the booked callback", critical: "Critical alerts, when something needs attention now", warning: "Warnings, when something is worth a look" },
    action: "Open the console",
  },
} as const;

// ---------------------------------------------------------------------------
// The support console (DESIGN §14)
// ---------------------------------------------------------------------------

export const CONSOLE = {
  title: "RelayPay support console",
  product: "Support console",
  team: "Support team",
  nav: {
    groups: { overview: "Overview", work: "Work", improve: "Improve", system: "System" },
    today: "Today",
    escalations: "Escalations",
    conversations: "Conversations",
    knowledge: "Knowledge",
    alerts: "Alerts",
    evals: "Evals",
    settings: "Settings",
    logout: "Sign out",
    menu: "Menu",
    close: "Close menu",
  },
  health: {
    good: "All systems normal",
    attention: (count: number) => `${count} alert${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention`,
  },
  login: {
    heading: "Welcome back",
    intro: "Sign in to see today's conversations, escalations and alerts.",
    password: "Password",
    submit: "Sign in",
    wrong: "That password is not right.",
    locked: "Too many attempts from this network. Try again in 15 minutes.",
    notConfigured: "The console is not configured on this deployment (CONSOLE_PASSWORD_HASH).",
    footer: "For RelayPay's support team only.",
  },
  undelivered: {
    noRecipients: "Nobody is set to receive alert emails, so alerts are only visible here.",
    failed: (count: number) => `${count} alert${count === 1 ? "" : "s"} could not be emailed. Check Resend and the Vercel logs.`,
    action: "Add someone in Settings",
  },
  greeting: (part: "morning" | "afternoon" | "evening") => `Good ${part}`,
  today: {
    heading: "Today",
    intro: "Customer conversations since midnight in Lagos. Eval runs are left out.",
    setup: {
      heading: "Finish setting up",
      intro: "A few things are still needed before this is ready for real customers.",
      recipients: { title: "Choose who gets emails", body: "Escalation handoffs and alerts go to the people on your notification list.", action: "Open Settings" },
      voice: { title: "Connect the voice assistant", body: "Run npm run vapi:sync with the public URL, then set NEXT_PUBLIC_VAPI_ASSISTANT_ID.", action: "See the README" },
      knowledge: { title: "Load the knowledge base", body: "Run npm run kb:ingest so the assistant can answer product questions.", action: "See the README" },
      done: "Done",
    },
    cards: {
      conversations: "Conversations",
      byChannel: (voice: number, typed: number) => `${voice} by voice, ${typed} typed`,
      resolved: "Solved by the assistant",
      ofFinished: (resolved: number, finished: number) => `${resolved} of ${finished} finished conversations`,
      escalations: "Open escalations",
      booked: (count: number) => `${count} callback${count === 1 ? "" : "s"} booked`,
      alerts: "Alerts today",
      critical: (count: number) => (count ? `${count} critical` : "None critical"),
    },
    activity: { heading: "Last 14 days", intro: "Conversations per day, by how they ended.", empty: "No conversations in the last 14 days yet." },
    attention: { heading: "Needs a person", empty: "Nothing is waiting for a person.", viewAll: "All escalations" },
    recent: { heading: "Latest conversations", empty: "No customer conversations yet. Try the support page.", viewAll: "All conversations" },
    speed: {
      heading: "Speed and cost",
      firstText: "First reply on a call",
      vapiTurn: "Voice turn to first audio",
      agentSpend: "Agent spend (SDK estimate)",
      vapiCost: "Vapi cost (billed)",
      pair: (p50: string, p95: string) => `${p50} typical, ${p95} slowest 5%`,
      costNote: "The SDK figure is an estimate and Vapi's is billing, so they are shown side by side and never added.",
    },
    none: "No data yet",
  },
  outcomes: {
    resolved: "Resolved",
    ticket_created: "Ticket",
    escalated: "Escalated",
    abandoned: "Left mid-escalation",
    failed: "Failed",
    open: "In progress",
  } as Record<string, string>,
  channels: { web: "Web call", phone: "Phone", text: "Typed", eval: "Eval", mcp_direct: "MCP direct" } as Record<string, string>,
  escalations: {
    heading: "Escalations",
    intro: "Cases the assistant handed to a person, soonest callback first. Every status change is recorded.",
    showOpen: "Open",
    showAll: "All",
    columns: ["Case", "Customer", "Why", "Callback", "Booking", "Email", "Status"],
    notBooked: "Not booked",
    age: (age: string) => `${age} ago`,
    statuses: { open: "Open", "in progress": "In progress", closed: "Closed" } as Record<string, string>,
    saved: "Saved",
    saveFailed: "Not saved. Try again.",
    empty: "No open escalations. Everything handed to a person has been dealt with.",
    emptyAll: "No escalations yet.",
  },
  conversations: {
    heading: "Conversations",
    intro: "The latest 100 conversations. Open one to see every turn, tool call and check.",
    all: "All customers",
    columns: ["Started", "Channel", "Outcome", "Summary", "Turns", "Agent spend (est.)"],
    empty: "No conversations yet.",
  },
  conversation: {
    back: "All conversations",
    caller: "Customer",
    agent: "Assistant",
    tools: "Tools",
    retrieval: "Knowledge searched",
    gates: "Checks",
    stopped: "Stopped by checks, never sent",
    behind: "What happened behind this reply",
    events: "Events",
    tickets: "Tickets",
    escalations: "Escalations",
    turns: "Transcript",
    notFound: "No such conversation.",
    meta: { turns: "Turns", verified: "Verified", agentSpend: "Agent spend (est.)", vapiCost: "Vapi cost", ended: "Ended", notVerified: "No", notReported: "Not reported" },
    turnLabel: (index: number) => `Turn ${index}`,
    firstText: "first reply",
    final: "final",
    estimate: "est.",
    silence: "(silence)",
    repaired: "repaired",
    inferred: "inferred",
    found: "found",
    notFoundResult: "not found",
    related: "related only",
    topScore: (score: string) => ` top score ${score}`,
    fullTextOnly: ", full text only",
    cited: (ids: string) => `; cited ${ids}`,
    citedNone: "; cited none",
    escalationLine: (reason: string, booking: string, when: string | null, email: string) => `${reason} Booking ${booking}${when ? ` for ${when}` : ""}, email ${email}.`,
  },
  knowledge: {
    heading: "Knowledge",
    intro: "Teach the assistant. Answer the questions it could not, and post service notices it will mention to customers.",
    tabs: { gaps: "Questions to answer", answers: "Team answers", notices: "Service notices" },
    gaps: {
      intro: "Questions the assistant declined or could only half answer, grouped by the nearest part of the knowledge base.",
      asked: (count: number) => `Asked ${count} time${count === 1 ? "" : "s"}`,
      nearest: "Nearest section",
      noMatch: "No close section",
      answer: "Answer this",
      empty: "No unanswered questions. When the assistant declines something, it will appear here.",
    },
    answers: {
      intro: "Approved answers the assistant uses like the knowledge base. Switch one off to take it out of use at once.",
      add: "Write an answer",
      empty: "No team answers yet. Answer a question from the first tab, or write one here.",
      used: (count: number) => `Used in ${count} answer${count === 1 ? "" : "s"}`,
      from: "From a customer's question",
    },
    notices: {
      intro: "Short, current news the assistant mentions when it bears on a question: an outage, a delay, a change. Each one expires.",
      add: "Post a notice",
      empty: "No service notices.",
      until: (when: string) => `Shown until ${when}`,
      expired: "Expired",
      noExpiry: "No end date",
    },
    form: {
      question: "Question",
      questionHint: "Write it the way a customer would ask it.",
      headline: "Headline",
      answer: "Answer",
      answerHint: "Plain words, a few sentences. The assistant says only what this says.",
      notice: "What customers should know",
      expires: "Show for",
      expiresOptions: [
        { label: "1 day", hours: 24 },
        { label: "3 days", hours: 72 },
        { label: "1 week", hours: 168 },
        { label: "30 days", hours: 720 },
      ],
      save: "Save",
      saving: "Saving",
      cancel: "Cancel",
      saved: "Saved. The assistant can use it now.",
      failed: "Not saved. Check the fields and try again.",
    },
    active: "In use",
    inactive: "Switched off",
    justNow: "Just now",
    turnOn: "Switch on",
    turnOff: "Switch off",
  },
  alerts: {
    heading: "Alerts",
    intro: "Problems the system noticed, counted rather than repeated. Critical alerts and warnings are emailed to the people in Settings.",
    counts: { critical: "Critical", warning: "Warnings", info: "Info" },
    columns: ["Alert", "Severity", "Seen", "Last seen", "Emailed"],
    times: (count: number) => `${count}x`,
    notEmailed: "Not emailed",
    empty: "No alerts. Everything is running normally.",
  },
  evals: {
    heading: "Evals",
    intro: "Scripted conversations through the real agent, checked against the records. Bookings and emails are skipped in evals.",
    runs: "Runs",
    runColumns: ["Started", "Label", "Model", "Passed", "First reply p50 / p95", "Cost (SDK estimate)"],
    matrix: "Benchmark: pass rate per scenario, latest three runs per model",
    matrixColumns: ["Scenario", "Test case", "Model", "Passed / runs"],
    running: "Running",
    stopped: "Stopped",
    empty: "No eval runs yet. Run npm run eval.",
  },
  settings: {
    heading: "Settings",
    intro: "Who hears about what, and how this deployment is set up.",
    notifications: {
      heading: "Email notifications",
      intro: "Choose who gets each kind of email. Changes apply to the next email.",
      kinds: {
        escalations: { label: "Escalation handoffs", hint: "A new case, with the customer's details and callback" },
        critical_alerts: { label: "Critical alerts", hint: "Something needs attention now" },
        warning_alerts: { label: "Warnings", hint: "Worth a look when there is time" },
      },
      add: "Add person",
      email: "Email address",
      emailPlaceholder: "name@company.com",
      name: "Name (optional)",
      adding: "Adding",
      added: "Added.",
      exists: "That address is already on the list.",
      invalid: "Enter a valid email address.",
      remove: "Remove",
      removeConfirm: (email: string) => `Remove ${email} from all emails?`,
      removed: "Removed.",
      paused: "Paused",
      active: "Receiving",
      pause: "Pause",
      resume: "Resume",
      test: "Send test",
      testing: "Sending",
      testSent: (email: string) => `Test email sent to ${email}.`,
      testFailed: "The test email could not be sent. Check RESEND_API_KEY and RESEND_FROM_EMAIL.",
      saved: "Saved.",
      saveFailed: "Not saved. Try again.",
      empty: "Nobody receives emails yet. Add the first person above.",
      missing: (kinds: string) => `Nobody receives ${kinds}.`,
    },
    system: {
      heading: "This deployment",
      model: "Agent model",
      voice: "Voice assistant",
      voiceReady: "Connected",
      voiceMissing: "Not connected yet",
      knowledge: "Knowledge base",
      knowledgeChunks: (count: number, team: number) => `${count} sections, ${team} from the team`,
      sender: "Emails sent from",
      notSet: "Not set",
    },
  },
} as const;
