# Example profile

The one example profile. Warm Paths has no built-in profile and no presets:
yours starts empty and holds only what you set, in the app (Settings →
Profile) or by telling Claude. It is saved as `config/profile.json` (or
`DATA_DIR/profile.json`), gitignored.

Said to Claude: "Find people at VC funds. I'm looking for an analyst role."

```json
{
  "goal": "Find people at VC funds. I'm looking for an analyst role.",
  "roles": ["partner", "principal", "investment director", "head of talent"],
  "industries": [
    { "code": "6430", "label": "Funds and investment" },
    { "code": "6499", "label": "Funds and investment" },
    { "code": "6630", "label": "Funds and investment" }
  ],
  "keywords": ["ventures", "capital"],
  "excluded": [{ "name": "My current employer Oy" }],
  "ask": "20 minutes of advice on getting into VC",
  "tone": "Friendly and direct, in English",
  "signature": "– Alex"
}
```

| Field | What it does |
| --- | --- |
| `goal` | Your words. Shown on the Network page, given to Claude for messages and angles. |
| `roles` | Titles that matter. A senior title (director, head of, C-level) that matches one is a Strong fit; any director or C-level title is at least Possible; a manager title counts only when it matches. Empty: any senior title is Strong. |
| `industries` | TOL 2008 codes: a range of two-digit divisions (`10-33`) or a prefix (`6430`). Plain language ("venture capital") is mapped when you set it, and the mapping is shown so you can check it. Empty: any industry. |
| `keywords` | A word at the start of a word in an organisation's name makes it a target, whatever its industry ("ventures" matches "Example Ventures Oy"). Also finds organisations not in PRH, as Possible at most. |
| `excluded` | Organisations that are not a target: a PRH business ID or a name. |
| `ask` | The one ask in every message. |
| `tone` | How messages read, including the language. |
| `signature` | Added to the end of messages, on your machine. |
| `requireEmployer` | `false` keeps Finnish companies with no employees registered (PRH Employer Register). On by default. |

The demo's invented profile is `data/demo/profile.json`.
