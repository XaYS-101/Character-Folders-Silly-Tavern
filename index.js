/*
 * Character Folders
 * --------------------------------------------------------------
 *  Organise the SillyTavern character list into collapsible,
 *  nestable folders. 100% client-side: no server plugin, no
 *  changes to config.yaml, nothing to install beyond this UI
 *  extension itself.
 *
 *  - Folders are stored in extension_settings, keyed by the
 *    character's avatar file name (a stable id). The character
 *    cards on disk are never touched.
 *  - The character list (#rm_print_characters_block) is re-grouped
 *    in place by moving the existing .character_select DOM nodes
 *    into folder containers, so ST's own click handlers keep
 *    working. A MutationObserver re-applies grouping whenever ST
 *    re-renders the list (search, sort, pagination).
 *  - Mobile first: every character card gets a large folder button
 *    that opens a folder picker. Drag-and-drop is an optional
 *    desktop bonus on top.
 *  - Extras: per-folder colour/icon, multi-select bulk move,
 *    JSON export/import of the whole structure, and smart folders
 *    (auto-filled by tag / creation date / name match).
 *
 *  Third-party extensions are served one level deeper than
 *  built-ins, hence the ../../../../ path to script.js.
 */

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    characters,
} from '../../../../script.js';

import {
    extension_settings,
    getContext,
} from '../../../extensions.js';

import {
    callGenericPopup,
    POPUP_TYPE,
    POPUP_RESULT,
} from '../../../popup.js';

/* ------------------------------------------------------------------
 *  Constants & module state
 * ------------------------------------------------------------------ */

const MODULE_NAME = 'CharactersFolders';
const LIST_ID = 'rm_print_characters_block';
const TOOLBAR_ID = 'cf_toolbar';

// Session-only state (never persisted).
let selectMode = false;
const selectedKeys = new Set();   // avatar keys checked in multi-select mode
let dragKey = null;               // avatar key currently being dragged
let soloFolderId = null;          // when set, show only this folder ("solo" filter)

// Per-render memo caches, reset at the top of each render and on save. They keep
// expensive lookups (subtree counts, tag id->name) out of sort comparators and
// per-card loops. See resetCaches().
let _countCache = null;           // folderId -> recursive character count
let _tagNameCache = null;         // tag id -> lowercased tag name

/* ------------------------------------------------------------------
 *  Settings
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
    language: 'ru',
    enabled: true,
    folders: {},          // id -> { id, name, parentId, collapsed, color, icon, order, smart }
    assign: {},           // avatarKey -> folderId
    folderSort: 'manual', // name_asc | name_desc | count_desc | manual
    pinnedChars: [],      // avatar keys pinned to the home-screen quick-launch shelf
    homeShelf: true,      // show the pinned-characters shelf on the welcome screen
    homeGroup: true,      // group the welcome screen's Recent Chats by folder
};

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        return extension_settings[MODULE_NAME];
    }
    const s = extension_settings[MODULE_NAME];
    // Soft migration: make sure every key exists.
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    return s;
}

function saveSettings() {
    resetCaches();
    saveSettingsDebounced();
}

function resetCaches() {
    _countCache = null;
    _tagNameCache = null;
}

// Counter for unique-ish folder ids without Date.now()/Math.random()
// (kept deterministic and collision-free within a session).
let _idCounter = 0;
function nextFolderId() {
    const existing = Object.keys(getSettings().folders);
    let id;
    do {
        id = `f${existing.length}_${_idCounter++}`;
    } while (getSettings().folders[id]);
    return id;
}

/* ------------------------------------------------------------------
 *  i18n (inline EN / RU)
 * ------------------------------------------------------------------ */

const I18N = {
    en: {
        ext_title: 'Character Folders',
        language: 'Language',
        enabled: 'Enable folders',
        default_sort: 'Default folder sort',
        sort_name_asc: 'Name A → Z',
        sort_name_desc: 'Name Z → A',
        sort_count_desc: 'Character count',
        sort_manual: 'Manual (drag / arrows)',
        export_btn: 'Export folders…',
        import_btn: 'Import folders…',
        hint: 'Folders are stored only in this extension\'s settings — your character cards are never modified.',
        new_folder: 'New folder',
        expand_all: 'Expand all',
        collapse_all: 'Collapse all',
        select_mode: 'Select',
        select_done: 'Done',
        move_selected: 'Move selected…',
        clear_selected: 'Remove from folders',
        no_folder: 'No folder',
        folder_name: 'Folder name',
        folder_color: 'Colour',
        folder_icon: 'Icon (emoji or empty)',
        folder_smart: 'Smart rule (auto-fill)',
        smart_none: 'None (manual)',
        smart_tag: 'Has tag…',
        smart_name: 'Name contains…',
        smart_value: 'Value',
        create: 'Create',
        save: 'Save',
        cancel: 'Cancel',
        rename: 'Rename / edit',
        delete: 'Delete',
        move_to: 'Move to folder',
        pick_folder: 'Choose a folder',
        confirm_delete: 'Delete this folder? Its characters and sub-folders move to the parent.',
        nothing_selected: 'No characters selected.',
        import_ok: 'Folders imported.',
        import_bad: 'Invalid file — could not import.',
        smart_badge: 'smart',
        pin: 'Pin to top',
        unpin: 'Unpin',
        solo: 'Show only this folder',
        solo_clear: 'Show all folders',
        filtering_folder: 'Showing only:',
        parent_folder: 'Parent folder',
        root_level: '— top level —',
        smart_created_after: 'Created after date…',
        smart_date_ph: 'YYYY-MM-DD',
        home_header: 'Home screen',
        home_shelf: 'Show pinned characters on the home screen',
        home_group: 'Group Recent Chats by folder on the home screen',
        pin_home: 'Pin to home screen',
        unpin_home: 'Unpin from home screen',
        shelf_title: 'Pinned',
    },
    ru: {
        ext_title: 'Папки персонажей',
        language: 'Язык',
        enabled: 'Включить папки',
        default_sort: 'Сортировка папок по умолчанию',
        sort_name_asc: 'Имя А → Я',
        sort_name_desc: 'Имя Я → А',
        sort_count_desc: 'По количеству',
        sort_manual: 'Вручную (перетаскивание / стрелки)',
        export_btn: 'Экспорт папок…',
        import_btn: 'Импорт папок…',
        hint: 'Папки хранятся только в настройках расширения — карточки персонажей не изменяются.',
        new_folder: 'Новая папка',
        expand_all: 'Развернуть всё',
        collapse_all: 'Свернуть всё',
        select_mode: 'Выбрать',
        select_done: 'Готово',
        move_selected: 'Переместить выбранных…',
        clear_selected: 'Убрать из папок',
        no_folder: 'Без папки',
        folder_name: 'Название папки',
        folder_color: 'Цвет',
        folder_icon: 'Иконка (эмодзи или пусто)',
        folder_smart: 'Умное правило (автонаполнение)',
        smart_none: 'Нет (вручную)',
        smart_tag: 'Есть тег…',
        smart_name: 'Имя содержит…',
        smart_value: 'Значение',
        create: 'Создать',
        save: 'Сохранить',
        cancel: 'Отмена',
        rename: 'Переименовать / изменить',
        delete: 'Удалить',
        move_to: 'Переместить в папку',
        pick_folder: 'Выберите папку',
        confirm_delete: 'Удалить папку? Персонажи и подпапки перейдут к родителю.',
        nothing_selected: 'Не выбрано ни одного персонажа.',
        import_ok: 'Папки импортированы.',
        import_bad: 'Неверный файл — импорт не выполнен.',
        smart_badge: 'умная',
        pin: 'Закрепить наверху',
        unpin: 'Открепить',
        solo: 'Показать только эту папку',
        solo_clear: 'Показать все папки',
        filtering_folder: 'Показана только:',
        parent_folder: 'Родительская папка',
        root_level: '— верхний уровень —',
        smart_created_after: 'Создан после даты…',
        smart_date_ph: 'ГГГГ-ММ-ДД',
        home_header: 'Главный экран',
        home_shelf: 'Показывать закреплённых персонажей на главном экране',
        home_group: 'Группировать «Recent Chats» по папкам на главном экране',
        pin_home: 'Закрепить на главном экране',
        unpin_home: 'Открепить с главного экрана',
        shelf_title: 'Закреплённые',
    },
};

