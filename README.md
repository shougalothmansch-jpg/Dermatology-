# Derm Path

A personal, offline-first web app for training toward dermatology: textbook-based study with your own question bank, spaced repetition and timed essays; an interest-group activity log for your CV; and a PROSPERO systematic-review protocol builder.

It runs entirely in your browser. There is no backend and no login. All data is stored locally in IndexedDB.

## Run it

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build a static production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run the TypeScript checker only |

The production build in `dist/` is plain static files that you can host anywhere. It uses hash-based URLs (`#/study`), so it needs no server configuration. To host it under a sub-path, set `BASE_PATH` when you build, e.g. `BASE_PATH=/my-path/ npm run build`.

## Use it on iPhone

The app is published to GitHub Pages at **https://shougalothmansch-jpg.github.io/Dermatology-/**. Every push to `main` redeploys it automatically through `.github/workflows/deploy.yml`.

To install it:
1. Open the link in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Always open Derm Path from the Home Screen icon. It runs full-screen and works offline after the first load.

Good to know on iPhone:
- **The Home Screen app and a Safari tab keep separate data.** Pick one, ideally the Home Screen icon, and stick with it.
- **Exports open the share sheet.** "Export all data" and "Export .md" let you choose **Save to Files**, AirDrop or Mail.
- **Import reads from Files.** "Import backup…" opens the Files picker, so you can restore a backup you saved there.
- **PDFs come from the print view.** Use Share/Print → **Save to Files** (pinch out on the print preview if needed).

One-time setup (already done if the link works): in the GitHub repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.

## Back up your data

Your data lives only in the browser profile you use. Clearing site data, using a private window, or switching browsers or devices will **not** bring it with you.

- **Export:** go to **Settings → Backup & restore → Export all data**. This downloads `derm-path-backup-YYYY-MM-DD.json`, which contains every topic, question, quiz attempt, essay, club entry, protocol and task.
- **Import:** go to **Settings → Import backup…** and choose a backup file. You'll see a summary first. Confirming **replaces** all current data in this browser.
- **Moving devices:** export on the old device, then import on the new one.
- Export regularly (weekly is a good habit) and keep the files somewhere synced, such as cloud storage.

The optional Anthropic API key is **not** included in backups. It stays in this browser's `localStorage` only.

Textbook PDFs and Anki images are also left out of backups because they're too large. After restoring on a new device, add your PDFs again and re-import your Anki deck. Re-importing matches cards by their Anki ID, so your progress is kept.

## What's inside

### Dashboard
- Topics mastered per syllabus section
- Questions due today
- Recent essays and scores
- Total club hours
- Active research protocols

### Study
- **Topic map:** a seeded dermatology syllabus with 17 sections and about 170 topics. You can add, rename, move, reorder and delete sections and topics. Each topic has a status (Not started → Reading → Questions done → Essay done → Mastered), a 1–5 confidence rating, notes, and a chapter reference for each textbook.
- **Textbooks:** comes with Bolognia, Andrews', Rook's and Fitzpatrick's. You can add, edit, reorder or remove them. Chapter numbers start blank so you can match your own editions.
- **Question bank:** write MCQs (4–5 options plus an explanation) or short-answer questions, tagged by topic, textbook and chapter.
- **Quiz modes:**
  - Due for review (spaced repetition)
  - By topic
  - By textbook/chapter
  - Mixed random
  - Weak areas (low-confidence topics and most-missed questions first)
