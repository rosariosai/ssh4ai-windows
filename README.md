# ssh4ai for Windows

A native Windows 11 desktop SSH client with tabbed sessions, a saved host list, command macros and scratchpads. It is the installable twin of [ssh4ai](https://github.com/rosariosai/ssh4ai) (the self-hosted web version) and looks and behaves the same, because its screen is the web app's own front end running in Electron.

The name means **SSH for AI**: a plain, predictable interface that is easy for a person to use and easy for a browser- or screen-driving AI assistant to operate. There is no built-in AI integration; read [Using it with an AI assistant](#using-it-with-an-ai-assistant) before you give an assistant access to a live shell.

Everything stays on your computer. There is no account and no telemetry.

<!-- Add a screenshot here: docs/screenshot.png, using demo hosts only. -->

## Features

- Several SSH sessions at once, in tabs ([xterm.js](https://xtermjs.org/) and `ssh2`), including keyboard-interactive login
- Saved hosts: pin, drag to reorder, filter, double-click to connect
- **Per-host authentication**: password, private key, or key with password fallback. Paste a key, load it from a file, or generate an ed25519 key pair; the public key is shown with a Copy button for `authorized_keys`
- 5 Quick Command macros (lockable, optional auto-Enter) and 5 scratchpad buckets; `Ctrl+J` toggles the dock
- Web Links dock with 4 launcher slots
- Copy log, Save .log, Clear, Copy+Clear, and a Zen mode (also real fullscreen)
- Works offline: fonts and terminal library are bundled
- Host passwords encrypted with AES-256-GCM; private keys and passphrases protected with Windows DPAPI

## Install

1. Download `ssh4ai-<version>.exe` from the [Releases](https://github.com/rosariosai/ssh4ai-windows/releases) page. It is a portable app: no installer, just run it.
2. **The file is not code-signed**, so Windows SmartScreen may show "Windows protected your PC". Click **More info**, then **Run anyway**. If you prefer not to trust a binary, build it yourself (below); the source is all here.

## Run from source / build

Requires Windows and Node.js 18 or newer.

```powershell
npm install
npm start              # run the app
npm run build:exe      # portable .exe in dist\ssh4ai-<version>.exe
npm run test:db        # check the vault and database engine
```

`npm run package:win` produces an unpacked folder build instead of a single .exe.

## Where your data lives

All data is local, in `%USERPROFILE%\.nodeops\` (the folder keeps the name of the project's earlier title so existing data keeps working):

| File | Content |
|---|---|
| `nodeops.db` | Database: hosts, macros, links, settings |
| `master.key` | 256-bit key that encrypts host passwords. Back it up separately: without it saved passwords cannot be decrypted |
| `nodeops.db.bak-pre-keyauth-<date>` | Automatic copy made before the key-auth migration; delete it once you are happy |

SSH private keys and passphrases are stored in the database as `dpapi1:` blobs, encrypted with Windows DPAPI (Electron `safeStorage`). They can only be decrypted by the same Windows user on the same computer; if you move the database, add the keys again. If DPAPI is not available the app refuses to save or use keys rather than storing them in plain text. Scratchpad text is kept in the app's browser storage, not in the database.

## Security

See also [SECURITY.md](SECURITY.md). In short:

- **No login.** Anyone using your Windows account can open the app and its saved hosts.
- **`master.key` sits next to the data** in your user profile. The encryption protects against copying the database alone, not against access to your whole profile.
- **SSH server host keys are not verified yet**, so a man-in-the-middle on the network would not be detected.
- Private keys are DPAPI-protected and tied to your Windows user.
- Database queries use bound parameters, and the app window has a Content-Security-Policy that only allows its own scripts, styles and fonts.

## Using it with an AI assistant

An assistant that types into your terminal has the permissions of the account you connected with and can see everything on screen. If you let one drive ssh4ai:

- connect with a limited, non-root account, ideally read-only;
- keep a person in the loop for anything that changes or deletes data;
- never paste passwords, keys or tokens into the chat.

## Project layout

| Path | Role |
|---|---|
| `src/main/main.cjs` | Electron main process: window, IPC |
| `src/main/preload.cjs` | Bridge exposed to the screen |
| `src/main/api.cjs` | Serves the web app's REST API from the local database |
| `src/main/db.cjs`, `vault.cjs` | Database and password encryption |
| `src/main/keyauth.cjs` | Key authentication: DPAPI storage, key validation and generation |
| `src/main/ssh-manager.cjs` | SSH connections and shells |
| `src/renderer/` | Front end (shared with the web app) plus the Electron-only layer in `electron-shim.js` |

Change history: `CHANGES-v3.0.0.md`, `CHANGES-v3.1.0.md`, `CHANGES-v3.1.1.md`.

## Contributing

Issues and pull requests are welcome. `npm run test:db` checks the vault and database (including that quotes in IDs cannot alter SQL); more tests are welcome.

## License

MIT, see [LICENSE](LICENSE).

## Story behind it

Why I built ssh4ai and how it works with Claude: [I built a tool so Claude could work on my servers](https://rosariosai.substack.com/p/i-built-a-tool-so-claude-could-work) (The Daily Calf).

