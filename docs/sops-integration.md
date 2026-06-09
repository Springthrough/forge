# Using SOPS (and other secret tools) with Forge

Forge supports decrypting secrets at process spawn via a generic per-process `envFileCommand`. SOPS is the most common consumer, but forge knows nothing about SOPS specifically — it runs whatever command you configure and parses stdout as dotenv. The same mechanism works for `age`, `op inject` (1Password), `aws-vault exec`, `pass`, or any custom script that emits `KEY=value` on stdout.

## What the feature does

For each process in `.forge/config.json`, you can declare:

```jsonc
"envFileCommand": ["sops", "-d", "--output-type", "dotenv", "secrets/prod.enc.yaml"]
```

On every `forge up`, `forge restart`, or `forge up <name>`, forge:

1. Runs the command from the **project root** (paths are repo-relative).
2. Captures stdout. Parses it as `KEY=value` lines — supports `#` comments, blank lines, and matching `"`/`'` quotes.
3. Merges those keys into the spawned process's environment, **overriding** same-named keys from `env: {}` or `envFile:`.

Plaintext is held only in the child process's environment block. It is **never** written to `.env.forge` or any other file on disk.

## Resolution order (low → high priority)

```
shared service env vars  →  inline env: { ... }  →  portEnv  →  envFile  →  envFileCommand
                                                                            ^^^^^^^^^^^^^^^^
                                                                            wins
```

Common pattern — non-secret defaults inline, encrypted secrets via the command:

```jsonc
{
  "name": "api",
  "command": "uvicorn app:server",
  "env":            { "LOG_LEVEL": "info" },
  "envFile":        ".env.shared",
  "envFileCommand": ["sops", "-d", "--output-type", "dotenv", "secrets/prod.enc.yaml"]
}
```

## SOPS setup

### 1. Install sops

```bash
# macOS
brew install sops

# Linux / others
curl -L -o sops https://github.com/getsops/sops/releases/latest/download/sops-vX.Y.Z.linux.amd64
chmod +x sops && sudo mv sops /usr/local/bin/
```

