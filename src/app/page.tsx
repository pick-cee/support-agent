import { SupportApp } from "./_support/support-app";

// The customer's page (DESIGN §13). Only the two public Vapi values reach the
// browser; everything else stays on the server.
export default function Home() {
  return <SupportApp publicKey={process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? ""} assistantId={process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? ""} />;
}
