import { describe, expect, it } from "vitest";

import { speakDate, splitSentences, toSpeech, toText, trimToLength } from "./speech";

const NOW = new Date("2026-09-29T10:00:00Z");

describe("toSpeech", () => {
  it("reads references letter by letter", () => {
    expect(toSpeech("I found TXN-9001 and PAY-7002.", NOW).text).toBe("I found T X N 9 0 0 1 and P A Y 7 0 0 2.");
    expect(toSpeech("Your reference is T-4821.", NOW).text).toBe("Your reference is T 4 8 2 1.");
  });

  it("says amounts with their currency in words", () => {
    expect(toSpeech("It was 2400 USD.", NOW).text).toBe("It was 2,400 US dollars.");
    expect(toSpeech("It was GBP 5300.00.", NOW).text).toBe("It was 5,300 British pounds.");
  });

  it("says a past date without the weekday and a future one with it", () => {
    expect(toSpeech("Estimated 2026-08-19.", NOW).text).toBe("Estimated 19 August.");
    expect(toSpeech("Booked for 2026-10-06.", NOW).text).toBe("Booked for Tuesday 6 October.");
    expect(speakDate("2026-10-07", NOW)).toBe("Wednesday 7 October");
    expect(speakDate("2025-12-01", NOW)).toBe("1 December 2025");
  });

  it("reads an email out", () => {
    expect(toSpeech("Is it amara@lagosledger.example?", NOW).text).toBe("Is it amara at lagosledger dot example?");
  });

  it("strips em dashes, markdown, URLs and emoji, and counts them", () => {
    const { text, stripped } = toSpeech("**Good news** \u2014 it's processing \u{1F600}. See https://relaypay.example/x for more.", NOW);
    expect(text).toBe("Good news, it's processing. See for more.");
    expect(stripped).toEqual({ emDashes: 1, markdown: 2, urls: 1, emoji: 1 });
  });

  it("removes list markers", () => {
    expect(toSpeech("- one thing\n- another", NOW).text).toBe("one thing another");
  });
});

describe("toText", () => {
  it("keeps references and emails as written, for someone reading", () => {
    expect(toText("I found TXN-9001. Your reference is T-4821. Is it amara@lagosledger.example?", NOW).text).toBe(
      "I found TXN-9001. Your reference is T-4821. Is it amara@lagosledger.example?",
    );
  });

  it("still words dates and amounts, and strips what the house style forbids", () => {
    const { text, stripped } = toText("**It was 2400 USD** \u2014 due 2026-08-19.", NOW);
    expect(text).toBe("It was 2,400 US dollars, due 19 August.");
    expect(stripped).toMatchObject({ emDashes: 1, markdown: 2 });
  });
});

describe("trimToLength", () => {
  it("leaves short text alone", () => {
    expect(trimToLength("Short.", 20)).toEqual({ text: "Short.", trimmed: false });
  });

  it("cuts at the last sentence end that fits", () => {
    expect(trimToLength("First sentence here. Second sentence is long.", 30)).toEqual({ text: "First sentence here.", trimmed: true });
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends and keeps a trailing fragment", () => {
    expect(splitSentences("One. Two? Three")).toEqual(["One.", "Two?", "Three"]);
  });

  it("keeps an email address and a decimal whole, and never drops text", () => {
    // The typed read-back that came out as "Thanks, Efua. example." (2026-09-30).
    const text = "Thanks, Efua. I have your email as efua@accrastack.example. What day and time would you like the callback?";
    expect(splitSentences(text)).toEqual(["Thanks, Efua.", "I have your email as efua@accrastack.example.", "What day and time would you like the callback?"]);
    expect(splitSentences("Fees are 2.5 percent. Shown before you confirm.")).toEqual(["Fees are 2.5 percent.", "Shown before you confirm."]);
    for (const sample of [text, "Is it efua@accrastack.example?", "Version 2.4 fixed it. Thanks."]) {
      expect(splitSentences(sample).join(" ")).toBe(sample);
    }
  });
});