function lang() {
    return (extension_settings[MODULE_NAME] || {}).language === 'en' ? 'en' : 'ru';
}

function t(key) {
    const l = lang();
    return (I18N[l] && I18N[l][key]) || I18N.en[key] || key;
}

// Replace text/attributes on [data-cf-i18n] nodes.
//   <span data-cf-i18n="save">           -> textContent
//   <input data-cf-i18n="[value]save">   -> value attribute
function applyTranslations(root) {
    if (!root) return;
    root.querySelectorAll('[data-cf-i18n]').forEach((el) => {
        const spec = el.getAttribute('data-cf-i18n');
        const m = spec.match(/^\[(\w+)\](.+)$/);
        if (m) {
            el.setAttribute(m[1], t(m[2]));
        } else {
            el.textContent = t(spec);
        }
    });
}

/* ------------------------------------------------------------------
 *  Small helpers
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// CSS selector matching any list entry we can file away (single characters and
// group chats alike).
const CARD_SELECTOR = '.character_select, .group_select';

// Stable key for a list entry. For a single character it is the avatar file
// name; for a group it is `grp:<groupId>`. Read off the rendered block and
// resolved against the live arrays, then cached on the node.
function charKeyFromBlock(block) {
    if (!block) return null;
    if (block.dataset.cfKey) return block.dataset.cfKey;
    let key = null;
    if (block.classList.contains('group_select')) {
        // ST renders groups with a `data-grid` attribute (exposed as dataset.grid).
        const gid = block.dataset.grid ?? block.getAttribute('grid');
        key = gid != null ? `grp:${gid}` : null;
    } else {
        // ST renders characters with `data-chid` (dataset.chid), not `chid`.
        const chid = block.dataset.chid ?? block.getAttribute('chid');
        const list = (getContext()?.characters) || characters || [];
        const ch = chid != null ? list[Number(chid)] : null;
        key = ch?.avatar || null;
    }
    if (key) block.dataset.cfKey = key;
    return key;
}

function charByKey(key) {
    if (!key || key.startsWith('grp:')) return null; // groups have no character record
    const list = (getContext()?.characters) || characters || [];
    return list.find(c => c?.avatar === key) || null;
}

// Resolve which folder a character belongs to: explicit assignment wins,
// otherwise the first matching smart folder.
function folderForKey(key) {
    return folderForKeyAndChar(key, charByKey(key));
}

// Same resolution but with the character object already in hand — avoids a second
// O(n) charByKey lookup when the caller is iterating the full character array.
function folderForKeyAndChar(key, ch) {
    const s = getSettings();
    if (s.assign[key] && s.folders[s.assign[key]]) return s.assign[key];
    if (!ch) return null;
    for (const id of Object.keys(s.folders)) {
        const f = s.folders[id];
        if (f.smart && smartMatches(f.smart, ch)) return id;
    }
    return null;
}

function smartMatches(smart, ch) {
    if (!smart || !smart.rule) return false;
    const raw = String(smart.value ?? '').trim();
    if (!raw) return false;
    const val = raw.toLowerCase();
    if (smart.rule === 'name_contains') {
        return String(ch.name || '').toLowerCase().includes(val);
    }
    if (smart.rule === 'tag') {
        const tagMap = getContext()?.tagMap || {};
        const ids = tagMap[ch.avatar] || [];
        const nameById = getTagNameMap();
        return ids.some(id => nameById.get(id) === val);
    }
    if (smart.rule === 'created_after') {
        const created = parseCharDate(ch.create_date || ch.data?.create_date);
        // Parse the threshold the SAME way (local midnight) so the comparison is
        // not skewed by new Date('YYYY-MM-DD') being interpreted as UTC.
        const after = parseCharDate(raw);
        if (!created || !after) return false;
        return created.getTime() >= after.getTime();
    }
    return false;
}

// id -> lowercased tag name, built once per render (see resetCaches).
function getTagNameMap() {
    if (_tagNameCache) return _tagNameCache;
    _tagNameCache = new Map();
    for (const tg of (getContext()?.tags || [])) {
        if (tg?.id != null) _tagNameCache.set(tg.id, String(tg.name || '').toLowerCase());
    }
    return _tagNameCache;
}

// SillyTavern stores create_date in assorted shapes, e.g. "2024-3-15@14h30m12s".
// Pull out the leading Y-M-D and build a Date; return null if unparseable.
function parseCharDate(value) {
    if (!value) return null;
    const m = String(value).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------
 *  Settings panel
 * ------------------------------------------------------------------ */

