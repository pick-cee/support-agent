import { readFileSync } from "node:fs";
import path from "node:path";

import { EMAIL } from "@/app/copy";

// Every email the system sends uses this one template (DESIGN §10.3): the
// RelayPay logo at the top, then a white card with the message, then a footer
// saying why the reader got it. Email clients are old and strict, so the HTML
// is tables and inline styles, and the brand's colours and type are written
// out in full. The logo travels as an inline attachment (cid:), so it shows in
// every client and every environment, localhost included. A plain-text version
// is always sent alongside.

export const LOGO_CONTENT_ID = "relaypay-logo";
const LOGO_FILE = path.join(process.cwd(), "public", "brand", "relaypay-logo-email.png");

const COLOURS = {
  primary: "#0f347b",
  accent: "#00b3e9",
  accentText: "#00708f",
  background: "#f5f7fa",
  surface: "#ffffff",
  muted: "#f9fafb",
  border: "#e2e7ee",
  text: "#152033",
  textMuted: "#4d596b",
  textSubtle: "#5d6a7d",
  danger: "#a4262c",
  dangerTint: "#fbeced",
  warning: "#8a5300",
  warningTint: "#fdf4e3",
  brandTint: "#edf1f9",
  accentTint: "#e7f6fc",
};
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type Tone = "brand" | "danger" | "warning" | "info";

export type EmailBlock =
  | { kind: "facts"; heading?: string; rows: [label: string, value: string][] }
  | { kind: "lines"; heading?: string; lines: string[] }
  | { kind: "quotes"; heading?: string; lines: string[] }
  /** The one fact the reader acts on, in a tinted panel at the top (the callback time). */
  | { kind: "highlight"; label: string; value: string; note?: string; tone: Tone };

export type EmailContent = {
  /** The grey line many inboxes show after the subject. */
  preheader: string;
  badge: { text: string; tone: Tone };
  title: string;
  intro: string;
  blocks: EmailBlock[];
  action?: { label: string; url: string };
  /** Why this person received it. */
  reason: string;
  manageUrl?: string | null;
  /** Who it is from, at the foot; the team's emails default to the support system. */
  signature?: string;
};

export type Attachment = { filename: string; content: string; content_id: string };

let logo: Attachment | null | undefined;

