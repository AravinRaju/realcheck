# English request warning rules

Rules in lib/rules.mjs are local deterministic phrase matches. They are warning signs for human review, never a scam verdict, and are separate from media manipulation detection.

| Rule | Request pattern | Primary source |
| --- | --- | --- |
| Gift-card payment | Asking someone to buy, send, or pay with gift cards | [FTC: Avoiding and Reporting Gift Card Scams](https://consumer.ftc.gov/avoiding-reporting-gift-card-scams) |
| Verification code | Asking someone to send/share/tell/give/read an account verification or one-time code | [FTC: Unexpected calls claiming your money is at risk](https://consumer.ftc.gov/consumer-alerts/2026/01/how-handle-unexpected-calls-claim-your-money-risk) |
| Remote access | Asking for remote access or installation of common remote-control software | [FTC: Tech Support Scams](https://consumer.ftc.gov/articles/how-spot-avoid-and-report-tech-support-scams) |
| Urgent transfer | Asking to send/transfer/pay money immediately | [FTC: Avoiding and Reporting Gift Card Scams](https://consumer.ftc.gov/avoiding-reporting-gift-card-scams) |

Reviewed 2026-09-07. These sources support the warning patterns, not the statistical accuracy of these rules. Tool names in the remote-access rule are implementation examples of remote-control software, not a claim that using those products is inherently suspicious.

The UI shows the exact matched phrase and source, with no invented probability. Common direct negations are suppressed. Quotes, broader negation, legitimate requests, mixed-language speech, transcription errors, and clever rephrasing remain limitations. Users must review context. Non-English, missing-language, and empty transcripts are not evaluated; zero matches is never a safety guarantee.
