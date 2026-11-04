# ssh4ai v3.1.1

## Fixed
- Terminal showed a stray `#` / extra spaces after the shell prompt (zsh, e.g. `root@ZC2 /root ➜`).
  Cause: a window resize that happened while the SSH login was still in progress was dropped, so the
  remote shell kept a wrong initial size (e.g. 9x5) while the window was 140x33. zsh then printed its
  end-of-line marker padded to the wrong width.
  Fix (`src/main/ssh-manager.cjs`): the latest size is remembered while connecting and applied to the
  remote PTY as soon as the shell is open (`pendingSizes`).

## Files changed
- src/main/ssh-manager.cjs
- package.json, package-lock.json (version 3.1.1)
- CHANGES-v3.1.1.md (this file)

## Rollback
`git revert` the v3.1.1 commit, or reinstall v3.1.0.
