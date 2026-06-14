[English](README.md) | [Русский](README_ru.md)

---

# Character Folders

A SillyTavern extension that finally lets you organise your character list the way it deserves: collapsible, nestable folders with colours, icons, smart auto-fill rules, and pinning. It also reaches the home screen — a quick-launch shelf of pinned characters and Recent Chats grouped by your folders.

**Important:** Your character cards are never touched. The whole folder structure lives in the extension's settings — delete the extension and every card returns exactly as it was. (Still, make backups.)

**Note:** This extension is actively developed and not perfect. Bugs can and will happen. If something breaks, check the browser console for errors and report an issue with details.

---

## Features

### 1. Folder system
Organise characters into folders that show up as collapsible groups at the top of the character list:
- **Nested folders:** Create subfolders via the "Parent folder" picker. Go as deep as you want (with cycle protection).
- **Colours & icons:** Give each folder a colour stripe and an emoji/icon for fast visual navigation.
- **Collapse / expand:** Per-folder toggles plus a one-click "collapse/expand all". State is remembered.
- **True counts:** Folder headers show the real number of characters across all pages, not just the visible one.

### 2. Filing characters (mobile-first)
- **Folder button:** Tap the 📂 button on any character card and pick a folder from the list. Large tap targets, works great on phones.
- **Drag-and-drop:** On desktop, drag a character card onto a folder header.
- **Group chats:** Group entities can be filed into folders too, just like single characters.

### 3. Pinning & solo filter
- **Pin folders:** Pin a folder so it always floats to the top, regardless of the sort order.
- **Solo filter:** The 👁 button shows only that folder and hides everything else; a chip in the toolbar clears it.

### 4. Smart folders (auto-fill)
Give a folder a rule and matching characters land in it automatically:
- **Has tag…** — by a native SillyTavern tag.
- **Name contains…** — by a substring of the name.
- **Created after date…** — by the card's creation date (`YYYY-MM-DD`).

A manual assignment always wins over a smart rule.

### 5. Home / welcome screen
The extension also works on SillyTavern's home screen:
- **Pinned-characters shelf:** A row of one-click quick-launch characters at the top. Pin a character with the 📌 button on its card.
- **Grouped Recent Chats:** Recent chats are organised into the same character folders (by the chat's avatar), with collapsing and pinned folders on top. Un-foldered chats stay in their normal order below.
- Both are toggled in the settings ("Home screen" section) and on by default.

### 6. Bulk operations
Hit **Select** to toggle checkboxes on the character cards, then **Move selected** to file them all into a folder at once.

### 7. Folder sorting
Order folders manually (drag-free `▲▼` arrows, mobile-friendly), or by name A→Z / Z→A, or by character count. Pinned folders always come first.

### 8. Export / import
Back up or move your whole folder structure between devices with **Export folders…** / **Import folders…** — plain JSON.

### 9. Localization (EN / RU)
Full English and Russian translations. Toggle the language in settings and the UI updates live without reloading.

### 10. Mobile-responsive
Built mobile-first: tap targets ≥40px, icon-only toolbar on narrow screens, full-width shelf chips, and bigger avatars on touch.

---

## Installation

In SillyTavern, go to **Extensions → Install extension** and paste the repo URL:

```
https://github.com/XaYS-101/Character-Folders-Silly-Tavern
```

---

## Known limitations & quirks

- **Pagination:** SillyTavern renders the character list page by page, so only the cards on the current page get physically grouped (the header count is still the true total). To see every folder fully populated at once, raise the character-list page size; groups rebuild automatically as you scroll/page.
- **Search:** While a character search is active, empty folders are hidden.
- **Folder data** lives in ST's extension settings. It survives reloads, character switches, and renames, but if you manually wipe your settings file you'll lose it — use Export to back it up.
- **Smart "created after"** depends on the card's `create_date`; characters loaded "shallow" (not opened this session) may not expose it until opened.
- **Nested depth** is unlimited, but the UI gets cramped on mobile past 3–4 levels.

---

## License

MIT.
