# Deploying to the Hetzner server from Windows

For the demonstration server that has no domain yet. No WSL and no extra
tooling: Windows 10 and 11 ship OpenSSH, so `ssh` and `ssh-keygen` are already
there.

Substitute your server's address for `<IP>` throughout.

> **PowerShell or `cmd`?** Both work, but they are not interchangeable.
> PowerShell rejects `<` for input redirection — _"The '<' operator is reserved
> for future use"_ — so every command that pipes a file into ssh is written
> twice below. `cmd` behaves the way the examples on the internet assume.

## 1 · Reach the server

```cmd
ssh root@<IP>
```

### If it asks for a password and then refuses it

This is the normal outcome, not a fault, and resetting the root password does
not fix it. **Selecting an SSH key when the server was created makes Hetzner
disable password authentication for ssh.** The password you set through the
console is real — it works in the console, and nowhere else. sshd will only
accept the key.

So use the key:

```cmd
ssh -i %USERPROFILE%\.ssh\id_ed25519 root@<IP>
```

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519 root@<IP>
```

**If you do not have that private key** — a different machine, or it was never
downloaded — recover through the Hetzner console rather than fighting ssh. The
console is a screen attached to the machine, so it is not subject to sshd's
rules, and the root password you set does work there.

Make a key with **its own name**, then copy it to the clipboard rather than
reading it off the screen:

```powershell
ssh-keygen -t ed25519 -C "denghipay-deploy" -f "$env:USERPROFILE\.ssh\denghipay"
```

Press **Enter twice** at the passphrase prompts to leave it empty. Then:

```powershell
Get-Content "$env:USERPROFILE\.ssh\denghipay.pub" | Set-Clipboard
```

Two deliberate choices there, both of which avoid a wasted afternoon.

**`-f` with a distinct name, not `id_ed25519`.** Without `-f`, `ssh-keygen`
prompts for a location and accepts whatever is typed — a key saved to the
Desktop leaves every later command looking in `.ssh`, finding nothing, and
silently falling back to password authentication. And if `id_ed25519` already
exists, overwriting it can fail with `Permission denied` (see below) or quietly
break whatever else was using it. A per-server key sidesteps both and is better
practice regardless.

**No `-N`.** Passing an empty passphrase on the command line is quoted
differently in `cmd`, Windows PowerShell 5.1 and PowerShell 7, and the failure
is silent: the passphrase becomes the literal characters `""` and the key then
refuses to load. Pressing Enter twice is unambiguous in every shell.

> **`Saving key ... failed: Permission denied`** means a key of that name is
> already there and your account cannot replace it — usually read-only, or
> owned with restrictive permissions. Use a different `-f` name as above and the
> problem disappears. To insist on the old name, remove it first:
>
> ```powershell
> Remove-Item "$env:USERPROFILE\.ssh\id_ed25519*" -Force
> ```
>
> If that is also refused, take ownership before removing:
>
> ```powershell
> takeown /f "$env:USERPROFILE\.ssh\id_ed25519"
> icacls "$env:USERPROFILE\.ssh\id_ed25519" /grant "$env:USERNAME:F"
> ```

> ### The two things ssh-keygen shows you, only one of which is the key
>
> After generating, `ssh-keygen` prints a **fingerprint** and a randomart
> picture. Neither is the key.
>
> |                | Looks like                                                  | Use                               |
> | -------------- | ----------------------------------------------------------- | --------------------------------- |
> | Fingerprint    | `SHA256:b0dVTpOjna9YqS6...`                                 | Comparing keys. Useless for login |
> | **Public key** | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... denghipay-deploy` | **This is the one**               |
>
> A fingerprint is a hash **of** the key, so it cannot authenticate anything.
> Pasting one into `authorized_keys` produces exactly the symptom it looks
> least like: the server ignores the unusable line, finds no valid key, and
> falls back to asking for a password it will then refuse.
>
> The real key lives in the `.pub` file, is one line, and always starts
> `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5`. Use `Set-Clipboard` above and the
> question does not arise.

### The reliable way: recreate the server with the key

Do not fight the console. A server with nothing deployed on it can be replaced
in about three minutes, and creating one is the only operation where choosing an
SSH key is guaranteed.

1. **Security → SSH Keys → Add SSH Key**, paste the key, and confirm it appears
   in the list with a fingerprint.
2. **Delete the old server.** It holds nothing.
3. **Create a new one**, ticking the new key in the SSH keys section — the same
   type, image and location as before.
4. `ssh -i "$env:USERPROFILE\.ssh\<name>" root@<NEW-IP>` — straight in, nothing
   typed into a console at all.

**Rebuild is not the same thing and will not help here.** Its dialog offers only
an image, because it re-applies the keys the server was _created_ with rather
than whatever is in the project now. Adding a key to the project and then
rebuilding leaves you exactly where you started, minus the disk.

