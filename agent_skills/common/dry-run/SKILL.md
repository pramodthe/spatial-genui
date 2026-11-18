---
name: dry-run
description: Check /work/module.js with the same gate the host uses. Run it before you finish.
---

# Dry run

The check is the static validator plus a locked-down dry run (three.js r185 and kit.js). A pass inside the sandbox is not the host's decision; the host runs the gate again. Still fix every failure here before you stop.

```
node /skills/common/dry-run/scripts/check.mjs /work/module.js
```

The command prints JSON: `{ "ok": true, "stats": ... }` or `{ "ok": false, "stage": "validate" | "dry-run", "error": "..." }`. A long error is truncated; the JSON names the file that has the rest. Fix the module and run the command again.
