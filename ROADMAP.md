# Roadmap: ideas not built yet

Numbers match the original Trello-inspired feature list, so "do #8" still means the same thing.
Effort: **S** under an hour, **M** a few hours, **L** a day or more.

Every one of these needs only small additions to the note data (`labels`, `archived`, `order`, ...); old data migrates.

## Organising
| # | Feature | Idea | Effort |
|---|---|---|---|
| 2 | **Reminders** | Desktop notification at the due time or N minutes before (lead time in settings). Only fires while the app runs (it lives in the tray). Needs due dates. | M |
| 6 | **Recurring notes** | Daily/weekly/monthly. Marking a recurring note done rolls its due date forward. Needs due dates and done. | S–M |
| 7 | **Labels** | Named coloured tags (Action, Question, Decision...) with a filter. Note colour alone is only a rename of the 5 palette slots. | M |
| 8 | **Archive** | Delete becomes archive, with an archive view to restore or delete for good. Today a deleted note is gone after the 6 s undo. | M |
| 9 | **Sort** | Sort by due date / age / colour. Drag-to-reorder now exists in both layouts. | S |
| 10 | **Tabs (separate boards)** | Separate note sets, e.g. one per meeting or "Personal". Closest to Guake's tabs, short of full Kanban. | M |
| 11 | **Search and filter** | `Ctrl+F` across notes; quick filters: overdue, due today, has label. | S–M |
| 12 | **Checklist progress** | "2/5" badge from the `- [ ]` tasks already in a note. | S |
| 13 | **Templates** | New note from a template, e.g. Agenda / Actions / Decisions skeleton. | S |
| 14 | **Note size** | Collapse a note to a title strip; wide/narrow notes. | S |

## Content and data
| # | Feature | Idea | Effort |
|---|---|---|---|
| 15 | **Images / attachments** | Paste a screenshot, store it locally, render inline (needs `img-src` in the CSP and Markdown image support). | M–L |
| 16 | **Export / import** | Copy a note as Markdown; export all notes to Markdown or JSON; import a file. | S |
| 17 | **Sync location** | Setting to point `data.json` at a Syncthing / Dropbox / Nextcloud folder so notes follow you between machines. | S |

## Not from Trello, suited to meetings
| # | Feature | Effort |
|---|---|---|
| 18 | **Insert timestamp** shortcut (e.g. `Ctrl+;` types `[14:32]`) to stamp points in a call | S |

## Kanban extras (not built)
Per-column sort; dragging by touch (native drag-and-drop has no touch support in desktop Chromium).

## Left out on purpose
Assignees, comments, watch, votes, stickers and Butler-style automation: they need other people or don't fit a single-user drop-down.

## Left over from Guake's preferences
Pixel offsets for the window position (the alignment options cover it), background image, scrollbar and tab options.

## Known gaps in what exists
- Transparency below 100% opacity is untested visually (depends on the compositor).
- macOS and Windows paths are untested; `.github/workflows/build.yml` has never run.
- The in-app global shortcut is unreliable on Wayland; use the `--toggle` system shortcut (see README).
