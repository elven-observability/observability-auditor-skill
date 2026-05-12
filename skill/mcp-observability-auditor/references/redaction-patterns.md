# Redaction Patterns

Apply before pasting any log line, query result, or trace payload into a report. The patterns below cover the high-frequency cases. For programmatic redaction use `scripts/redaction.mjs`.

## Principle

**Aggregate first, redact second, copy raw last.** Counts, percentiles, top-K, and pattern signatures are almost always enough. If you still need a sample, redact it before it leaves the agent.

## Pattern catalog

| Category | Pattern (regex) | Replacement | Notes |
|---|---|---|---|
| Bearer token | `(?i)\bbearer\s+[A-Za-z0-9._\-]+` | `Bearer <redacted>` | OAuth, JWT in Authorization headers. |
| JWT | `\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+` | `<jwt-redacted>` | Three base64url segments. |
| AWS access key | `\bAKIA[0-9A-Z]{16}\b` | `<aws-access-key-redacted>` | Production keys. |
| AWS secret | `\b[A-Za-z0-9/+=]{40}\b` (context: near `secret\|aws`) | `<aws-secret-redacted>` | Only when adjacent to "secret"/"aws". |
| OpenAI / Anthropic key | `\bsk-(ant-)?[A-Za-z0-9_\-]{20,}` | `<api-key-redacted>` | Common LLM provider key shape. |
| GitHub PAT | `\bghp_[A-Za-z0-9]{20,}\b` | `<github-pat-redacted>` | Classic & fine-grained share this prefix. |
| Slack token | `\bxox[abprs]-[A-Za-z0-9\-]{10,}` | `<slack-token-redacted>` | |
| Stripe key | `\b(sk\|pk)_(live\|test)_[A-Za-z0-9]{16,}\b` | `<stripe-key-redacted>` | |
| Generic API key in URL | `([?&](api_key\|apikey\|token\|access_token\|key)=)[^&\s]+` | `$1<redacted>` | Preserves param name for readability. |
| Cookie header | `(?i)(cookie:\s*)[^\r\n]+` | `$1<cookies-redacted>` | Always redact full cookie strings. |
| HTTP Basic | `(?i)\bbasic\s+[A-Za-z0-9+/=]+` | `Basic <redacted>` | base64 credential. |
| Private key block | `-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----` | `<private-key-redacted>` | PEM. |
| SSH private key | `-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]+?-----END OPENSSH PRIVATE KEY-----` | `<ssh-key-redacted>` | |
| Email | `\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b` | `<email-redacted>` | Use only if customer identity is sensitive. Counts and `sha256[:8]` are usually better. |
| Phone (E.164 / BR) | `\+?\d[\d\s\-]{7,}\d` | `<phone-redacted>` | Tighten with country regex if too aggressive. |
| Credit card (PAN) | `\b(?:\d[ \-]?){13,16}\b` | `<pan-redacted>` | PCI scope. |
| CPF (BR) | `\b\d{3}\.\d{3}\.\d{3}-\d{2}\b` | `<cpf-redacted>` | Brazil tax ID — LGPD scope. |
| CNPJ (BR) | `\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b` | `<cnpj-redacted>` | Brazil corporate ID. |
| IPv4 | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` | `<ipv4-redacted>` | Public IPs may identify customers/end-users. |
| IPv6 | `\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b` | `<ipv6-redacted>` | Same as IPv4 for sensitivity. |
| UUID v4 | `\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b` | `<uuid-redacted>` | Usually safe to keep — redact only when it carries identity. |
| Long base64 payload | `\b[A-Za-z0-9+/]{40,}={0,2}\b` | `<base64-redacted>` | Catches blob/large encoded payloads. Run last to avoid masking earlier matches. |

Patterns are case-insensitive only when explicitly marked `(?i)`. Anchor with `\b` to avoid eating substrings.

## Hashing instead of redacting

When you need to *count distinct values* without exposing them — distinct users in an incident, distinct order IDs, distinct device IDs — replace with a short stable hash:

```text
sha256(value)[:8]
```

Eight hex chars (32 bits) is enough to count without enabling reverse lookup. Document the hash in the appendix once: `user_id sha256[:8] = a4f1c33b → user appears 47 times in window`.

## Aggregation-first checklist

Before redacting one sample, try:

- `count_over_time({…} |~ "$pattern")[$window]` — how often does it occur?
- `topk(10, …)` — what are the dominant variants?
- `quantile_over_time(0.95, …)` — what does the bad case look like in shape, not in content?
- `query_loki_patterns` — extracted patterns instead of raw bodies.
- `sha256[:8]` over the identifier you would otherwise paste.

If the count is small *and* the symptom can only be explained by showing one example, redact one example. Never copy more than three raw samples into a customer-facing report.

## What goes through without redaction

- Metric numbers, percentiles, rates.
- Label values for non-PII labels (`service_name`, `environment`, `route`, `error_code`).
- Stack-trace frames inside your own code (file/function names).
- Public-facing HTTP routes that are not request-specific.

## What never goes through, even redacted

- Customer payment data (PAN, CVV, expiry).
- Health information (PHI).
- Credentials of any kind (passwords, secrets, tokens).
- Raw cookies / set-cookie headers.
- Customer-supplied request bodies for accounts/payments/identity flows.

If your investigation requires this data, the answer is "the report cannot include it; here is what I observed in aggregate, here is the deeplink for an authorised engineer to verify in-place".
