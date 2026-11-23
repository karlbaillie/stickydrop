# Roadmap: ideas not built yet

Numbers match the original Trello-inspired feature list, so "do #8" still means the same thing.
Effort: **S** under an hour, **M** a few hours, **L** a day or more.

Built from this list so far: #2 reminders, #6 recurring notes, #7 labels, #8 archive, #9 sort, #10 tabs, #11 search and
filter, #12 checklist progress (see the README).

## Organising
| # | Feature | Idea | Effort |
|---|---|---|---|
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
- Transparency below 100% opacity is confirmed on macOS only (elsewhere it depends on the compositor).
- Windows has only been exercised by the end-to-end suite on CI, never by hand.
- The in-app global shortcut is unreliable on Wayland; use the `--toggle` system shortcut (see README).