const SETTINGS_HTML = `
<div id="cf_settings" class="cf-extension">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b data-cf-i18n="ext_title">Character Folders</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="cf-section">
                <label for="cf_language" data-cf-i18n="language">Language</label>
                <select id="cf_language" class="text_pole">
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                </select>
            </div>

            <div class="cf-section">
                <label class="checkbox_label" for="cf_enabled">
                    <input id="cf_enabled" type="checkbox" />
                    <span data-cf-i18n="enabled">Enable folders</span>
                </label>
            </div>

            <div class="cf-section">
                <label for="cf_default_sort" data-cf-i18n="default_sort">Default folder sort</label>
                <select id="cf_default_sort" class="text_pole">
                    <option value="manual" data-cf-i18n="sort_manual">Manual</option>
                    <option value="name_asc" data-cf-i18n="sort_name_asc">Name A-Z</option>
                    <option value="name_desc" data-cf-i18n="sort_name_desc">Name Z-A</option>
                    <option value="count_desc" data-cf-i18n="sort_count_desc">Count</option>
                </select>
            </div>

            <hr class="sysHR" />

            <div class="cf-section">
                <h4 data-cf-i18n="home_header">Home screen</h4>
                <label class="checkbox_label" for="cf_home_shelf">
                    <input id="cf_home_shelf" type="checkbox" />
                    <span data-cf-i18n="home_shelf">Show pinned characters on the home screen</span>
                </label>
                <label class="checkbox_label" for="cf_home_group">
                    <input id="cf_home_group" type="checkbox" />
                    <span data-cf-i18n="home_group">Group Recent Chats by folder on the home screen</span>
                </label>
            </div>

            <hr class="sysHR" />

            <div class="cf-section flex-container">
                <input id="cf_export" class="menu_button" type="button" value="Export" data-cf-i18n="[value]export_btn" />
                <input id="cf_import" class="menu_button" type="button" value="Import" data-cf-i18n="[value]import_btn" />
                <input id="cf_import_file" type="file" accept=".json,application/json" hidden />
            </div>

            <small class="cf-hint" data-cf-i18n="hint"></small>
        </div>
    </div>
</div>`;

function bindSettingsPanel() {
    const s = getSettings();
    const langSel = document.getElementById('cf_language');
    const enabled = document.getElementById('cf_enabled');
    const sortSel = document.getElementById('cf_default_sort');

    langSel.value = s.language;
    enabled.checked = !!s.enabled;
    sortSel.value = s.folderSort;

    langSel.addEventListener('change', () => {
        s.language = langSel.value;
        saveSettings();
        applyTranslations(document.getElementById('cf_settings'));
        rebuildToolbar();
        scheduleRender();
    });

    enabled.addEventListener('change', () => {
        s.enabled = enabled.checked;
        saveSettings();
        if (!s.enabled) unGroupAll();
        rebuildToolbar();
        scheduleRender();
    });

    sortSel.addEventListener('change', () => {
        s.folderSort = sortSel.value;
        saveSettings();
        const tb = document.getElementById('cf_sort_select');
        if (tb) tb.value = s.folderSort;
        scheduleRender();
    });

    const homeShelf = document.getElementById('cf_home_shelf');
    const homeGroup = document.getElementById('cf_home_group');
    homeShelf.checked = !!s.homeShelf;
    homeGroup.checked = !!s.homeGroup;
    homeShelf.addEventListener('change', () => {
        s.homeShelf = homeShelf.checked;
        saveSettings();
        scheduleHomeRender();
    });
    homeGroup.addEventListener('change', () => {
        s.homeGroup = homeGroup.checked;
        saveSettings();
        scheduleHomeRender();
    });

    document.getElementById('cf_export').addEventListener('click', exportFolders);
    const fileInput = document.getElementById('cf_import_file');
    document.getElementById('cf_import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', importFolders);
}

/* ------------------------------------------------------------------
 *  Export / import (browser only — no server)
 * ------------------------------------------------------------------ */

function exportFolders() {
    const s = getSettings();
    const payload = {
        _type: 'CharacterFolders',
        version: 1,
        folders: s.folders,
        assign: s.assign,
        folderSort: s.folderSort,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'character-folders.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function importFolders(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || !data.folders) throw new Error('bad');
        const s = getSettings();
        s.folders = data.folders || {};
        s.assign = data.assign || {};
        if (data.folderSort) s.folderSort = data.folderSort;
        saveSettings();
        rebuildToolbar();
        scheduleRender();
        toast(t('import_ok'), 'success');
    } catch (err) {
        console.error(`[${MODULE_NAME}] import failed`, err);
        toast(t('import_bad'), 'error');
    }
}

function toast(msg, type = 'info') {
    try {
        if (window.toastr && typeof window.toastr[type] === 'function') {
            window.toastr[type](msg);
            return;
        }
    } catch { /* ignore */ }
    console.log(`[${MODULE_NAME}] ${msg}`);
}

/* ------------------------------------------------------------------
 *  Toolbar above the character list
 * ------------------------------------------------------------------ */

function rebuildToolbar() {
    document.getElementById(TOOLBAR_ID)?.remove();
    injectToolbar();
}

function injectToolbar() {
    const s = getSettings();
    const list = document.getElementById(LIST_ID);
    if (!list || !s.enabled) return;
    if (document.getElementById(TOOLBAR_ID)) return;

    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.className = 'cf-toolbar';
    bar.innerHTML = `
        <div class="cf-tb-btn menu_button" id="cf_new_folder" title="${escapeHtml(t('new_folder'))}">
            <i class="fa-solid fa-folder-plus"></i><span class="cf-tb-label">${escapeHtml(t('new_folder'))}</span>
        </div>
        <select id="cf_sort_select" class="text_pole cf-tb-sort" title="${escapeHtml(t('default_sort'))}">
            <option value="manual">${escapeHtml(t('sort_manual'))}</option>
            <option value="name_asc">${escapeHtml(t('sort_name_asc'))}</option>
            <option value="name_desc">${escapeHtml(t('sort_name_desc'))}</option>
            <option value="count_desc">${escapeHtml(t('sort_count_desc'))}</option>
        </select>
        <div class="cf-tb-btn menu_button" id="cf_toggle_all" title="${escapeHtml(t('collapse_all'))}">
            <i class="fa-solid fa-down-left-and-up-right-to-center"></i>
        </div>
        <div class="cf-tb-btn menu_button" id="cf_select_toggle" title="${escapeHtml(t('select_mode'))}">
            <i class="fa-solid fa-check-double"></i>
        </div>
        <div class="cf-tb-btn menu_button cf-hidden" id="cf_move_selected" title="${escapeHtml(t('move_selected'))}">
            <i class="fa-solid fa-folder-tree"></i>
        </div>
        <div class="cf-tb-chip cf-hidden" id="cf_solo_chip" title="${escapeHtml(t('solo_clear'))}">
            <i class="fa-solid fa-filter"></i><span id="cf_solo_name"></span><i class="fa-solid fa-xmark"></i>
        </div>`;

    list.parentElement.insertBefore(bar, list);

    bar.querySelector('#cf_sort_select').value = s.folderSort;

    bar.querySelector('#cf_new_folder').addEventListener('click', () => openFolderDialog(null, null));
    bar.querySelector('#cf_sort_select').addEventListener('change', (ev) => {
        s.folderSort = ev.target.value;
        saveSettings();
        const ps = document.getElementById('cf_default_sort');
        if (ps) ps.value = s.folderSort;
        scheduleRender();
    });
    bar.querySelector('#cf_toggle_all').addEventListener('click', toggleAllFolders);
    bar.querySelector('#cf_select_toggle').addEventListener('click', toggleSelectMode);
    bar.querySelector('#cf_move_selected').addEventListener('click', openBulkMoveDialog);
    bar.querySelector('#cf_solo_chip').addEventListener('click', () => {
        soloFolderId = null;
        scheduleRender();
    });
    updateSoloIndicator();
}