- **Spaced repetition:** uses a simple SM-2 schedule. A missed question, or one rated "Again", comes back tomorrow. "Hard", "Good" and "Easy" each set a different interval.
- **Progress:** accuracy per topic, all-time and for the last 4 weeks, with an 8-week trend line.
- **Essays:** pick a topic and a prompt. Prompts come from generic templates that use a `{topic}` placeholder, or from your own topic-specific ones. You can set an optional countdown timer. The rich-text editor shows a live word count and autosaves as you write. When you finish, you score yourself 0–5 on a rubric: structure, pathogenesis, clinical features, differentials, investigations, management and references. Every essay is saved with its date and score.
- **Textbook PDFs:** add your own PDFs (whole books or chapters) under **Study → Textbooks**. They're stored only on your device and never uploaded to GitHub.
  - **Read in the app:** open a PDF to read it page by page, or in **Text** view.
  - **Make questions from a passage:** in **Text** view, select a passage and tap **Make question**. The question is saved with the exact quote and page number, and an **Open page** link takes you back to that page.
  - **Book page numbers:** if a PDF is a chapter, enter the printed page number of its first page so citations show real book pages.
  - **Scanned PDFs** (no text layer) can be read but not quoted.
- **Anki import:** **Question bank → Import Anki deck** takes an `.apkg` file exported from Anki, in either the old or new format.
  - **Cards keep their look:** images and deck styling come across, and basic, reversed and cloze cards are all supported.
  - **Subdecks become topics:** each subdeck is matched to a syllabus topic with the same name, or gets a new topic under an "Anki: …" section.
  - **Fresh scheduling:** cards start fresh in Derm Path's spaced repetition.
  - **Daily new-card limit:** **Settings → New cards per day** (default 20) controls how many unseen cards join each day's "Due today" queue, like Anki.
  - **Safe to re-import:** importing the same deck again updates cards without duplicating them or losing your progress.
- **Generate questions (optional):** turn it on in Settings and paste your Anthropic API key. The app then calls the Claude API (`claude-opus-5-5`) directly from your browser to draft MCQs. It works in two modes:
  - **From your textbook pages:** pick a PDF and a page range (up to 40 pages). Each question must cite a page and an exact quote, and the app checks that the quote really appears in the PDF. Drafts whose quote can't be found are flagged and left unticked.
  - **From general knowledge** of a topic.

  Nothing is saved until you have reviewed and edited the drafts. In textbook mode, the text of the chosen pages is sent to the Anthropic API with your key.

The app's code contains **no textbook text**. Any PDFs you add stay in your browser's storage on your device. They are never part of this repository, which is public.

### Interest Group
- Log each activity with:
  - date and title
  - role
  - activity type
  - description and hours
  - people/mentors involved
  - outcome and skills gained
  - links
- You can edit the lists of roles and activity types.
- Filter by role, type, date range or free text.
- **Roles timeline** shows how long you held each role, plus a month-by-month list of activities.
- **CV summary** lists total hours, roles held and number of events, with a one-click copy for applications. It respects your current filters.

### Research
- **Master PROSPERO template:** about 36 fields across 4 groups, each with a short hint on what to write. The template itself is read-only.
- **New protocol from template** creates a copy with a unique ID (`PRS-YYYY-NNN`) and a name you choose.
- **Protocol list** shows each protocol's ID, title, last-edited time and % of fields completed. You can open, duplicate, rename or delete protocols (delete asks for confirmation).
- **Saving:** the editor autosaves as you type. There is also a manual **Save** button with a status label, and Ctrl/⌘+S works too.
- **Export:**
  - **Markdown:** downloads a `.md` file.
  - **PDF:** opens a clean print view; use your browser's "Save as PDF".
- **Tasks & milestones:** each protocol has its own list, with due dates and overdue highlighting.

## Project structure

```
src/
  db/          types.ts (data models), db.ts (Dexie schema), seed.ts (seed syllabus & lists), backup.ts
  lib/         sm2.ts, queue.ts (daily review queue), prospero.ts, protocols.ts, anthropic.ts, pdf.ts (pdf.js reader),
               anki/ (apkg importer, template/cloze renderer), settings.ts, utils.ts
  components/  Layout, UI kit (ui.tsx), RichTextEditor, Toast
  pages/       Dashboard, Settings, study/*, club/*, research/*
```

Stack: React 18, Vite, TypeScript, Tailwind CSS, Dexie (IndexedDB), React Router. Libraries are loaded only when needed: pdf.js (PDFs), sql.js + fflate + fzstd (Anki import), and the Anthropic SDK.