The new server may or may not get a new IP address. A Primary IP is a separate
resource in Hetzner and survives the server it was attached to unless you delete
it too, so a replacement often lands on the same address. Either outcome is
fine, and the deployment does not care: the front ends call `/api` on whatever
origin served them, so no build, image or configuration references the address.

> **If the address is reused, ssh will refuse to connect.** `known_hosts` still
> holds the deleted server's host key for that IP, and a new machine answering
> on a known address with a different key is indistinguishable from an
> interception — so ssh stops with `REMOTE HOST IDENTIFICATION HAS CHANGED` and
> declines. That is the check working. Drop the stale entry:
>
> ```powershell
> ssh-keygen -R <IP>
> ```
>
> The next connection asks you to accept the new fingerprint, which is the
> expected prompt for a machine you have genuinely just created.

Rebuild does earn its place later — same key, fresh disk, when a server needs
resetting rather than re-keying.

### If you would rather not rebuild

Log into the console as `root` and use **one line**, so the shell either gets a
whole command or nothing:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys 2>/dev/null
echo 'PASTE_THE_KEY_HERE' > ~/.ssh/authorized_keys
```

Paste over `PASTE_THE_KEY_HERE`, keeping the single quotes, then press Enter.
Confirm it took:

```bash
cat ~/.ssh/authorized_keys
```

> **Do not use `cat > file` for this.** The redirection empties the file the
> moment the shell opens it, before you have typed anything — so pressing Ctrl-C
> because a paste did not arrive leaves you with an empty `authorized_keys`,
> having also destroyed the key that was already in it. The symptom is a
> password prompt that refuses every password, which looks like the problem you
> started with. `echo '…' > file` cannot fail that way: nothing is written until
> the command runs.

Rewriting the file is safe: the console does not go through sshd, so it stays
available whatever the file ends up containing.

Now connect, naming the key you just made:

```powershell
ssh -i "$env:USERPROFILE\.ssh\denghipay" root@<IP>
```

It should let you in without asking for anything.

### Optional: stop typing `-i` every time

Skip this if you are in a hurry — `-i` works, and a malformed config file blocks
**every** ssh command on the machine, including ones that do not name a host in
it. Overwrite rather than append, and use ASCII: PowerShell's default UTF-16
produces a file OpenSSH cannot parse, and appending twice leaves a duplicate
block whose second copy reports as a syntax error on a line you did not write.

```powershell
Set-Content -Encoding ascii "$env:USERPROFILE\.ssh\config" @"
Host denghipay
  HostName <IP>
  User root
  IdentityFile ~/.ssh/denghipay
"@
```

If ssh starts refusing everything with `bad configuration options`, delete the
file and carry on with `-i`:

```powershell
Remove-Item "$env:USERPROFILE\.ssh\config"
```

For reference, the block itself is:

```
Host denghipay
  HostName <IP>
  User root
  IdentityFile ~/.ssh/denghipay
```

`ssh denghipay` now does the whole thing, and so does
`Get-Content infra\scripts\harden-host.sh -Raw | ssh denghipay "bash -s"`.
Change `User root` to `User deploy` after hardening. This is worth the minute:
most of the failures above were a wrong or missing `-i`, and a config file
cannot forget.

Everything after this is comfortable again. Recovering ssh through the console
is the right use of it; running the whole deployment there is not. The console
has no scrollback worth the name and no reliable way to copy text out, which
turns any build error into a transcription exercise.

## 2 · Harden it, before anything else is on it

From your clone of the repository:

```cmd
ssh root@<IP> "bash -s" < infra\scripts\harden-host.sh
```

```powershell
Get-Content infra\scripts\harden-host.sh -Raw | ssh root@<IP> "bash -s"
```

`-Raw` matters: without it PowerShell splits the file into lines and rejoins
them with CRLF, and the script dies on `$'\r': command not found`. The
repository forces LF on shell scripts through `.gitattributes` for the same
reason, so a fresh clone is already correct — `-Raw` covers the case where an
older clone still has CRLF on disk.

This creates a `deploy` user, installs Docker, turns on the firewall and
`fail2ban`, and disables root login and password authentication.

It will not disable root login unless the `deploy` user has a key to get back in
with — it copies root's `authorized_keys` across automatically, and refuses to
touch the ssh configuration at all if there is nothing to copy. That guard is
there because the alternative is being locked out of a server you created ten
minutes ago.

**Keep this window open** until you have proved the next command works:

```cmd
ssh deploy@<IP>
```

(Identical in PowerShell — only the redirection syntax differs between them.)

Only close the root session once that succeeds.

## 3 · Let the server read the private repository

The server needs its own read-only credential. Do not copy your personal key
onto it, and do not paste a personal access token: a deploy key is scoped to one
repository, is read-only, and is revoked by deleting one line in a settings
page.

On the server, as `deploy`:

```bash
ssh-keygen -t ed25519 -C "denghipay-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. In GitHub: **rogerpanel/DenghiPay → Settings → Deploy
keys → Add deploy key**. Give it a name, paste the key, and **leave "Allow write
access" unticked** — the server only ever reads.