// Reflect the active "show only this folder" filter in the toolbar chip.
function updateSoloIndicator() {
    const chip = document.getElementById('cf_solo_chip');
    if (!chip) return;
    const s = getSettings();
    const folder = soloFolderId ? s.folders[soloFolderId] : null;
    if (folder) {
        chip.querySelector('#cf_solo_name').textContent = ` ${t('filtering_folder')} ${folder.name} `;
        chip.classList.remove('cf-hidden');
    } else {
        chip.classList.add('cf-hidden');
    }
}

function toggleAllFolders() {
    const s = getSettings();
    const ids = Object.keys(s.folders);
    const anyOpen = ids.some(id => !s.folders[id].collapsed);
    ids.forEach(id => { s.folders[id].collapsed = anyOpen; });
    saveSettings();
    scheduleRender();
}

function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) selectedKeys.clear();
    const btn = document.getElementById('cf_select_toggle');
    const moveBtn = document.getElementById('cf_move_selected');
    if (btn) {
        btn.classList.toggle('cf-active', selectMode);
        btn.title = selectMode ? t('select_done') : t('select_mode');
    }
    if (moveBtn) moveBtn.classList.toggle('cf-hidden', !selectMode);
    scheduleRender();
}

/* ------------------------------------------------------------------
 *  Folder create / edit dialog
 * ------------------------------------------------------------------ */

// Indented <option> tree of all folders. `firstLabel` is the value="" entry
// ("no folder" for the move picker, "top level" for the parent picker).
// `excludeId`, when given, drops that folder and its descendants (so a folder
// can't be reparented under itself).
function buildFolderOptionTree({ firstLabel, selectedId = '', excludeId = null }) {
    const s = getSettings();
    const banned = new Set();
    if (excludeId) {
        const collect = (id) => {
            banned.add(id);
            for (const f of Object.values(s.folders)) {
                if ((f.parentId || null) === id) collect(f.id);
            }
        };
        collect(excludeId);
    }
    const rootSel = !selectedId ? ' selected' : '';
    const lines = [`<option value=""${rootSel}>${escapeHtml(firstLabel)}</option>`];
    const visited = new Set();
    const visit = (parentId, depth) => {
        if (visited.has(parentId)) return;
        visited.add(parentId);
        for (const id of sortedFolderIds(parentId)) {
            if (banned.has(id)) continue;
            const indent = '  '.repeat(depth);
            const icon = s.folders[id].icon ? s.folders[id].icon + ' ' : '';
            const isSel = id === selectedId ? ' selected' : '';
            lines.push(`<option value="${escapeHtml(id)}"${isSel}>${escapeHtml(indent + icon + s.folders[id].name)}</option>`);
            visit(id, depth + 1);
        }
    };
    visit(null, 0);
    return lines.join('');
}

async function openFolderDialog(folderId, parentId) {
    const s = getSettings();
    const editing = folderId ? s.folders[folderId] : null;
    const smart = editing?.smart || null;
    const initialParent = editing ? (editing.parentId || null) : (parentId || null);

    const html = document.createElement('div');
    html.className = 'cf-dialog';
    html.innerHTML = `
        <label class="cf-dlg-label">${escapeHtml(t('folder_name'))}</label>
        <input id="cf_dlg_name" type="text" class="text_pole" value="${escapeHtml(editing?.name || '')}" />

        <div class="cf-dlg-row">
            <div class="cf-dlg-col">
                <label class="cf-dlg-label">${escapeHtml(t('folder_color'))}</label>
                <input id="cf_dlg_color" type="color" value="${escapeHtml(editing?.color || '#6c8cff')}" />
            </div>
            <div class="cf-dlg-col">
                <label class="cf-dlg-label">${escapeHtml(t('folder_icon'))}</label>
                <input id="cf_dlg_icon" type="text" class="text_pole" maxlength="2" value="${escapeHtml(editing?.icon || '')}" placeholder="📁" />
            </div>
        </div>

        <label class="cf-dlg-label">${escapeHtml(t('parent_folder'))}</label>
        <select id="cf_dlg_parent" class="text_pole">${buildFolderOptionTree({ firstLabel: t('root_level'), selectedId: initialParent, excludeId: folderId })}</select>

        <label class="cf-dlg-label">${escapeHtml(t('folder_smart'))}</label>
        <select id="cf_dlg_smart" class="text_pole">
            <option value="">${escapeHtml(t('smart_none'))}</option>
            <option value="tag">${escapeHtml(t('smart_tag'))}</option>
            <option value="name_contains">${escapeHtml(t('smart_name'))}</option>
            <option value="created_after">${escapeHtml(t('smart_created_after'))}</option>
        </select>
        <input id="cf_dlg_smart_value" type="text" class="text_pole cf-dlg-smart-val" placeholder="${escapeHtml(t('smart_value'))}" value="${escapeHtml(smart?.value || '')}" />`;

    const smartSel = html.querySelector('#cf_dlg_smart');
    const smartVal = html.querySelector('#cf_dlg_smart_value');
    smartSel.value = smart?.rule || '';
    const syncSmart = () => {
        smartVal.style.display = smartSel.value ? '' : 'none';
        smartVal.placeholder = smartSel.value === 'created_after' ? t('smart_date_ph') : t('smart_value');
    };
    smartSel.addEventListener('change', syncSmart);
    syncSmart();

    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: editing ? t('save') : t('create'),
        cancelButton: t('cancel'),
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;

    const name = html.querySelector('#cf_dlg_name').value.trim();
    if (!name) return;
    const color = html.querySelector('#cf_dlg_color').value;
    const icon = html.querySelector('#cf_dlg_icon').value.trim();
    const newParent = html.querySelector('#cf_dlg_parent').value || null;
    const rule = smartSel.value;
    const value = smartVal.value.trim();
    const smartObj = rule ? { rule, value } : null;

    if (editing) {
        editing.name = name;
        editing.color = color;
        editing.icon = icon;
        editing.smart = smartObj;
        if (newParent !== (editing.parentId || null)) {
            editing.parentId = newParent;
            const siblings = Object.values(s.folders).filter(f => (f.parentId || null) === newParent && f.id !== editing.id);
            editing.order = siblings.length;
        }
    } else {
        const id = nextFolderId();
        const siblings = Object.values(s.folders).filter(f => (f.parentId || null) === newParent);
        s.folders[id] = {
            id,
            name,
            parentId: newParent,
            collapsed: false,
            color,
            icon,
            order: siblings.length,
            pinned: false,
            smart: smartObj,
        };
    }
    saveSettings();
    scheduleRender();
}

