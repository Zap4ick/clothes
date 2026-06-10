---
description: "Use for meaningful agent updates across the repository. Ensures the semantic version patch digit is incremented on every agent update."
name: "Agent Update Version Bump"
applyTo:
  - "**/*"
---

# Agent Update Version Bump Rule

- Treat meaningful agent feature/fix updates as required patch releases.
- Increment only the rightmost semantic version digit by exactly 1 for each agent update.
- Keep major and minor digits unchanged unless explicitly requested by the user.
- Update version values consistently in `package.json`, `package-lock.json`, and the README version reference when present.
- Do not bump for trivial non-functional edits (for example, tiny wording tweaks).
- If the task does not include a meaningful agent update, do not change the version.

## Required Final Checklist

- Before sending the final response for any meaningful agent feature/fix update, verify that `package.json`, `package-lock.json`, and the README version reference all reflect the same incremented patch version.
- If any of those files are missing the expected patch bump, update them before finalizing the task.
- Include a brief confirmation in the final response that the version bump was applied.

## Practical Trigger Guidance

- Treat behavior changes in runtime code (for example files under `src/`) as meaningful updates by default.
- Treat docs-only or formatting-only edits as non-meaningful unless the user explicitly requests a release/version bump.
