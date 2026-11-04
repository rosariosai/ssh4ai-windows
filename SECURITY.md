# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the version.

This is a small hobby project maintained by one person. I will do my best to acknowledge a report within a week and to fix confirmed problems promptly, but I cannot promise a fixed timeline.

## Supported versions

Only the latest release is supported.

## Known limitations (by design, not bugs)

- **No login.** Anyone using the Windows account can open the app and its saved hosts.
- **Host passwords** are encrypted with AES-256-GCM using `master.key` in `%USERPROFILE%\.nodeops\`. The key sits next to the data, so this protects against copying the database alone, not against access to the whole user profile.
- **Fallback key.** If `master.key` cannot be read or created, the app derives a fallback key from the Windows user name and the computer name with a fixed salt. That key is predictable to anyone who knows those two values, so treat the fallback as weak. Make sure the profile folder is writable so the random `master.key` is used.
- **SSH server host keys are not verified**, so a man-in-the-middle between you and a server would go unnoticed.
- **Private keys and passphrases** are protected with Windows DPAPI and are tied to the Windows user and computer. If DPAPI is unavailable the app refuses to store keys.
- **Defences in place:** parameterized database queries and a Content-Security-Policy on the app window (since 3.1.2). The Electron `sandbox` option is not enabled yet.
- **The release `.exe` is not code-signed.** Verify what you download, or build from source.

## Using it with AI assistants

An assistant operating the app has the permissions of the connected account and can see all output. Use a restricted account, review its commands, and never share secrets with it.