async function deleteFolder(folderId) {
    const s = getSettings();
    const folder = s.folders[folderId];
    if (!folder) return;
    const ok = await callGenericPopup(t('confirm_delete'), POPUP_TYPE.CONFIRM);
    if (ok !== POPUP_RESULT.AFFIRMATIVE) return;

    const parent = folder.parentId || null;
    // Re-home sub-folders to the deleted folder's parent.
    for (const f of Object.values(s.folders)) {
        if (f.parentId === folderId) f.parentId = parent;
    }
    // Re-home assigned characters to the parent (or unassign if root).
    for (const key of Object.keys(s.assign)) {
        if (s.assign[key] === folderId) {
            if (parent) s.assign[key] = parent;
            else delete s.assign[key];
        }
    }
    delete s.folders[folderId];
    saveSettings();
    scheduleRender();
}

/* ------------------------------------------------------------------
 *  Folder picker (mobile-first assignment)
 * ------------------------------------------------------------------ */


async function openMovePicker(keys) {
    if (!keys.length) { toast(t('nothing_selected'), 'warning'); return; }
    const current = keys.length === 1 ? (getSettings().assign[keys[0]] || '') : '';
    const html = document.createElement('div');
    html.className = 'cf-dialog';
    html.innerHTML = `
        <label class="cf-dlg-label">${escapeHtml(t('pick_folder'))}</label>
        <select id="cf_pick" class="text_pole cf-pick">${buildFolderOptionTree({ firstLabel: t('no_folder'), selectedId: current })}</select>`;
    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: t('save'),
        cancelButton: t('cancel'),
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;
    const fid = html.querySelector('#cf_pick').value;
    assignKeys(keys, fid);
}

function assignKeys(keys, folderId) {
    const s = getSettings();
    for (const key of keys) {
        if (folderId) s.assign[key] = folderId;
        else delete s.assign[key];
    }
    saveSettings();
    scheduleRender();
}

async function openBulkMoveDialog() {
    await openMovePicker([...selectedKeys]);
    selectedKeys.clear();
}

/* ------------------------------------------------------------------
 *  Folder sorting
 * ------------------------------------------------------------------ */

function sortedFolderIds(parentId) {
    const s = getSettings();
    const ids = Object.keys(s.folders).filter(id => (s.folders[id].parentId || null) === (parentId || null));
    const mode = s.folderSort;
    const within = (a, b) => {
        if (mode === 'name_asc') return s.folders[a].name.localeCompare(s.folders[b].name);
        if (mode === 'name_desc') return s.folders[b].name.localeCompare(s.folders[a].name);
        if (mode === 'count_desc') return countInSubtree(b) - countInSubtree(a);
        return (s.folders[a].order ?? 0) - (s.folders[b].order ?? 0); // manual
    };
    // Pinned folders always float above the rest, regardless of the sort mode;
    // ties are broken by the active sort.
    ids.sort((a, b) => {
        const pa = s.folders[a].pinned ? 1 : 0;
        const pb = s.folders[b].pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return within(a, b);
    });
    return ids;
}

// True character counts per folder, computed once per render over the FULL
// character/group set (not just the cards rendered on the current pagination
// page) so headers and count-sort are accurate even when ST paginates. Returns
// { direct, total } maps: direct = the folder's own members, total = subtree.
function buildCounts() {
    if (_countCache) return _countCache;
    const s = getSettings();
    const direct = new Map();
    const bump = (fid) => { if (fid && s.folders[fid]) direct.set(fid, (direct.get(fid) || 0) + 1); };
    const ctx = getContext();
    for (const ch of (ctx?.characters || characters || [])) {
        if (ch?.avatar) bump(folderForKeyAndChar(ch.avatar, ch));
    }
    for (const g of (ctx?.groups || [])) {
        if (g?.id != null) bump(folderForKeyAndChar(`grp:${g.id}`, null));
    }
    const total = new Map();
    const roll = (id, seen) => {
        if (seen.has(id)) return 0;
        seen.add(id);
        let n = direct.get(id) || 0;
        for (const cid of Object.keys(s.folders)) {
            if ((s.folders[cid].parentId || null) === id) n += roll(cid, seen);
        }
        total.set(id, n);
        return n;
    };
    for (const id of Object.keys(s.folders)) if (!total.has(id)) roll(id, new Set());
    _countCache = { direct, total };
    return _countCache;
}

function directCount(folderId) {
    return buildCounts().direct.get(folderId) || 0;
}

function countInSubtree(folderId) {
    return buildCounts().total.get(folderId) || 0;
}

// Move a manual-ordered folder up/down among its siblings.
function reorderFolder(folderId, dir) {
    const s = getSettings();
    const folder = s.folders[folderId];
    if (!folder) return;
    const siblings = Object.keys(s.folders)
        .filter(id => (s.folders[id].parentId || null) === (folder.parentId || null))
        .sort((a, b) => (s.folders[a].order ?? 0) - (s.folders[b].order ?? 0));
    const idx = siblings.indexOf(folderId);
    const swap = idx + dir;
    if (swap < 0 || swap >= siblings.length) return;
    const other = siblings[swap];
    const tmp = s.folders[folderId].order ?? idx;
    s.folders[folderId].order = s.folders[other].order ?? swap;
    s.folders[other].order = tmp;
    s.folderSort = 'manual';
    saveSettings();
    const ts = document.getElementById('cf_sort_select');
    if (ts) ts.value = 'manual';
    scheduleRender();
}