Confirm: `which sops` (the binary must be on the daemon's PATH).

### 2. Pick a key source

| Key source | Best for | Setup |
|---|---|---|
| **age** | Local-only dev, no cloud | `age-keygen -o ~/.config/sops/age/keys.txt`; record the public key in `.sops.yaml` |
| **AWS KMS** | Teams with AWS SSO | Configure `aws sso login` (or `aws-vault`); reference KMS ARN in `.sops.yaml` |
| **GCP KMS** | GCP teams | `gcloud auth application-default login`; reference KMS resource in `.sops.yaml` |
| **PGP / GPG** | Existing GPG infra | `gpg-agent` running with the key cached |

Forge runs the decrypt command non-interactively (no TTY attached) — your key agent must already be authenticated. Passphrase / Yubikey / MFA prompts will fail with EOF and forge will surface a clear error.

### 3. Configure `.sops.yaml` at repo root

```yaml
# .sops.yaml
creation_rules:
  - path_regex: secrets/.*\.yaml$
    age: <YOUR_PUBLIC_AGE_KEY>          # for age
    # kms: 'arn:aws:kms:us-east-1:...'  # for AWS KMS
    # pgp: '<YOUR_GPG_FINGERPRINT>'     # for PGP
```

### 4. Create and encrypt a secrets file

Forge expects **dotenv-format stdout** (`KEY=value` lines). SOPS preserves your source format, so always pass `--output-type dotenv` regardless of whether the encrypted source is YAML, JSON, or `.env`.

Author the plaintext:

```yaml
# secrets/prod.dec.yaml — temporary; will be encrypted then deleted
DB_PASSWORD: <REPLACE_ME>
STRIPE_API_KEY: <REPLACE_ME>
JOBS_SERVICE_URL: http://jobs:5000
```

Encrypt it:

```bash
sops -e secrets/prod.dec.yaml > secrets/prod.enc.yaml
rm secrets/prod.dec.yaml
git add secrets/prod.enc.yaml .sops.yaml
```

Verify decryption works manually before wiring forge:

```bash
sops -d --output-type dotenv secrets/prod.enc.yaml
# Should print: DB_PASSWORD=...  STRIPE_API_KEY=...  JOBS_SERVICE_URL=...
```

### 5. Wire it into `.forge/config.json`

```jsonc
{
  "name": "my-project",
  "processes": [
    {
      "name": "api",
      "command": "uvicorn app:server",
      "cwd": "services/api",
      "ports": [8000],
      "portEnv": "PORT",
      "env": { "LOG_LEVEL": "info" },
      "envFileCommand": [
        "sops", "-d", "--output-type", "dotenv", "secrets/prod.enc.yaml"
      ]
    }
  ]
}
```

Key points:
- `envFileCommand` is **argv form** — an array of strings. No shell interpolation. Don't pass `"sops -d ..."` as a single string; forge will reject it.
- File paths inside the argv are relative to the **project root**, not the process's `cwd`.

### 6. Apply

```bash
forge restart api
```

Forge re-reads `.forge/config.json` from disk on every command, so no `forge reload` is needed first.

## Verifying it worked

Inside the process's terminal in the dashboard, the decrypted env should be visible to the running command. Quick host-side check:

```bash
# Get the PID from `forge service list`
ps eww <pid> | tr ' ' '\n' | grep DB_PASSWORD
```

Or temporarily have the process print one of the keys at startup.

## Failure modes and what you'll see in the dashboard card

All errors block the spawn and appear in the process's dashboard card in red. Multi-line errors render correctly at column 0 (forge normalizes `\n` → `\r\n` for xterm).

| Card shows | Cause | Fix |
|---|---|---|
| `command not found or not executable: sops (ENOENT)` | `sops` isn't on the daemon's PATH | Install sops, or use an absolute path in the argv |
| `exit 128` + stderr containing `no such file` | Wrong path in argv | Paths are relative to the **project root**, not the process's `cwd` |
| `exit 128` + stderr `Error decrypting` or `failed to get the data key` | Key agent not authenticated, or wrong key | Re-authenticate: `gpg-agent`, `aws sso login`, etc. |
| `exit 128` + stderr `config file not found` | `.sops.yaml` missing | Create one at repo root |
| `timeout after 30000ms` | Command took longer than 30 s | Pre-warm credentials (e.g. `aws sso login` ahead of time) |
| `envFileCommand must be a non-empty array` | You wrote it as a string | Use argv form: `["sops", "-d", "..."]` |
| `envFileCommand produced no entries` | Stdout was empty or unparseable | Verify manually with the same argv; check `--output-type dotenv` is set |

After fixing, `forge restart <process>` re-runs the command.

## Working with the dashboard

Once the feature is set up, the daily flow is just:

1. Edit `secrets/prod.enc.yaml` via `sops secrets/prod.enc.yaml` (sops opens your editor with plaintext, re-encrypts on save).
2. `forge restart <name>` — the process respawns with the new secrets.

No `forge reload` step, no re-running `sops -d` by hand.

## Alternative decrypt tools

The same `envFileCommand` mechanism works for any tool that can write dotenv to stdout:

| Tool | Example argv |
|---|---|
| **1Password CLI** | `["op", "inject", "-i", "secrets/.env.tpl"]` |
| **aws-vault** | `["aws-vault", "exec", "myprofile", "--", "sh", "-c", "env \| grep ^MYAPP_"]` |
| **HashiCorp Vault** | `["sh", "-c", "vault kv get -format=json secret/myapp \| jq -r '.data.data \| to_entries[] \| \"\\(.key)=\\(.value)\"'"]` |
| **`pass`** | `["sh", "-c", "echo DB_PASSWORD=$(pass show myapp/db)"]` |
| **Custom script** | `["./scripts/load-secrets.sh", "prod"]` |

Anything that emits `KEY=value` lines on stdout works.

## Security notes

- Plaintext lives **only** in the spawned process's environment block (kernel-held, per PID). It is not written to `.env.forge` or any other file forge generates.
- The decrypt command runs with the same privileges as the forge daemon, so the daemon process has access to your key agents (`gpg-agent`, `aws-vault`, etc.).
- Forge re-runs the command on every spawn — there's no in-memory caching of decrypted values. Secret rotations are picked up the next time you `forge restart`.
- If you want to keep `.env.forge` out of your repo (it's generated by forge with port and service env vars; not secrets), forge auto-adds it to `.gitignore` if a `.gitignore` exists. Decrypted secrets never touch this file regardless.
- Commit only `secrets/prod.enc.yaml` (encrypted) and `.sops.yaml` (public key references). Never commit the plaintext `.dec` file or your private age/PGP keys.

## What's not supported (yet)

- **Project-level `envFileCommand`** — must be declared per process. Repeat it across processes that share a secrets file.
- **JSON or YAML stdout** — dotenv only. Use `--output-type dotenv` with sops.
- **Per-value URI scheme** — there's no `env: { KEY: "sops:secrets.enc#key" }` syntax. Decrypt at the file level.
- **Interactive prompts** — the daemon doesn't attach a TTY, so passphrase / MFA prompts will fail. Pre-authenticate your key agent.
- **Caching / TTL** — every spawn re-runs the command. Slower decryptors will add 0.5–3 s to each restart.