/** The logo as an inline attachment, or null if the file cannot be read (the email then shows the name in text). */
export function logoAttachment(): Attachment | null {
  if (logo !== undefined) return logo;
  try {
    logo = { filename: "relaypay-logo.png", content: readFileSync(LOGO_FILE).toString("base64"), content_id: LOGO_CONTENT_ID };
  } catch {
    logo = null;
  }
  return logo;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const TONES: Record<Tone, { background: string; colour: string }> = {
  brand: { background: COLOURS.brandTint, colour: COLOURS.primary },
  danger: { background: COLOURS.dangerTint, colour: COLOURS.danger },
  warning: { background: COLOURS.warningTint, colour: COLOURS.warning },
  info: { background: COLOURS.accentTint, colour: COLOURS.accentText },
};

function heading(text: string | undefined): string {
  return text
    ? `<p style="margin:28px 0 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${COLOURS.textSubtle};">${escapeHtml(text)}</p>`
    : "";
}

function block(item: EmailBlock): string {
  if (item.kind === "highlight") {
    const tone = TONES[item.tone];
    const note = item.note ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${COLOURS.textMuted};">${escapeHtml(item.note)}</p>` : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:separate;">
      <tr><td style="padding:16px 18px;background:${tone.background};border-left:4px solid ${tone.colour};border-radius:10px;">
        <p style="margin:0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${tone.colour};">${escapeHtml(item.label)}</p>
        <p style="margin:6px 0 0;font-family:${FONT};font-size:18px;line-height:26px;font-weight:600;color:${COLOURS.text};">${escapeHtml(item.value)}</p>
        ${note}
      </td></tr>
    </table>`;
  }
  if (item.kind === "facts") {
    const rows = item.rows
      .map(
        ([label, value], index) => `<tr>
          <td valign="top" style="padding:10px 12px;width:34%;font-family:${FONT};font-size:13px;line-height:20px;color:${COLOURS.textSubtle};${index ? `border-top:1px solid ${COLOURS.border};` : ""}">${escapeHtml(label)}</td>
          <td valign="top" style="padding:10px 12px;font-family:${FONT};font-size:14px;line-height:20px;color:${COLOURS.text};${index ? `border-top:1px solid ${COLOURS.border};` : ""}">${escapeHtml(value)}</td>
        </tr>`,
      )
      .join("");
    return `${heading(item.heading)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLOURS.border};border-radius:10px;border-collapse:separate;background:${COLOURS.muted};">${rows}</table>`;
  }
  if (item.kind === "quotes") {
    const lines = item.lines
      .map(
        (line) =>
          `<p style="margin:0 0 8px;padding:8px 0 8px 14px;border-left:3px solid ${COLOURS.accent};font-family:${FONT};font-size:14px;line-height:21px;color:${COLOURS.text};">${escapeHtml(line)}</p>`,
      )
      .join("");
    return `${heading(item.heading)}${lines}`;
  }
  const lines = item.lines.map((line) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:22px;color:${COLOURS.text};">${escapeHtml(line)}</p>`).join("");
  return `${heading(item.heading)}${lines}`;
}

export function renderEmail(content: EmailContent): { html: string; text: string; attachments: Attachment[] } {
  const attachment = logoAttachment();
  const tone = TONES[content.badge.tone];
  const brandMark = attachment
    ? `<img src="cid:${LOGO_CONTENT_ID}" width="160" height="38" alt="RelayPay" style="display:block;border:0;outline:none;width:160px;height:auto;">`
    : `<span style="font-family:${FONT};font-size:22px;font-weight:600;color:${COLOURS.primary};">RelayPay</span>`;
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0 4px;"><tr><td style="border-radius:8px;background:${COLOURS.primary};">
         <a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:14px;font-weight:600;line-height:18px;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.action.label)}</a>
       </td></tr></table>`
    : "";
  const manage = content.manageUrl ? ` <a href="${escapeHtml(content.manageUrl)}" style="color:${COLOURS.textSubtle};text-decoration:underline;">${escapeHtml(EMAIL.manage)}</a>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOURS.background};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOURS.background};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr><td style="padding:0 4px 20px;">${brandMark}</td></tr>
      <tr><td style="background:${COLOURS.surface};border:1px solid ${COLOURS.border};border-top:4px solid ${COLOURS.primary};border-radius:12px;padding:32px 32px 28px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.background};font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${tone.colour};">${escapeHtml(content.badge.text)}</span>
        <h1 style="margin:16px 0 8px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;color:${COLOURS.primary};">${escapeHtml(content.title)}</h1>
        <p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;color:${COLOURS.textMuted};">${escapeHtml(content.intro)}</p>
        ${content.blocks.map(block).join("\n")}
        ${action}
      </td></tr>
      <tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:19px;color:${COLOURS.textSubtle};">
        ${escapeHtml(content.reason)}${manage}<br>${escapeHtml(content.signature ?? EMAIL.signature)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    content.badge.text,
    content.title,
    "",
    content.intro,
    ...content.blocks.flatMap((item) =>
      item.kind === "highlight"
        ? ["", `${item.label.toUpperCase()}: ${item.value}`, ...(item.note ? [item.note] : [])]
        : [
            "",
            ...(item.heading ? [item.heading.toUpperCase()] : []),
            ...(item.kind === "facts" ? item.rows.map(([label, value]) => `${label}: ${value}`) : item.kind === "quotes" ? item.lines.map((line) => `  "${line}"`) : item.lines),
          ],
    ),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    "",
    "--",
    content.reason,
    ...(content.manageUrl ? [`${EMAIL.manage}: ${content.manageUrl}`] : []),
    content.signature ?? EMAIL.signature,
  ].join("\n");

  return { html, text, attachments: attachment ? [attachment] : [] };
}