/* ------------------------------------------------------------------
 *  Rendering — re-group the character list in place
 * ------------------------------------------------------------------ */

let renderPending = false;
function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
        renderPending = false;
        // Detach the observer for the whole pass so our own DOM churn (teardown +
        // re-group) cannot re-trigger it. Reconnect on a microtask, after the
        // synchronous mutations we caused have already been generated and dropped
        // — this avoids the per-frame render loop a sync set/clear flag can leave.
        listObserver?.disconnect();
        try {
            renderFolders();
        } catch (err) {
            console.error(`[${MODULE_NAME}] render`, err);
        } finally {
            Promise.resolve().then(connectObserver);
            // Folder/pin/settings changes flow here; mirror them onto the home
            // screen too (cheap no-op when the welcome panel isn't showing).
            scheduleHomeRender();
        }
    });
}

// Dissolve every folder container, moving its cards back to the list's top level.
// Shared by the disable path (unGroupAll) and the per-render teardown.
function dissolveGroups(list) {
    list.querySelectorAll('.cf-folder-group').forEach(group => {
        group.querySelectorAll(CARD_SELECTOR).forEach(b => list.appendChild(b));
        group.remove();
    });
}

// Remove all folder containers and per-card decorations (used when disabling).
function unGroupAll() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    list.dataset.cfRendering = '1';
    dissolveGroups(list);
    list.querySelectorAll('.cf-card-tools').forEach(n => n.remove());
    list.querySelectorAll('.cf-select-checkbox').forEach(n => n.remove());
    list.classList.remove('cf-solo');
    delete list.dataset.cfRendering;
}

function isFiltering() {
    const inp = document.getElementById('character_search_bar');
    return !!(inp && inp.value && inp.value.trim().length);
}

function renderFolders() {
    const s = getSettings();
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    injectToolbar();

    if (!s.enabled) { unGroupAll(); return; }

    // A stale solo target (deleted folder) silently clears the filter.
    if (soloFolderId && !s.folders[soloFolderId]) soloFolderId = null;

    resetCaches(); // counts/tag-names are recomputed fresh for this render

    list.dataset.cfRendering = '1';
    try {
        // Tear down any previous grouping first (move blocks back to top level).
        dissolveGroups(list);

        // Decorate every visible card (character or group) and bucket by folder.
        const buckets = new Map();   // folderId -> [block]
        const blocks = Array.from(list.querySelectorAll(`:scope > .character_select, :scope > .group_select`));
        for (const block of blocks) {
            decorateCard(block);
            const key = charKeyFromBlock(block);
            if (!key) continue;
            const fid = folderForKey(key);
            if (fid && s.folders[fid]) {
                if (!buckets.has(fid)) buckets.set(fid, []);
                buckets.get(fid).push(block);
            }
        }

        // Solo mode hides the ungrouped cards (CSS) and renders only one subtree.
        list.classList.toggle('cf-solo', !!soloFolderId);

        const ctx = {
            s,
            buckets,
            filtering: isFiltering(),
            roots: soloFolderId ? [soloFolderId] : null,
            countFn: (fid) => directCount(fid), // true count across all pages
            allowDrop: true,
        };
        const frag = document.createDocumentFragment();
        renderFolderTree(frag, null, ctx, new Set());
        // Insert folder groups above the ungrouped cards but BELOW any of ST's own
        // leading blocks (bogus-folder "back" nav, empty/hidden-count blocks): the
        // first card is our anchor; if there are none, append at the end.
        const anchor = list.querySelector(':scope > .character_select, :scope > .group_select');
        if (anchor) list.insertBefore(frag, anchor);
        else list.appendChild(frag);
        updateSoloIndicator();
    } finally {
        delete list.dataset.cfRendering;
    }
}

// Build the folder-group DOM from a bucket map. Shared by the right-hand
// character list and the home-screen Recent Chats (they differ only in the
// ctx: which cards, how to count, whether drops are allowed).
function renderFolderTree(parentEl, parentId, ctx, visited) {
    if (visited.has(parentId)) return; // guard corrupted parentId chains
    visited.add(parentId);
    const s = ctx.s;

    const children = (parentId === null && ctx.roots) ? ctx.roots : sortedFolderIds(parentId);
    for (const fid of children) {
        const folder = s.folders[fid];
        if (!folder) continue;
        const members = ctx.buckets.get(fid) || [];
        if (ctx.filtering && !subtreeHasVisible(fid, s, ctx.buckets, new Set())) continue;

        const group = document.createElement('div');
        group.className = 'cf-folder-group';
        group.dataset.folderId = fid;
        if (folder.color) group.style.setProperty('--cf-color', folder.color);

        const header = buildFolderHeader(folder, ctx.countFn(fid, members));
        const body = document.createElement('div');
        body.className = 'cf-folder-body';
        if (folder.collapsed) body.hidden = true;

        // Sub-folders first, then this folder's own members.
        renderFolderTree(body, fid, ctx, new Set(visited));
        for (const b of members) body.appendChild(b);

        if (ctx.allowDrop) wireDropTarget(group, fid);

        group.appendChild(header);
        group.appendChild(body);
        parentEl.appendChild(group);
    }
}

function subtreeHasVisible(folderId, s, buckets, visited) {
    if (visited.has(folderId)) return false;
    visited.add(folderId);
    if ((buckets.get(folderId) || []).length > 0) return true;
    for (const id of Object.keys(s.folders)) {
        if ((s.folders[id].parentId || null) === folderId
            && subtreeHasVisible(id, s, buckets, visited)) return true;
    }
    return false;
}

