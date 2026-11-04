# Privacy policy: ssh4ai for Windows

Effective date: 2026-11-04

ssh4ai for Windows is a local SSH client. It does not collect, transmit, sell or share personal information.

## What the app does not do
- No accounts, no sign-in, no advertising.
- No analytics, telemetry or crash reporting.
- No automatic update checks and no connection to any server run by the developer.

## What is stored on your computer
Everything the app keeps stays on your own PC, in `%USERPROFILE%\.nodeops\` and in the app's own browser storage:
- Saved hosts: name, address, port, username and authentication type.
- Host passwords, encrypted with AES-256-GCM using a random key in `master.key` in the same folder.
- SSH private keys and passphrases, encrypted with Windows DPAPI (tied to your Windows user and computer).
- Macros, Web Link buttons and scratchpad notes that you type in.

You are in control of this data. To remove it, delete the `.nodeops` folder (and uninstall the app).

## Network connections
The app only connects to the SSH servers that you add, on the addresses and ports you choose. What you type in a terminal session and the output you see travel between your PC and that server, protected by SSH. The developer does not see any of it. Web Link buttons and links in terminal output open in your default web browser; the app itself contacts no other servers.

## Third parties
None. The app does not use third-party online services. It is open source (MIT licence): https://github.com/rosariosai/ssh4ai-windows

## Children
The app is a general developer tool and is not directed at children.

## Changes and contact
If this policy changes, the new version will be published in this file with a new effective date. Questions and issues: https://github.com/rosariosai/ssh4ai-windows/issues . To report a security problem privately, use the repository's Security tab ("Report a vulnerability").