Then, still on the server:

```bash
ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # expect: "successfully authenticated"
git clone git@github.com:rogerpanel/DenghiPay.git
cd DenghiPay
git checkout claude/morapay-development-t9e1ga
```

## 4 · Deploy

```bash
infra/scripts/server-deploy.sh
```

The first run takes a few minutes: it builds the API and both front ends from
source on the server, generates a `.env` with fresh secrets, creates the
database, runs migrations, seeds the chart of accounts and the demonstration
data, starts everything, and then checks it.

It does not finish quietly on failure. It waits for both front ends, confirms
each one can reach the API **through its own origin**, and confirms the ledger
reports itself balanced. Those checks are the point: a page that renders proves
nothing, because the failure this arrangement exists to prevent is a front end
that loads perfectly and then fails every request.

To redeploy after a change:

```bash
cd ~/DenghiPay && git pull && infra/scripts/server-deploy.sh
```

Safe to repeat. The database survives; transfer history and the ledger are not
touched beyond running migrations.

### If the build runs out of memory

Unlikely on 16 GB, but if the Next build is killed, give Docker more room:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

## 5 · Open the ports

The hardening script's firewall allows 80 and 443. The back office is on 8080,
so allow that too — on the server:

```bash
sudo ufw allow 8080/tcp comment 'back office'
```

And in the Hetzner console, if you created a cloud firewall, add the same rule
there. It sits in front of the host, so a rule missing from it blocks traffic
before `ufw` ever sees it — which looks exactly like the application being down.

---

# Viewing it without a domain

## The quick way: by IP

```
Sender app     http://<IP>
Back office    http://<IP>:8080
```

Sign in as `chidi@demo.morapay.local` / `morapay-demo-2026`, or
`compliance@morapay.local` / `morapay-local-staff-2026`.

This works because both front ends are built to call `/api` on whatever origin
served them, rather than a hard-coded host. The same build works on the IP today
and on `denghipay.com` later, with no rebuild.

**Be clear about what plain HTTP costs**, because it is not only cosmetic:

- Passwords cross the network in the clear. The seeded accounts are fictional
  and the rails are simulated, so nothing real is exposed — but do not use a
  password here that you use anywhere else.
- The browser will not install the app to a home screen and the service worker
  will not register, because both need a secure context. The offline behaviour
  cannot be tested at all.
- Chrome and Safari will mark the site "Not secure" in the address bar. In front
  of a CEO that is a distraction you do not need.

## The better way: real HTTPS, still without a domain

You can have a genuine, publicly-trusted certificate today, because
`sslip.io` resolves any IP-shaped hostname to that IP, and Let's Encrypt will
issue for it:

```
62.238.23.185.sslip.io   →   62.238.23.185
```

That is a real hostname, so it gets a real certificate, so the browser is
satisfied, the install prompt appears, and the offline shell can be tested. It
costs nothing and needs no registrar.

The production compose file already contains nginx and certbot for exactly this
shape. Point them at the `sslip.io` name instead of the domain, issue, and swap
the name for `denghipay.com` when DNS is ready — the runbook for that swap is
[`runbooks/change-domain.md`](runbooks/change-domain.md).

**Two limits worth knowing before you rely on it.** Let's Encrypt rate-limits
certificates per registered domain, and `sslip.io` is one registered domain
shared by everyone using the trick — so issuance can fail for reasons that have
nothing to do with you. And the hostname contains the IP, so it changes if the
server does. It is right for a demonstration and wrong for a pilot.

## The third way, if the server is the problem

If you want testers on the application before the server is sorted at all,
`pnpm demo:preview` on a laptop plus a Cloudflare tunnel gives HTTPS in about a
minute. See [`PREVIEW.md`](PREVIEW.md). The server is the better answer once it
is running, because it stays up when the laptop closes.

---

## What this deployment is not

`infra/compose/server.yml` builds from source, ships its own PostgreSQL, and
publishes plain HTTP. That is the right set of trades for a demonstration box
with no domain, and the wrong set for production.

`infra/compose/production.yml` is the other one: tagged images from the
registry, TLS terminated in nginx, PostgreSQL supplied rather than assumed, and
Prometheus and Grafana alongside. Move to it when there is a domain — and note
that `LIVE_FUNDS_ENABLED` stays false in both until the legal opinions and
partner agreements in [`OPEN_ITEMS.md`](OPEN_ITEMS.md) exist. Neither file can
turn it on; that is a deliberate human act in production, once.