function buildFolderHeader(folder, count) {
    const h = document.createElement('div');
    h.className = 'cf-folder-header';
    h.dataset.folderId = folder.id;

    const tog = document.createElement('span');
    tog.className = 'cf-folder-toggle';
    tog.textContent = folder.collapsed ? '▶' : '▼';
    h.appendChild(tog);

    const ic = document.createElement('span');
    ic.className = 'cf-folder-icon';
    if (folder.icon) {
        ic.textContent = folder.icon;
    } else {
        ic.innerHTML = '<i class="fa-solid fa-folder"></i>';
    }
    h.appendChild(ic);

    const name = document.createElement('span');
    name.className = 'cf-folder-name';
    name.textContent = folder.name;
    name.title = folder.name;
    h.appendChild(name);

    if (folder.smart) {
        const badge = document.createElement('span');
        badge.className = 'cf-folder-smart';
        badge.textContent = t('smart_badge');
        h.appendChild(badge);
    }

    const cnt = document.createElement('span');
    cnt.className = 'cf-folder-count';
    cnt.textContent = `(${count})`;
    h.appendChild(cnt);

    // Reorder arrows appear only in manual sort, to keep the header uncluttered
    // the rest of the time.
    const manual = getSettings().folderSort === 'manual';
    const arrows = manual
        ? `<span class="cf-act fa-solid fa-arrow-up" data-act="up" title="↑"></span>
           <span class="cf-act fa-solid fa-arrow-down" data-act="down" title="↓"></span>`
        : '';
    const soloActive = soloFolderId === folder.id;
    const pinned = !!folder.pinned;

    const acts = document.createElement('span');
    acts.className = 'cf-folder-acts';
    acts.innerHTML = `
        ${arrows}
        <span class="cf-act fa-solid fa-eye${soloActive ? ' cf-on' : ''}" data-act="solo" title="${escapeHtml(soloActive ? t('solo_clear') : t('solo'))}"></span>
        <span class="cf-act fa-solid fa-thumbtack${pinned ? ' cf-on' : ''}" data-act="pin" title="${escapeHtml(pinned ? t('unpin') : t('pin'))}"></span>
        <span class="cf-act fa-solid fa-pen" data-act="edit" title="${escapeHtml(t('rename'))}"></span>
        <span class="cf-act fa-solid fa-xmark" data-act="del" title="${escapeHtml(t('delete'))}"></span>`;
    h.appendChild(acts);

    // Collapse on header click (but not when an action icon was clicked).
    h.addEventListener('click', (e) => {
        if (e.target.closest('.cf-act')) return;
        const s = getSettings();
        if (!s.folders[folder.id]) return;
        s.folders[folder.id].collapsed = !s.folders[folder.id].collapsed;
        saveSettings();
        scheduleRender();
    });

    acts.addEventListener('click', (e) => {
        const act = e.target.closest('.cf-act')?.dataset.act;
        if (!act) return;
        e.stopPropagation();
        const s = getSettings();
        if (act === 'up') reorderFolder(folder.id, -1);
        else if (act === 'down') reorderFolder(folder.id, +1);
        else if (act === 'edit') openFolderDialog(folder.id, null);
        else if (act === 'del') deleteFolder(folder.id);
        else if (act === 'solo') {
            soloFolderId = (soloFolderId === folder.id) ? null : folder.id;
            // Auto-expand the soloed folder so its contents are actually visible.
            if (soloFolderId && s.folders[soloFolderId]?.collapsed) {
                s.folders[soloFolderId].collapsed = false;
                saveSettings();
            }
            scheduleRender();
        } else if (act === 'pin') {
            if (s.folders[folder.id]) {
                s.folders[folder.id].pinned = !s.folders[folder.id].pinned;
                saveSettings();
                scheduleRender();
            }
        }
    });

    return h;
}

/* ------------------------------------------------------------------
 *  Per-card decoration: folder button, checkbox, drag handle
 * ------------------------------------------------------------------ */

