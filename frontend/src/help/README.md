# The help

The public help at `/help/<topic>` explains the website and the desktop client. Nobody needs to sign in to read it. Inside the app, the `?` in the top bar or next to a page's title opens the topic for the page you are on, in a panel on the right. `?` on the keyboard does the same.

- `topics.json` lists the topics in order, each in a group (`start`, `website`, `client`, `more`). Under `routes`, it says which topic explains each page.
- `content/<lang>/<topic>.md` holds the text. Every topic needs every language (`en`, `da`). The first line is the title: `# Title`.
- `../../public/help/screens/<lang>/` holds the screenshots.

## Writing

- Link to another topic by its id: `[Materials](materials)`.
- Show a screenshot as `![What it shows](screens/web-materials.jpg)`. The text after `!` is the caption.
- Write keys and on-screen labels as code, the way the screen spells them: `` `F8` ``, `` `Add materials` ``. Use the Danish label in the Danish text.
- Follow the website's own wording, and keep sentences short.

## When the website or the client changes

A change people can see needs the help changed in the same commit: a new page, a renamed button, a new setting, hotkey or step.

1. Change the text in both languages.
2. Re-shoot the screenshots: `node frontend/scripts/help-screens.cjs`. Its header says how to start the demo data and the client preview first. Look at every changed shot before committing it.
3. Run `npm --prefix frontend run help:check`. It also runs before every build, and fails when a page has no topic, a topic lacks a language, a link points nowhere, or a screenshot is missing.

The client session sends a note for every client change players can see, so the client topics can follow.
