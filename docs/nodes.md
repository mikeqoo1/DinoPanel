# Remote Nodes (v0.6.2)

The Nodes module registers remote Linux hosts and shows live read-only
metrics (CPU, memory, disks, uptime) and Docker container state.
No agent is installed on the remote host — the panel SSHs in on demand
using the system `ssh` binary and reads `/proc` files and `docker ps`.

## Onboarding a node

All commands run on the **panel host** (e.g. 234 in the reference
environment).

```bash
# 1. Create an ed25519 key for the panel process's account (skip if one exists).
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''

# 2. Push the public key to the remote host.
#    Enter the remote root password once at this prompt — it is never stored.
ssh-copy-id root@192.168.199.235

# 3. Register the node in the panel.
#    Navigate to /nodes → Add Node, or via API:
curl -X POST http://localhost:9999/api/nodes \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"rocky-235","host":"192.168.199.235","user":"root","port":22}'
```

`ssh-copy-id` prompts for the remote password once (a one-time operator
action) and installs the key. **The password is never stored** — neither
by `ssh-copy-id` nor by the panel. The panel holds no secrets; it only
stores the non-secret connection parameters (`name`, `host`, `port`,
`user`).

## Auth model

Authentication is **key-only**. The panel shells out to the system `ssh`
binary with `BatchMode=yes`, which causes SSH to fail immediately if no
pre-installed key covers the target host. No password is ever prompted,
cached, or transmitted through the panel.

Keys live under `~/.ssh/` on the panel host, managed entirely by the OS.
The panel stores only: `id` (UUID), `name`, `host`, `port`, `user`.

> Deferred: password auth and custom key paths — pending a SecretsService
> (see `.arceus/changes/v0.6.2-remote-node-monitoring/decisions.md` D2).

## TOFU policy

SSH uses `StrictHostKeyChecking=accept-new`. On the first connection to a
host the remote server's public key is accepted and written to
`~/.ssh/known_hosts` automatically (Trust On First Use). Every subsequent
connection is verified against the stored key.

**Host key changed** — if the remote host's key changes (OS reinstall,
hardware swap), SSH will refuse the connection and the panel returns
`NODES_HOSTKEY_CHANGED` (HTTP 502). To remediate:

```bash
# Remove the stale entry on the panel host.
ssh-keygen -R 192.168.199.235

# Optional: verify the new fingerprint out of band before reconnecting.
# The next panel request auto-accepts and records the new key.
```

The `NODES_HOSTKEY_CHANGED` error message includes the path to the
`known_hosts` file and the offending line number.

## Error codes

| Code | HTTP | Meaning | Operator action |
| --- | --- | --- | --- |
| `NODES_UNREACHABLE` | 502 | SSH connection failed — refused, no route, or connection timed out | Check network/firewall between panel host and node; confirm sshd is running on the target. |
| `NODES_AUTH_FAILED` | 502 | Key rejected (`Permission denied (publickey)`) | Re-run `ssh-copy-id <user>@<host>` from the panel host; check key permissions (`chmod 600 ~/.ssh/id_ed25519`). |
| `NODES_HOSTKEY_CHANGED` | 502 | Remote host key does not match the stored `known_hosts` entry | Run `ssh-keygen -R <host>` on the panel host (see TOFU policy above). |
| `NODES_TIMEOUT` | 504 | The metrics command did not complete within the 15 s timeout | Node is overloaded or the remote command hung; retry in a few seconds. |
| `NODES_TOOL_MISSING` | 503 | `ssh` binary not found on the panel host | Install OpenSSH client: `dnf install openssh-clients` (RHEL/Rocky) or `apt-get install openssh-client` (Debian/Ubuntu). |
| `NODES_DUPLICATE` | 409 | A node with the same `host:port` is already registered | Use the existing registration, or delete it first if you need to re-register. |

All error responses include a `code` field and a short human-readable
`message`. Raw SSH stderr is never forwarded to the client; it is logged
server-side for operator diagnosis.

## Polling

Polling is **frontend-only** and only runs while the `/nodes` page is
open. The server is stateless — it executes an SSH command per request
with no background threads or cached state.

| Data | Interval |
| --- | --- |
| Host metrics (CPU, memory, disks, uptime) | 10 s |
| Container list | 30 s |

Containers poll at 30 s (vs. 10 s for metrics) to halve the SSH load,
since container state changes far less frequently than system metrics.

Both queries use `retry: false` — a failed poll shows a status pill
(unreachable / auth-failed / hostkey-changed / timeout) and waits for
the next interval rather than retrying against a dead node.

## Read-only guarantee

The panel performs **no remote mutations**. The commands executed over
SSH are fixed read-only constants defined in the server source:

- **Metrics**: reads `/proc/stat` (twice, 1 s apart for CPU delta),
  `/proc/loadavg`, `/proc/meminfo`, `/proc/uptime`, and
  `df -PTB1 -x tmpfs -x devtmpfs -x overlay`.
- **Containers**: `docker ps -a --format '{{json .}}'`

No `start`, `stop`, `restart`, `rm`, `exec`, or `systemctl` command is
ever issued to a remote node. This is enforced at the source level
(AC7: `grep -rE 'docker (start|stop|restart|rm|exec)|systemctl' apps/server/src/modules/nodes/`
yields zero hits).

`docker` not being installed on the remote host is an expected state,
not an error — the panel returns `{ dockerAvailable: false, containers: [] }`
and the UI renders "Docker not installed" rather than an error block.