function decorateCard(block) {
    const key = charKeyFromBlock(block);
    if (!key) return;

    const isChar = !key.startsWith('grp:'); // home-pin shelf is character-only
    // Card tools: folder button (mobile-first assignment) + home-pin star.
    if (!block.querySelector('.cf-card-tools')) {
        const tools = document.createElement('div');
        tools.className = 'cf-card-tools';

        const btn = document.createElement('div');
        btn.className = 'cf-card-folder-btn';
        btn.title = t('move_to');
        btn.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openMovePicker([key]);
        });
        tools.appendChild(btn);

        if (isChar) {
            const star = document.createElement('div');
            star.className = 'cf-card-pin-btn';
            star.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleHomePin(key);
            });
            tools.appendChild(star);
        }
        block.appendChild(tools);
    }
    // Keep the star's on/off state in sync (membership can change between renders).
    if (isChar) {
        const star = block.querySelector('.cf-card-pin-btn');
        if (star) {
            const pinned = getSettings().pinnedChars.includes(key);
            star.classList.toggle('cf-on', pinned);
            star.title = pinned ? t('unpin_home') : t('pin_home');
        }
    }

    // Multi-select checkbox (only in select mode).
    let cb = block.querySelector('.cf-select-checkbox');
    if (selectMode) {
        if (!cb) {
            cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'cf-select-checkbox';
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                if (cb.checked) selectedKeys.add(key); else selectedKeys.delete(key);
            });
            block.appendChild(cb);
        }
        cb.checked = selectedKeys.has(key);
        block.classList.add('cf-selectable');
    } else if (cb) {
        cb.remove();
        block.classList.remove('cf-selectable');
    }

    // Drag-and-drop (desktop bonus).
    if (!block.dataset.cfDrag) {
        block.dataset.cfDrag = '1';
        block.setAttribute('draggable', 'true');
        block.addEventListener('dragstart', (e) => {
            dragKey = charKeyFromBlock(block);
            block.classList.add('cf-dragging');
            try { e.dataTransfer.setData('text/plain', dragKey || ''); } catch { /* ignore */ }
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        block.addEventListener('dragend', () => {
            block.classList.remove('cf-dragging');
            dragKey = null;
        });
    }
}

function wireDropTarget(el, folderId) {
    el.addEventListener('dragover', (e) => {
        if (!dragKey) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        el.classList.add('cf-drop-hover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('cf-drop-hover'));
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('cf-drop-hover');
        const key = dragKey || e.dataTransfer?.getData('text/plain');
        if (key) assignKeys([key], folderId);
    });
}

/* ------------------------------------------------------------------
 *  Observe the character list for re-renders
 * ------------------------------------------------------------------ */

let listObserver = null;

function connectObserver() {
    const target = document.getElementById(LIST_ID);
    if (!target || !listObserver) return;
    listObserver.observe(target, { childList: true, subtree: false });
}

function startListObserver() {
    const target = document.getElementById(LIST_ID);
    if (!target) {
        // The block may not exist yet on a fresh load; retry shortly.
        setTimeout(startListObserver, 500);
        return;
    }
    listObserver = new MutationObserver(() => scheduleRender());
    connectObserver();
    scheduleRender();
}

/* ------------------------------------------------------------------
 *  Home / welcome screen: pinned-characters shelf + grouped Recent Chats
 * ------------------------------------------------------------------ */

const HOME_SHELF_ID = 'cf_home_shelf';

function toggleHomePin(key) {
    const s = getSettings();
    const i = s.pinnedChars.indexOf(key);
    if (i >= 0) s.pinnedChars.splice(i, 1);
    else s.pinnedChars.push(key);
    saveSettings();
    scheduleRender();      // refresh the card star
    scheduleHomeRender();  // refresh the shelf
}

// Thumbnail URL for a character avatar, matching ST's own avatar thumbnails.
function avatarThumbUrl(avatar) {
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
}

// Open a pinned character by avatar key via the public context API.
async function openCharByKey(key) {
    try {
        const ctx = getContext();
        const list = ctx?.characters || characters || [];
        const idx = list.findIndex(c => c?.avatar === key);
        if (idx >= 0 && ctx?.selectCharacterById) await ctx.selectCharacterById(idx);
    } catch (err) {
        console.error(`[${MODULE_NAME}] open character failed`, err);
    }
}

function renderHome() {
    const panel = document.querySelector('.welcomePanel');
    if (!panel) return;
    resetCaches();
    renderHomeShelf(panel);
    renderHomeGroups(panel);
}

function renderHomeShelf(panel) {
    const s = getSettings();
    panel.querySelector(`#${HOME_SHELF_ID}`)?.remove();
    const keys = s.pinnedChars.filter(k => charByKey(k));
    if (!s.enabled || !s.homeShelf || keys.length === 0) return;

    const shelf = document.createElement('div');
    shelf.id = HOME_SHELF_ID;
    shelf.className = 'cf-home-shelf';

    const title = document.createElement('div');
    title.className = 'cf-shelf-title';
    title.innerHTML = `<i class="fa-solid fa-thumbtack"></i> ${escapeHtml(t('shelf_title'))}`;
    shelf.appendChild(title);

    const row = document.createElement('div');
    row.className = 'cf-shelf-row';
    for (const key of keys) {
        const ch = charByKey(key);
        const chip = document.createElement('div');
        chip.className = 'cf-shelf-chip';
        chip.title = ch.name || key;
        const img = document.createElement('img');
        img.className = 'cf-shelf-avatar';
        img.src = avatarThumbUrl(ch.avatar);
        img.loading = 'lazy';
        const name = document.createElement('span');
        name.className = 'cf-shelf-name';
        name.textContent = ch.name || key;
        chip.appendChild(img);
        chip.appendChild(name);
        chip.addEventListener('click', () => openCharByKey(key));

        const unpin = document.createElement('span');
        unpin.className = 'cf-shelf-unpin fa-solid fa-xmark';
        unpin.title = t('unpin_home');
        unpin.addEventListener('click', (e) => { e.stopPropagation(); toggleHomePin(key); });
        chip.appendChild(unpin);

        row.appendChild(chip);
    }
    shelf.appendChild(row);

    // Place the shelf above the Recent Chats block (or at the top of the panel).
    const recent = panel.querySelector('.welcomeRecent');
    if (recent) panel.insertBefore(shelf, recent);
    else panel.insertBefore(shelf, panel.firstChild);
}

function renderHomeGroups(panel) {
    const s = getSettings();
    const list = panel.querySelector('.recentChatList');
    if (!list) return;

    // Tear down any previous grouping (move recent-chat rows back to top level).
    list.querySelectorAll('.cf-folder-group').forEach(group => {
        group.querySelectorAll('.recentChat').forEach(b => list.appendChild(b));
        group.remove();
    });

    if (!s.enabled || !s.homeGroup) return;

    // Bucket each recent-chat row by the folder of its character/group.
    const buckets = new Map();
    const rows = Array.from(list.querySelectorAll(':scope > .recentChat'));
    for (const row of rows) {
        const grp = row.dataset.group;
        const key = (grp != null && grp !== '') ? `grp:${grp}` : row.dataset.avatar;
        if (!key) continue;
        const fid = folderForKey(key);
        if (fid && s.folders[fid]) {
            if (!buckets.has(fid)) buckets.set(fid, []);
            buckets.get(fid).push(row);
        }
    }
    if (buckets.size === 0) return;

    const ctx = {
        s,
        buckets,
        filtering: true, // prune folders that have no recent chats in their subtree
        roots: null,
        countFn: (fid, members) => members.length, // on-screen recent chats in this folder
        allowDrop: false,
    };
    const frag = document.createDocumentFragment();
    renderFolderTree(frag, null, ctx, new Set());
    const anchor = list.querySelector(':scope > .recentChat');
    if (anchor) list.insertBefore(frag, anchor);
    else list.appendChild(frag);
}

let homeObserver = null;
let homePending = false;

function connectHomeObserver() {
    const target = document.getElementById('chat');
    if (!target || !homeObserver) return;
    homeObserver.observe(target, { childList: true, subtree: true });
}

function scheduleHomeRender() {
    if (homePending) return;
    homePending = true;
    requestAnimationFrame(() => {
        homePending = false;
        homeObserver?.disconnect();
        try {
            renderHome();
        } catch (err) {
            console.error(`[${MODULE_NAME}] home render`, err);
        } finally {
            Promise.resolve().then(connectHomeObserver);
        }
    });
}

function startHomeObserver() {
    const target = document.getElementById('chat');
    if (!target) {
        setTimeout(startHomeObserver, 500);
        return;
    }
    homeObserver = new MutationObserver(() => scheduleHomeRender());
    connectHomeObserver();
    scheduleHomeRender();
}

/* ------------------------------------------------------------------
 *  Init
 * ------------------------------------------------------------------ */

jQuery(async () => {
    try {
        getSettings();

        const $host = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : ($('#extensions_settings').length ? $('#extensions_settings') : $('body'));
        $host.append(SETTINGS_HTML);

        if (!document.getElementById('cf_settings')) {
            console.error(`[${MODULE_NAME}] settings panel failed to mount.`);
            return;
        }

        bindSettingsPanel();
        applyTranslations(document.getElementById('cf_settings'));

        startListObserver();
        startHomeObserver();

        // Re-group when ST signals the character page changed, if such events
        // exist. Deliberately NOT subscribing to SETTINGS_UPDATED: our own
        // saveSettings() re-emits it, which would cause a redundant render on
        // every folder action (and on unrelated settings changes).
        for (const ev of ['CHARACTER_PAGE_LOADED', 'CHARACTER_EDITED', 'CHARACTER_DELETED']) {
            if (event_types?.[ev]) eventSource.on(event_types[ev], scheduleRender);
        }
        // The welcome screen is (re)built on chat changes; refresh the home view.
        if (event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(scheduleHomeRender, 100));
        }

        console.log(`[${MODULE_NAME}] loaded.`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] init failed`, err);
    }
});
