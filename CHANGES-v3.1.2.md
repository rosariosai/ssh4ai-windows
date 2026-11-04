# ssh4ai for Windows 3.1.2

Security and cleanup release.

## Security
- Database queries that took a host ID, setting name, macro slot or scratchpad index now use bound parameters instead of text pasted into the SQL. Behaviour is unchanged; a quote character in an ID can no longer alter a query.
- Added a Content-Security-Policy to the app window: only the app's own scripts, styles and fonts load, and nothing can call out to the network from the page.

## Cleanup
- Example hosts, macros and the demo terminal output no longer contain names or paths from the author's own setup; they are generic placeholders.
- Test script uses an obviously fake test secret.
