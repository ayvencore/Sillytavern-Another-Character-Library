const EXTENSION_NAME = 'another-character-library';
const EXTENSION_TITLE = 'Another Character Library';
const SETTINGS_KEY = EXTENSION_NAME;

const DEFAULT_SETTINGS = {
    enabled: true,
    pageSize: 25,
    sortBy: 'az',
    activeTab: 'all',
    search: '',
    favorites: {},
    creatorLinks: {},
    overrides: {},
};

const SORT_OPTIONS = [
    { value: 'az', label: 'A-Z' },
    { value: 'za', label: 'Z-A' },
    { value: 'recently_added', label: 'Recently Added' },
    { value: 'added_first', label: 'Added First' },
    { value: 'recently_chatted', label: 'Recently Chatted' },
];

const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];
const TAB_OPTIONS = [
    { value: 'all', label: 'All Characters' },
    { value: 'favorites', label: 'Favourite Characters' },
];

function cloneValue(value) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

let settings = cloneValue(DEFAULT_SETTINGS);
let state = {
    characters: [],
    filteredCharacters: [],
    page: 1,
    pageScrollTop: 0,
    selectedCharacterKey: null,
    modalTab: 'overview',
    mounted: false,
    renderQueued: false,
    openMenuKey: null,
    searchDraft: '',
    topInset: 48,
    tokenCounts: {},
    tokenCountPending: new Set(),
};

function log(...args) {
    console.debug(`[${EXTENSION_NAME}]`, ...args);
}

function getContextSafe() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? globalThis.getContext?.() ?? null;
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Failed to get context`, error);
        return null;
    }
}

function getExtensionSettingsRoot(context) {
    return context?.extensionSettings ?? context?.extension_settings ?? globalThis.extension_settings ?? null;
}

function ensureSettings(context = getContextSafe()) {
    const root = getExtensionSettingsRoot(context);
    if (root) {
        root[SETTINGS_KEY] ??= cloneValue(DEFAULT_SETTINGS);
        settings = Object.assign(cloneValue(DEFAULT_SETTINGS), root[SETTINGS_KEY]);
    } else {
        settings = Object.assign(cloneValue(DEFAULT_SETTINGS), settings);
    }
    state.searchDraft = settings.search;
    return settings;
}

async function persistSettings(context = getContextSafe()) {
    const root = getExtensionSettingsRoot(context);
    if (root) {
        root[SETTINGS_KEY] = settings;
    }

    const saver = context?.saveSettingsDebounced
        ?? context?.saveSettings
        ?? globalThis.saveSettingsDebounced
        ?? globalThis.saveSettings;

    if (typeof saver === 'function') {
        await saver();
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function formatTokenCount(tokenCount) {
    if (!Number.isFinite(tokenCount)) {
        return '';
    }

    const rounded = Math.max(0, Math.round(tokenCount));
    return `${rounded.toLocaleString()} tokens`;
}

function stripHtml(value) {
    return normalizeString(value)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toEpoch(value) {
    if (!value) {
        return 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function buildCharacterKey(character, fallbackIndex = 0) {
    return character.avatar || character.avatar_url || character.chat || character.name || `character-${fallbackIndex}`;
}

function getTagData(context) {
    const tagMap = context?.tagMap ?? context?.tag_map ?? globalThis.tag_map ?? {};
    const tagsList = context?.tags ?? context?.tagList ?? globalThis.tags ?? [];
    const tagsById = new Map();

    for (const tag of tagsList) {
        if (tag?.id != null) {
            tagsById.set(String(tag.id), tag);
        }
    }

    return { tagMap, tagsById, tagsList };
}

function getTagmojisSettings(context = getContextSafe()) {
    const root = getExtensionSettingsRoot(context);
    return root?.tagmojis ?? null;
}

function getTagEmoji(tagId, context = getContextSafe()) {
    const normalizedId = normalizeString(tagId);
    if (!normalizedId) {
        return '';
    }

    return normalizeString(getTagmojisSettings(context)?.tagMetaById?.[normalizedId]?.emoji);
}

function renderTagContent(tag) {
    const emoji = normalizeString(tag?.emoji);
    const name = normalizeString(tag?.name);
    const emojiMarkup = emoji
        ? `<span class="acl-tag-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>`
        : '';
    const label = name || emoji || 'Untitled Tag';

    return `
        ${emojiMarkup}
        <span class="acl-tag-label">${escapeHtml(label)}</span>
    `;
}

function renderTagChip(tag, extraClass = '') {
    const classes = ['acl-tag'];
    if (extraClass) {
        classes.push(extraClass);
    }

    return `
        <span class="${classes.join(' ')}" ${tag?.color ? `style="--tag-accent:${escapeHtml(tag.color)}"` : ''}>
            ${renderTagContent(tag)}
        </span>
    `;
}

function tagSuggestions(context = getContextSafe()) {
    const { tagsList } = getTagData(context);
    return [...new Set(
        tagsList
            .map((tag) => normalizeString(tag?.name))
            .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));
}

function findCreatorNotes(character) {
    return normalizeString(
        character?.data?.creator_notes
        ?? character?.data?.extensions?.creator_notes
        ?? character?.creator_notes
        ?? character?.creatorNotes
        ?? character?.description
    );
}

function getCreatorName(character) {
    return normalizeString(
        character?.data?.creator
        ?? character?.creator
        ?? character?.data?.extensions?.creator
    );
}

function getCharacterVersion(character) {
    return normalizeString(
        character?.data?.character_version
        ?? character?.character_version
        ?? character?.data?.extensions?.character_version
        ?? character?.version
    );
}

function getFirstMessage(character) {
    return normalizeString(
        character?.data?.first_mes
        ?? character?.first_mes
        ?? character?.firstMessage
    );
}

function getPersonality(character) {
    return normalizeString(
        character?.data?.description
        ?? character?.description
        ?? character?.desc
        ?? character?.data?.desc
        ?? character?.data?.personality
        ?? character?.personality
        ?? character?.char_persona
        ?? character?.data?.char_persona
    );
}

function getAvatarUrl(character, context) {
    const rawAvatar = character?.avatar || character?.avatar_url || '';
    const formatter = context?.getThumbnailUrl ?? globalThis.getThumbnailUrl;
    if (typeof formatter === 'function' && rawAvatar) {
        try {
            return formatter('avatar', rawAvatar);
        } catch (error) {
            log('Thumbnail formatting failed, falling back to raw avatar', error);
        }
    }
    return rawAvatar;
}

function readOverride(characterKey) {
    return settings.overrides?.[characterKey] ?? {};
}

function getCreatorLink(characterKey, character) {
    return normalizeString(
        settings.creatorLinks?.[characterKey]
        ?? character?.data?.extensions?.creator_link
        ?? character?.data?.extensions?.creatorLink
        ?? character?.creator_link
        ?? character?.creatorLink
    );
}

function normalizeCharacters(context) {
    const source = Array.isArray(context?.characters) ? context.characters : [];
    const { tagMap, tagsById } = getTagData(context);

    return source.map((character, index) => {
        const key = buildCharacterKey(character, index);
        const override = readOverride(key);
        const tagIds = tagMap?.[key] ?? tagMap?.[character?.avatar] ?? tagMap?.[character?.name] ?? [];
        const tags = Array.isArray(tagIds)
            ? tagIds
                .map((tagId) => tagsById.get(String(tagId)))
                .filter(Boolean)
                .map((tag) => ({
                    id: String(tag.id),
                    name: normalizeString(tag.name),
                    color: normalizeString(tag.color),
                    emoji: getTagEmoji(String(tag.id), context),
                }))
            : [];
        const name = normalizeString(character?.name) || 'Untitled Character';
        const description = normalizeString(override.description ?? findCreatorNotes(character));
        const creator = normalizeString(override.creator ?? getCreatorName(character));
        const version = normalizeString(override.version ?? getCharacterVersion(character));
        const firstMessage = normalizeString(override.firstMessage ?? getFirstMessage(character));
        const personality = normalizeString(override.personality ?? getPersonality(character));

        return {
            key,
            index,
            raw: character,
            name,
            title: name,
            description,
            creator,
            version,
            firstMessage,
            personality,
            avatar: getAvatarUrl(character, context),
            tags,
            favorite: Boolean(settings.favorites?.[key] ?? character?.data?.extensions?.fav ?? character?.fav),
            creatorLink: normalizeString(override.creatorLink ?? getCreatorLink(key, character)),
            tokenCount: Number.isFinite(state.tokenCounts[key]) ? state.tokenCounts[key] : null,
            addedAt: Math.max(
                toEpoch(character?.create_date),
                toEpoch(character?.date_added),
                toEpoch(character?.created_at),
                toEpoch(character?.lastModified),
                toEpoch(character?.file_modified)
            ),
            lastChattedAt: Math.max(
                toEpoch(character?.date_last_chat),
                toEpoch(character?.last_chat),
                toEpoch(character?.chat_date),
                toEpoch(character?.last_interaction),
                toEpoch(character?.chat?.last_mes)
            ),
            searchHaystack: [
                name,
                stripHtml(description),
                creator,
                version,
                stripHtml(firstMessage),
                personality,
                ...tags.map((tag) => tag.name),
            ].join(' ').toLowerCase(),
        };
    });
}

function sortCharacters(characters) {
    const sorted = [...characters];
    switch (settings.sortBy) {
        case 'za':
            sorted.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'recently_added':
            sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || a.name.localeCompare(b.name));
            break;
        case 'added_first':
            sorted.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0) || a.name.localeCompare(b.name));
            break;
        case 'recently_chatted':
            sorted.sort((a, b) => (b.lastChattedAt || 0) - (a.lastChattedAt || 0) || a.name.localeCompare(b.name));
            break;
        case 'az':
        default:
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;
    }
    return sorted;
}

function filterCharacters(characters) {
    const query = normalizeString(settings.search).toLowerCase();
    let next = [...characters];

    if (settings.activeTab === 'favorites') {
        next = next.filter((character) => character.favorite);
    }

    if (query) {
        next = next.filter((character) => character.searchHaystack.includes(query));
    }

    return sortCharacters(next);
}

function getPagedCharacters(characters) {
    const pageSize = Number(settings.pageSize) || DEFAULT_SETTINGS.pageSize;
    const totalPages = Math.max(1, Math.ceil(characters.length / pageSize));
    state.page = Math.max(1, Math.min(state.page, totalPages));
    const start = (state.page - 1) * pageSize;
    return {
        totalPages,
        totalCharacters: characters.length,
        items: characters.slice(start, start + pageSize),
    };
}

function getSelectedCharacter() {
    return state.characters.find((character) => character.key === state.selectedCharacterKey) ?? null;
}

function isUnsetStateValue(value) {
    return value == null || value === '';
}

function hasVisibleNativeLandingHint() {
    const selectors = [
        '#chat .onboarding',
        '#chat .open_characters_library',
        '#NoCharacters',
    ];

    return selectors.some((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
            return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
}

function shouldShowLandingPage(context) {
    if (!settings.enabled) {
        return false;
    }

    const activeChatId = context?.chatId ?? context?.activeChatId ?? context?.chat?.id;

    // Mirror the reference landing-page extension: the empty-chat shell should be replaced
    // whenever there is no active chat, even if SillyTavern still considers some character selected.
    return isUnsetStateValue(activeChatId) || hasVisibleNativeLandingHint();
}

function rootElement() {
    return document.getElementById(`${EXTENSION_NAME}-root`);
}

function measureTopInset() {
    const selectorList = [
        '#top-settings-holder',
        '#top-settings-holder2',
        '#top-bar',
        '#top_nav',
        '.top-bar',
        'header',
    ];

    let maxBottom = 0;
    for (const selector of selectorList) {
        for (const element of document.querySelectorAll(selector)) {
            if (!(element instanceof HTMLElement)) {
                continue;
            }

            const style = window.getComputedStyle(element);
            if ((style.position !== 'fixed' && style.position !== 'sticky') || style.display === 'none' || style.visibility === 'hidden') {
                continue;
            }

            const rect = element.getBoundingClientRect();
            const isTopChrome = rect.top <= 8 && rect.bottom > 0 && rect.height > 12 && rect.height <= 160;
            if (isTopChrome) {
                maxBottom = Math.max(maxBottom, rect.bottom);
            }
        }
    }

    return Math.max(0, Math.round(maxBottom || 48));
}

function syncNativeLandingPageVisibility(isVisible) {
    document.body.classList.toggle('acl-landing-active', isVisible);
}

function scheduleRender() {
    if (state.renderQueued) {
        return;
    }
    state.renderQueued = true;
    window.requestAnimationFrame(() => {
        state.renderQueued = false;
        render();
    });
}

function ensureRoot() {
    let root = rootElement();
    if (root) {
        return root;
    }

    root = document.createElement('section');
    root.id = `${EXTENSION_NAME}-root`;
    root.className = 'acl-shell';
    root.addEventListener('click', onRootClick);
    root.addEventListener('focusin', onRootFocusIn);
    root.addEventListener('focusout', onRootFocusOut);
    root.addEventListener('input', onRootInput);
    root.addEventListener('keydown', onRootKeyDown);
    root.addEventListener('change', onRootChange);
    root.addEventListener('submit', onRootSubmit);
    root.addEventListener('scroll', onRootScroll, true);
    document.body.append(root);
    return root;
}

function onRootScroll(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (target.classList.contains('acl-page')) {
        state.pageScrollTop = target.scrollTop;
    }
}

function renderPagination(totalPages) {
    return `
        <nav class="acl-pagination" aria-label="Character pagination">
            <button type="button" data-action="page-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${state.page} of ${totalPages}</span>
            <button type="button" data-action="page-next" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
        </nav>
    `;
}

function render() {
    const context = getContextSafe();
    ensureSettings(context);
    injectSettingsButton();
    state.topInset = measureTopInset();
    state.characters = normalizeCharacters(context);
    state.filteredCharacters = filterCharacters(state.characters);

    const root = ensureRoot();
    const previousPage = root.querySelector('.acl-page');
    if (previousPage instanceof HTMLElement) {
        state.pageScrollTop = previousPage.scrollTop;
    }
    const isVisible = shouldShowLandingPage(context);
    root.style.setProperty('--acl-top-offset', `${state.topInset}px`);
    root.classList.toggle('is-visible', isVisible);
    root.classList.toggle('is-hidden', !isVisible);
    syncNativeLandingPageVisibility(isVisible);

    const selectedCharacter = getSelectedCharacter();
    const { items, totalPages, totalCharacters } = getPagedCharacters(state.filteredCharacters);

    root.innerHTML = `
        <div class="acl-backdrop"></div>
        <div class="acl-page">
            <header class="acl-topbar">
                <form class="acl-topbar-item acl-topbar-item--search acl-search-form" data-submit-action="submit-search">
                    <label class="acl-topbar-label" for="acl-library-search">Search</label>
                    <div class="acl-topbar-control acl-search-shell">
                        <input id="acl-library-search" type="search" name="search" placeholder="Search names, tags, descriptions..." value="${escapeHtml(state.searchDraft)}">
                        ${state.searchDraft ? '<button type="button" class="acl-search-clear" data-action="clear-search" aria-label="Clear search">&times;</button>' : ''}
                    </div>
                </form>
                <div class="acl-topbar-item acl-topbar-item--sort acl-compact-field">
                    <label class="acl-topbar-label" for="acl-library-sort">Sort</label>
                    <select id="acl-library-sort" name="sortBy" class="acl-topbar-control">
                        ${SORT_OPTIONS.map((option) => `
                            <option value="${option.value}" ${option.value === settings.sortBy ? 'selected' : ''}>${option.label}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="acl-topbar-item acl-topbar-item--show acl-compact-field">
                    <label class="acl-topbar-label" for="acl-library-page-size">Show</label>
                    <select id="acl-library-page-size" name="pageSize" class="acl-topbar-control">
                        ${PAGE_SIZE_OPTIONS.map((value) => `
                            <option value="${value}" ${value === Number(settings.pageSize) ? 'selected' : ''}>${value}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="acl-topbar-item acl-topbar-item--results acl-topbar-meta acl-topbar-meta--results">
                    <span class="acl-topbar-label">Characters</span>
                    <p class="acl-results acl-topbar-control">${totalCharacters}</p>
                </div>
                <div class="acl-topbar-item acl-topbar-item--views acl-topbar-tabs acl-topbar-tabs--views">
                    <span class="acl-topbar-label">View</span>
                    <nav class="acl-tabs acl-topbar-control" aria-label="Character views">
                        ${TAB_OPTIONS.map((tab) => `
                            <button
                                type="button"
                                class="acl-tab ${tab.value === settings.activeTab ? 'is-active' : ''}"
                                data-action="switch-tab"
                                data-tab="${tab.value}"
                            >
                                ${escapeHtml(tab.label)}
                            </button>
                        `).join('')}
                    </nav>
                </div>
            </header>

            ${renderPagination(totalPages)}

            <section class="acl-grid">
                ${items.length ? items.map(renderCard).join('') : `
                    <div class="acl-empty">
                        <h2>No characters matched</h2>
                        <p>Try a broader search, switch tabs, or reduce the filters.</p>
                    </div>
                `}
            </section>

            ${renderPagination(totalPages)}

            <button type="button" class="acl-scroll-top" data-action="scroll-top" aria-label="Scroll to top">Top</button>
        </div>

        ${selectedCharacter ? renderModal(selectedCharacter) : ''}
    `;

    const nextPage = root.querySelector('.acl-page');
    if (nextPage instanceof HTMLElement) {
        nextPage.scrollTop = state.pageScrollTop;
    }

    void queueVisibleTokenCounts(items, context);
}

function renderCard(character) {
    const visibleTags = character.tags.slice(0, 4);
    const hiddenTagCount = Math.max(0, character.tags.length - visibleTags.length);
    const isMenuOpen = state.openMenuKey === character.key;

    return `
        <article class="acl-card" data-character-key="${escapeHtml(character.key)}">
            <div class="acl-card-image-wrap">
                <button type="button" class="acl-card-button acl-card-button--image" data-action="open-modal" data-character-key="${escapeHtml(character.key)}">
                    ${character.avatar ? `<img class="acl-card-image" src="${escapeHtml(character.avatar)}" alt="${escapeHtml(character.name)}">` : '<div class="acl-card-image acl-card-image--empty"></div>'}
                </button>
                ${character.favorite ? '<span class="acl-card-favorite is-favorite">&#9733;</span>' : ''}
                <div class="acl-card-menu-anchor">
                    <button type="button" class="acl-card-menu-trigger" data-action="toggle-card-menu" data-character-key="${escapeHtml(character.key)}" aria-label="Character actions">&#8942;</button>
                    ${isMenuOpen ? `
                        <div class="acl-card-menu">
                            <button type="button" data-action="toggle-favorite" data-character-key="${escapeHtml(character.key)}">${character.favorite ? 'Unfavourite' : 'Favourite'}</button>
                            <button type="button" data-action="open-edit" data-character-key="${escapeHtml(character.key)}">Edit</button>
                            <button type="button" class="acl-danger" data-action="delete-character" data-character-key="${escapeHtml(character.key)}">Delete</button>
                        </div>
                    ` : ''}
                </div>
            </div>
            <button type="button" class="acl-card-button acl-card-button--body" data-action="open-modal" data-character-key="${escapeHtml(character.key)}">
                <div class="acl-card-body">
                    <div class="acl-card-heading">
                        <h2>${escapeHtml(character.title)}</h2>
                    </div>
                    <p class="acl-card-description">${escapeHtml(stripHtml(character.description) || 'No creator notes yet.')}</p>
                    ${visibleTags.length ? `
                        <div class="acl-tag-row">
                            ${visibleTags.map((tag) => renderTagChip(tag)).join('')}
                            ${hiddenTagCount ? `<span class="acl-tag acl-tag--muted">+${hiddenTagCount}</span>` : ''}
                        </div>
                    ` : ''}
                    <p class="acl-card-token-count" data-token-key="${escapeHtml(character.key)}" aria-live="polite">${formatTokenCount(character.tokenCount)}</p>
                </div>
            </button>
        </article>
    `;
}

function getCharacterTokenSource(character) {
    const sourceCharacter = character?.raw ?? character;
    const data = sourceCharacter?.data ?? {};
    const rawSections = [
        character?.personality,
        character?.firstMessage,
        data?.description,
        data?.personality,
        data?.char_persona,
        data?.first_mes,
        sourceCharacter?.description,
        sourceCharacter?.personality,
        sourceCharacter?.first_mes,
        sourceCharacter?.char_persona,
    ];

    const uniqueSections = new Set();
    const tokenSections = [];
    for (const value of rawSections) {
        const normalized = stripHtml(String(value ?? ''));
        const key = normalized.toLowerCase();
        if (!normalized || uniqueSections.has(key)) {
            continue;
        }

        uniqueSections.add(key);
        tokenSections.push(normalized);
    }

    return tokenSections.join('\n');
}

function updateTokenCountDisplay(characterKey, tokenCount) {
    state.tokenCounts[characterKey] = tokenCount;
    const root = rootElement();
    if (!(root instanceof HTMLElement)) {
        return;
    }

    for (const node of root.querySelectorAll('[data-token-key]')) {
        if (!(node instanceof HTMLElement) || node.dataset.tokenKey !== characterKey) {
            continue;
        }

        node.textContent = formatTokenCount(tokenCount);
    }
}

async function queueVisibleTokenCounts(characters, context = getContextSafe()) {
    if (!Array.isArray(characters) || !characters.length || typeof context?.getTokenCountAsync !== 'function') {
        return;
    }

    for (const character of characters) {
        if (!character?.key || Number.isFinite(state.tokenCounts[character.key]) || state.tokenCountPending.has(character.key)) {
            continue;
        }

        const tokenSource = getCharacterTokenSource(character);
        if (!tokenSource) {
            updateTokenCountDisplay(character.key, 0);
            continue;
        }

        state.tokenCountPending.add(character.key);
        Promise.resolve(context.getTokenCountAsync(tokenSource))
            .then((result) => {
                const tokenCount = Number(result);
                updateTokenCountDisplay(character.key, Number.isFinite(tokenCount) ? tokenCount : 0);
            })
            .catch((error) => {
                log('Token count failed', error);
                updateTokenCountDisplay(character.key, 0);
            })
            .finally(() => {
                state.tokenCountPending.delete(character.key);
            });
    }
}

function renderEditTagChip(tagName, context = getContextSafe()) {
    const suggestion = getTagData(context).tagsList.find((tag) => normalizeString(tag?.name).toLowerCase() === normalizeString(tagName).toLowerCase());
    const accent = normalizeString(suggestion?.color);
    const emoji = getTagEmoji(String(suggestion?.id ?? ''), context);

    return `
        <span class="acl-tag acl-tag--editable" ${accent ? `style="--tag-accent:${escapeHtml(accent)}"` : ''}>
            ${renderTagContent({ name: tagName, emoji })}
            <button type="button" class="acl-tag-remove" data-action="remove-edit-tag" data-tag-name="${escapeHtml(tagName)}" aria-label="Remove ${escapeHtml(tagName)}">&times;</button>
        </span>
    `;
}

function renderTagSuggestionChip(tagName, context = getContextSafe()) {
    const suggestion = getTagData(context).tagsList.find((tag) => normalizeString(tag?.name).toLowerCase() === normalizeString(tagName).toLowerCase());
    const accent = normalizeString(suggestion?.color);
    const emoji = getTagEmoji(String(suggestion?.id ?? ''), context);

    return `
        <button type="button" class="acl-tag-suggestion acl-tag" data-action="choose-edit-tag" data-tag-name="${escapeHtml(tagName)}" ${accent ? `style="--tag-accent:${escapeHtml(accent)}"` : ''}>
            ${renderTagContent({ name: tagName, emoji })}
        </button>
    `;
}

function renderEditTagEditor(character) {
    const tagNames = character.tags.map((tag) => tag.name);

    return `
        <div class="acl-tag-editor-field">
            <span>Tags</span>
            <div class="acl-tag-editor" data-tag-editor>
                <div class="acl-tag-editor-list" data-role="tag-list">
                    ${tagNames.length
                        ? tagNames.map((tagName) => renderEditTagChip(tagName)).join('')
                        : '<span class="acl-tag acl-tag--muted">No tags added yet</span>'}
                </div>
                <div class="acl-tag-editor-controls">
                    <div class="acl-tag-input-wrap">
                        <input type="text" data-role="tag-input" autocomplete="off" placeholder="Add a tag and press Enter">
                        <div class="acl-tag-suggestions" data-role="tag-suggestions"></div>
                    </div>
                    <button type="button" class="acl-secondary" data-action="add-edit-tag">Add</button>
                </div>
                <input type="hidden" name="tags" value="${escapeHtml(tagNames.join(', '))}">
            </div>
        </div>
    `;
}

function hasLikelyHtml(value) {
    return /<[^>]+>/.test(String(value ?? ''));
}

function sanitizeUrl(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
        return '';
    }

    return /^(https?:\/\/|data:image\/)/i.test(normalized) ? normalized : '';
}

function sanitizeHtml(value) {
    const parser = new DOMParser();
    const document = parser.parseFromString(String(value ?? ''), 'text/html');
    const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);

    const elements = Array.from(document.body.querySelectorAll('*'));
    for (const element of elements) {
        const tagName = element.tagName.toLowerCase();
        if (blockedTags.has(tagName)) {
            element.remove();
            continue;
        }

        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value ?? '';
            if (name.startsWith('on')) {
                element.removeAttribute(attribute.name);
                continue;
            }

            if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    return document.body.innerHTML;
}

function applyInlineFormatting(value, { enableMessageFormatting = false, highlightQuotes = false } = {}) {
    let formatted = String(value ?? '');

    if (enableMessageFormatting) {
        formatted = formatted
            .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
            .replace(/(^|[^\*])\*(?!\*)(.+?)\*(?!\*)/gs, '$1<em>$2</em>');
    }

    if (highlightQuotes) {
        formatted = formatted
            .replace(/\u201C/g, '&#8220;')
            .replace(/\u201D/g, '&#8221;');
        formatted = formatted
            .replace(/&quot;([\s\S]+?)&quot;/g, '<span class="acl-quote">&quot;$1&quot;</span>')
            .replace(/“([\s\S]+?)”/g, '<span class="acl-quote">“$1”</span>')
            .replace(/&#8220;([\s\S]+?)&#8221;/g, '<span class="acl-quote">&#8220;$1&#8221;</span>')
            .replace(/[“”]([\s\S]+?)[“”]/g, '<span class="acl-quote">$&</span>')
            .replace(/(?:&#8220;|&#8221;)([\s\S]+?)(?:&#8220;|&#8221;)/g, '<span class="acl-quote">$&</span>');
    }

    return formatted;
}

function renderRichBlocks(value, { enableMessageFormatting = false, highlightQuotes = false } = {}) {
    const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return '';
    }

    return normalized
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => {
            const singleLine = block.trim();
            if (/^([-*_]\s*){3,}$/.test(singleLine)) {
                return '<hr>';
            }

            const imageMatch = singleLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (imageMatch) {
                const src = sanitizeUrl(imageMatch[2]);
                if (src) {
                    return `
                        <figure class="acl-rich-media">
                            <img src="${escapeHtml(src)}" alt="${escapeHtml(imageMatch[1])}">
                        </figure>
                    `;
                }
            }

            const html = block
                .split('\n')
                .map((line) => applyInlineFormatting(escapeHtml(line), { enableMessageFormatting, highlightQuotes }))
                .join('<br>');

            return `<p>${html}</p>`;
        })
        .join('');
}

function renderTextBlockContent(value, { allowHtml = false, enableMessageFormatting = false, highlightQuotes = false } = {}) {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) {
        return '';
    }

    if (allowHtml && hasLikelyHtml(rawValue)) {
        return sanitizeHtml(rawValue);
    }

    return renderRichBlocks(rawValue, { enableMessageFormatting, highlightQuotes });
}

function renderCollapsibleSection(title, bodyHtml, emptyText, extraClass = '') {
    const sectionClass = ['acl-collapsible', extraClass].filter(Boolean).join(' ');

    return `
        <details class="${sectionClass}" open>
            <summary class="acl-collapsible-summary">
                <span class="acl-section-accent" aria-hidden="true"></span>
                <span class="acl-collapsible-title">${escapeHtml(title)}</span>
                <span class="acl-collapsible-arrow" aria-hidden="true"></span>
            </summary>
            <div class="acl-collapsible-body">
                ${bodyHtml
                    ? `<div class="acl-rich-text">${bodyHtml}</div>`
                    : `<p class="acl-empty-copy">${escapeHtml(emptyText)}</p>`}
            </div>
        </details>
    `;
}

function renderModal(character) {
    const isOverview = state.modalTab === 'overview';
    const creatorMeta = [character.version].filter(Boolean).join(' - ');
    const descriptionHtml = renderTextBlockContent(character.description, { allowHtml: true });
    const firstMessageHtml = renderTextBlockContent(character.firstMessage, { enableMessageFormatting: true, highlightQuotes: true });
    const personalityHtml = renderTextBlockContent(character.personality, { allowHtml: true });
    const creatorName = normalizeString(character.creator);
    const creatorLink = normalizeString(character.creatorLink);
    const creatorSource = creatorLink
        ? `
            <a class="acl-creator-link" href="${escapeHtml(creatorLink)}" target="_blank" rel="noopener noreferrer">
                <span>Source</span>
                <span class="acl-link-icon" aria-hidden="true">&#8599;</span>
            </a>
        `
        : '';

    return `
        <div class="acl-modal-backdrop" data-action="close-modal">
            <section class="acl-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(character.name)} details" data-modal-root="true">
                <header class="acl-modal-header">
                    <div>
                        <p class="acl-kicker">Character details</p>
                        <h2>${escapeHtml(character.name)}</h2>
                        ${creatorMeta ? `<p class="acl-modal-meta">${escapeHtml(creatorMeta)}</p>` : ''}
                    </div>
                    <div class="acl-modal-header-actions">
                        <button type="button" class="acl-secondary" data-action="open-native-edit" data-character-key="${escapeHtml(character.key)}">Open in ST</button>
                        <button type="button" class="acl-secondary" data-action="toggle-favorite" data-character-key="${escapeHtml(character.key)}">${character.favorite ? 'Unfavourite' : 'Favourite'}</button>
                        <button type="button" class="acl-danger" data-action="delete-character" data-character-key="${escapeHtml(character.key)}">Delete</button>
                        <button type="button" class="acl-secondary" data-action="close-modal">Close</button>
                    </div>
                </header>

                <nav class="acl-modal-tabs" aria-label="Character modal sections">
                    <button type="button" class="${isOverview ? 'is-active' : ''}" data-action="modal-tab" data-tab="overview">Overview</button>
                    <button type="button" class="${!isOverview ? 'is-active' : ''}" data-action="modal-tab" data-tab="edit">Edit</button>
                </nav>

                <div class="acl-modal-content">
                    ${isOverview ? `
                        <div class="acl-modal-layout">
                            <div class="acl-modal-image-panel">
                                ${character.avatar ? `<img class="acl-modal-image" src="${escapeHtml(character.avatar)}" alt="${escapeHtml(character.name)}">` : '<div class="acl-modal-image acl-modal-image--empty"></div>'}
                                <button type="button" class="acl-primary acl-modal-chat" data-action="quick-chat" data-character-key="${escapeHtml(character.key)}">Chat</button>
                                ${(creatorName || creatorLink) ? `
                                    <section class="acl-modal-side-section acl-modal-origin-panel">
                                        <h3>Bot creator</h3>
                                        <div class="acl-creator-row">
                                            ${creatorName ? `<span class="acl-creator-name">${escapeHtml(creatorName)}</span>` : ''}
                                            ${creatorSource}
                                        </div>
                                    </section>
                                ` : ''}
                                <section class="acl-modal-side-section acl-modal-tag-panel">
                                    <h3>Tags</h3>
                                    <div class="acl-tag-row acl-tag-row--compact">
                                        ${character.tags.length
                                            ? character.tags.map((tag) => renderTagChip(tag)).join('')
                                            : '<span class="acl-tag acl-tag--muted">No tags added yet</span>'}
                                    </div>
                                </section>
                            </div>
                            <div class="acl-modal-details">
                                ${renderCollapsibleSection('Creator\'s Notes', descriptionHtml, 'No creator notes yet.', 'acl-modal-copy-section')}
                                ${renderCollapsibleSection('First message', firstMessageHtml, 'No first message found.', 'acl-modal-copy-section')}
                                ${renderCollapsibleSection('Description', personalityHtml, 'No description set.', 'acl-modal-copy-section')}
                            </div>
                        </div>
                    ` : `
                        <form class="acl-edit-form" data-submit-action="save-edit" data-character-key="${escapeHtml(character.key)}" autocomplete="off">
                            <label>
                                <span>Creator's Notes</span>
                                <textarea name="description" rows="4">${escapeHtml(character.description)}</textarea>
                            </label>
                            <label>
                                <span>Creator name</span>
                                <input type="text" name="creator" value="${escapeHtml(character.creator)}">
                            </label>
                            <label>
                                <span>Version</span>
                                <input type="text" name="version" value="${escapeHtml(character.version)}">
                            </label>
                            <label>
                                <span>Creator link</span>
                                <input type="url" name="creatorLink" value="${escapeHtml(character.creatorLink)}" placeholder="https://...">
                            </label>
                            <label>
                                <span>First message</span>
                                <textarea name="firstMessage" rows="4">${escapeHtml(character.firstMessage)}</textarea>
                            </label>
                            <label>
                                <span>Description</span>
                                <textarea name="personality" rows="4">${escapeHtml(character.personality)}</textarea>
                            </label>
                            ${renderEditTagEditor(character)}
                            <div class="acl-edit-actions">
                                <button type="submit" class="acl-primary">Save changes</button>
                            </div>
                        </form>
                    `}
                </div>
            </section>
        </div>
    `;
}

function normalizeTagNames(tagNames) {
    const unique = new Set();
    const result = [];

    for (const tagName of tagNames) {
        const normalized = normalizeString(tagName);
        const key = normalized.toLowerCase();
        if (!normalized || unique.has(key)) {
            continue;
        }

        unique.add(key);
        result.push(normalized);
    }

    return result;
}

function parseTagInputValue(value) {
    return normalizeTagNames(String(value ?? '')
        .split(',')
        .map((item) => item.trim()));
}

function readTagEditorNames(editor) {
    if (!(editor instanceof HTMLElement)) {
        return [];
    }

    const hiddenInput = editor.querySelector('input[name="tags"]');
    return hiddenInput instanceof HTMLInputElement ? parseTagInputValue(hiddenInput.value) : [];
}

function writeTagEditorNames(editor, tagNames) {
    if (!(editor instanceof HTMLElement)) {
        return;
    }

    const nextNames = normalizeTagNames(tagNames);
    const hiddenInput = editor.querySelector('input[name="tags"]');
    const list = editor.querySelector('[data-role="tag-list"]');

    if (hiddenInput instanceof HTMLInputElement) {
        hiddenInput.value = nextNames.join(', ');
    }

    if (list instanceof HTMLElement) {
        list.innerHTML = nextNames.length
            ? nextNames.map((tagName) => renderEditTagChip(tagName)).join('')
            : '<span class="acl-tag acl-tag--muted">No tags added yet</span>';
    }
}

function addTagToEditor(editor, rawTagName) {
    const nextTagNames = parseTagInputValue(rawTagName);
    if (!nextTagNames.length) {
        return;
    }

    const currentNames = readTagEditorNames(editor);
    writeTagEditorNames(editor, [...currentNames, ...nextTagNames]);

    const input = editor?.querySelector('[data-role="tag-input"]');
    if (input instanceof HTMLInputElement) {
        input.value = '';
        input.focus();
    }

    refreshTagSuggestions(editor, '');
}

function removeTagFromEditor(editor, rawTagName) {
    const removeKey = normalizeString(rawTagName).toLowerCase();
    const nextNames = readTagEditorNames(editor).filter((tagName) => tagName.toLowerCase() !== removeKey);
    writeTagEditorNames(editor, nextNames);
    refreshTagSuggestions(editor, editor?.querySelector('[data-role="tag-input"]')?.value ?? '');
}

function getTagSuggestionNames(editor, query) {
    const selectedTagNames = new Set(readTagEditorNames(editor).map((tagName) => tagName.toLowerCase()));
    const normalizedQuery = normalizeString(query).toLowerCase();

    return tagSuggestions()
        .filter((tagName) => !selectedTagNames.has(tagName.toLowerCase()))
        .filter((tagName) => !normalizedQuery || tagName.toLowerCase().startsWith(normalizedQuery))
        .sort((left, right) => left.localeCompare(right));
}

function shouldDropTagSuggestionsUp(editor) {
    const input = editor?.querySelector('[data-role="tag-input"]');
    if (!(input instanceof HTMLElement)) {
        return false;
    }

    const rect = input.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom;
    const availableAbove = rect.top;
    return availableBelow < 240 && availableAbove > availableBelow;
}

function refreshTagSuggestions(editor, query) {
    if (!(editor instanceof HTMLElement)) {
        return;
    }

    const suggestionList = editor.querySelector('[data-role="tag-suggestions"]');
    if (!(suggestionList instanceof HTMLElement)) {
        return;
    }

    const suggestions = getTagSuggestionNames(editor, query);
    suggestionList.innerHTML = suggestions.length
        ? suggestions.map((tagName) => renderTagSuggestionChip(tagName)).join('')
        : '';
    suggestionList.classList.toggle('is-visible', suggestions.length > 0);
    suggestionList.classList.toggle('is-drop-up', suggestions.length > 0 && shouldDropTagSuggestionsUp(editor));
}

function closeTagSuggestions(editor) {
    if (!(editor instanceof HTMLElement)) {
        return;
    }

    const suggestionList = editor.querySelector('[data-role="tag-suggestions"]');
    if (suggestionList instanceof HTMLElement) {
        suggestionList.innerHTML = '';
        suggestionList.classList.remove('is-visible');
    }
}

function onRootInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (target.getAttribute('name') === 'search') {
        state.searchDraft = target.value ?? '';
        if (!state.searchDraft) {
            settings.search = '';
            state.page = 1;
            persistSettings();
            scheduleRender();
        }
    }

    if (target instanceof HTMLInputElement && target.dataset.role === 'tag-input') {
        refreshTagSuggestions(target.closest('[data-tag-editor]'), target.value);
    }
}

function onRootFocusIn(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    if (target.dataset.role === 'tag-input') {
        refreshTagSuggestions(target.closest('[data-tag-editor]'), target.value);
    }
}

function onRootFocusOut(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const editor = target.closest('[data-tag-editor]');
    if (!(editor instanceof HTMLElement)) {
        return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof HTMLElement && editor.contains(nextTarget)) {
        return;
    }

    closeTagSuggestions(editor);
}

function onRootKeyDown(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    if (target.dataset.role !== 'tag-input') {
        return;
    }

    if (event.key !== 'Enter' && event.key !== ',') {
        return;
    }

    event.preventDefault();
    addTagToEditor(target.closest('[data-tag-editor]'), target.value);
}

function onRootChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (target.getAttribute('name') === 'sortBy') {
        settings.sortBy = target.value;
        state.page = 1;
        state.openMenuKey = null;
        persistSettings();
        scheduleRender();
        return;
    }

    if (target.getAttribute('name') === 'pageSize') {
        settings.pageSize = Number(target.value) || DEFAULT_SETTINGS.pageSize;
        state.page = 1;
        state.openMenuKey = null;
        persistSettings();
        scheduleRender();
        return;
    }

}

function closestActionElement(target) {
    let candidate = null;

    if (target instanceof Element) {
        candidate = target;
    } else if (target instanceof Node) {
        candidate = target.parentElement;
    }

    if (!(candidate instanceof Element)) {
        return null;
    }

    const element = candidate.closest('[data-action]');
    if (element instanceof HTMLFormElement) {
        return null;
    }

    return element instanceof HTMLElement ? element : null;
}

function getCharacterByActionElement(element) {
    const key = element?.getAttribute('data-character-key');
    return state.characters.find((character) => character.key === key) ?? null;
}

async function onRootClick(event) {
    const actionElement = closestActionElement(event.target);
    if (!actionElement) {
        const clickedInsideTagEditor = event.target instanceof HTMLElement && event.target.closest('[data-tag-editor]');
        if (!clickedInsideTagEditor) {
            for (const editor of rootElement()?.querySelectorAll('[data-tag-editor]') ?? []) {
                closeTagSuggestions(editor);
            }
        }
        if (state.openMenuKey) {
            state.openMenuKey = null;
            scheduleRender();
        }
        return;
    }

    if (actionElement.classList.contains('acl-modal-backdrop') && event.target !== actionElement) {
        if (event.target instanceof HTMLInputElement && event.target.dataset.role === 'tag-input') {
            refreshTagSuggestions(event.target.closest('[data-tag-editor]'), event.target.value);
        }
        return;
    }

    event.preventDefault();
    const action = actionElement.getAttribute('data-action');
    const character = getCharacterByActionElement(actionElement);

    switch (action) {
        case 'switch-tab':
            settings.activeTab = actionElement.getAttribute('data-tab') || 'all';
            state.page = 1;
            state.openMenuKey = null;
            await persistSettings();
            scheduleRender();
            break;
        case 'page-prev':
            state.page = Math.max(1, state.page - 1);
            state.openMenuKey = null;
            scheduleRender();
            break;
        case 'page-next': {
            const totalPages = Math.max(1, Math.ceil(state.filteredCharacters.length / settings.pageSize));
            state.page = Math.min(totalPages, state.page + 1);
            state.openMenuKey = null;
            scheduleRender();
            break;
        }
        case 'open-modal':
            if (character) {
                state.openMenuKey = null;
                state.selectedCharacterKey = character.key;
                state.modalTab = 'overview';
                scheduleRender();
            }
            break;
        case 'toggle-card-menu':
            event.preventDefault();
            event.stopPropagation();
            state.openMenuKey = state.openMenuKey === character?.key ? null : character?.key ?? null;
            scheduleRender();
            break;
        case 'clear-search':
            state.searchDraft = '';
            settings.search = '';
            state.page = 1;
            state.openMenuKey = null;
            await persistSettings();
            scheduleRender();
            break;
        case 'close-modal':
            if (actionElement.classList.contains('acl-modal-backdrop')) {
                if (event.target === actionElement) {
                    state.selectedCharacterKey = null;
                    scheduleRender();
                }
                break;
            }
            state.selectedCharacterKey = null;
            scheduleRender();
            break;
        case 'open-edit':
            if (character) {
                state.openMenuKey = null;
                state.selectedCharacterKey = character.key;
                state.modalTab = 'edit';
                scheduleRender();
            }
            break;
        case 'modal-tab':
            state.modalTab = actionElement.getAttribute('data-tab') || 'overview';
            scheduleRender();
            break;
        case 'toggle-favorite':
            if (character) {
                await toggleFavorite(character.key);
            }
            break;
        case 'open-native-edit':
            if (character) {
                await openNativeCharacterEditor(character);
            }
            break;
        case 'quick-chat':
            if (character) {
                await openCharacterChat(character);
            }
            break;
        case 'delete-character':
            if (character) {
                await deleteCharacter(character);
            }
            break;
        case 'add-edit-tag':
            addTagToEditor(
                actionElement.closest('[data-tag-editor]'),
                actionElement.closest('[data-tag-editor]')?.querySelector('[data-role="tag-input"]')?.value,
            );
            break;
        case 'remove-edit-tag':
            removeTagFromEditor(actionElement.closest('[data-tag-editor]'), actionElement.getAttribute('data-tag-name'));
            break;
        case 'choose-edit-tag':
            addTagToEditor(actionElement.closest('[data-tag-editor]'), actionElement.getAttribute('data-tag-name'));
            break;
        case 'scroll-top': {
            const page = rootElement()?.querySelector('.acl-page');
            if (page instanceof HTMLElement) {
                page.scrollTo({ top: 0, behavior: 'smooth' });
            }
            break;
        }
        default:
            break;
    }
}

async function onRootSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    if (form.dataset.submitAction === 'save-edit') {
        event.preventDefault();
        await saveEditForm(form);
        return;
    }

    if (form.dataset.submitAction === 'submit-search') {
        event.preventDefault();
        settings.search = state.searchDraft;
        state.page = 1;
        await persistSettings();
        scheduleRender();
    }
}

async function toggleFavorite(characterKey) {
    settings.favorites[characterKey] = !settings.favorites[characterKey];
    state.openMenuKey = null;
    await persistSettings();
    scheduleRender();
}

async function openCharacterChat(character) {
    const context = getContextSafe();
    const candidateMethods = [
        typeof context?.openCharacterChat === 'function' ? () => context.openCharacterChat(character.raw) : null,
        typeof context?.selectCharacterById === 'function' ? () => context.selectCharacterById(character.index) : null,
        typeof context?.setCharacterId === 'function' ? () => context.setCharacterId(character.index) : null,
        typeof globalThis.selectCharacterById === 'function' ? () => globalThis.selectCharacterById(character.index) : null,
        typeof globalThis.openCharacterChat === 'function' ? () => globalThis.openCharacterChat(character.raw) : null,
    ].filter(Boolean);

    for (const invoke of candidateMethods) {
        try {
            await invoke?.();
            state.selectedCharacterKey = null;
            scheduleRender();
            return;
        } catch (error) {
            log('Chat open attempt failed', error);
        }
    }

    console.warn(`[${EXTENSION_NAME}] No compatible chat-open API was found.`);
}

async function openNativeCharacterEditor(character) {
    const context = getContextSafe();
    const waitForUi = (delay = 80) => new Promise((resolve) => window.setTimeout(resolve, delay));
    const characterIndex = Number.isInteger(character?.index) ? String(character.index) : '';

    const navOpenSelectors = [
        '#rightNavDrawerIcon',
        '#rm_button_characters',
        '[data-action="open-character-list"]',
        '[data-action="characters"]',
    ];

    const isRightNavOpen = () => {
        const panel = document.getElementById('right-nav-panel');
        if (!(panel instanceof HTMLElement)) {
            return false;
        }
        return !panel.classList.contains('closedDrawer') || panel.classList.contains('openDrawer');
    };

    if (!isRightNavOpen()) {
        for (const selector of navOpenSelectors) {
            const button = document.querySelector(selector);
            if (button instanceof HTMLElement) {
                button.click();
                await waitForUi(120);
                if (isRightNavOpen()) {
                    break;
                }
            }
        }
    }

    try {
        if (typeof context?.selectCharacterById === 'function') {
            await context.selectCharacterById(character.index);
        } else if (typeof globalThis.selectCharacterById === 'function') {
            await globalThis.selectCharacterById(character.index);
        } else if (typeof context?.setCharacterId === 'function') {
            await context.setCharacterId(character.index);
            const selectedButton = document.getElementById('rm_button_selected_ch');
            if (selectedButton instanceof HTMLElement) {
                selectedButton.click();
            }
        } else if ('this_chid' in globalThis && characterIndex) {
            globalThis.this_chid = characterIndex;
            const selectedButton = document.getElementById('rm_button_selected_ch');
            if (selectedButton instanceof HTMLElement) {
                selectedButton.click();
            }
        }
        await waitForUi(180);
    } catch (error) {
        log('Native character manager selection failed', error);
    }

    const editSelectors = [
        '#character_edit_button',
        '#rm_button_selected_ch',
        '[data-action="character_edit"]',
        '[data-action="edit-character"]',
        '.open_character_popup',
    ];

    for (const selector of editSelectors) {
        const button = document.querySelector(selector);
        if (button instanceof HTMLElement) {
            button.click();
            state.selectedCharacterKey = null;
            scheduleRender();
            return;
        }
    }

    if (document.getElementById('right-nav-panel') instanceof HTMLElement && isRightNavOpen()) {
        state.selectedCharacterKey = null;
        scheduleRender();
        return;
    }

    notifyError('Could not find SillyTavern\'s native character editor button in this build.', 'Open in ST failed');
}

function getRequestHeaders(context = getContextSafe()) {
    return context?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
}

function getJsonHeaders(context = getContextSafe()) {
    const headers = new Headers(getRequestHeaders(context));
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    return Object.fromEntries(headers.entries());
}

function getFormHeaders(context = getContextSafe()) {
    const headers = new Headers(getRequestHeaders(context));
    headers.delete('Content-Type');
    return Object.fromEntries(headers.entries());
}

function notifySuccess(message, title = EXTENSION_TITLE) {
    if (typeof globalThis.toastr?.success === 'function') {
        globalThis.toastr.success(message, title, {
            timeOut: 2400,
            extendedTimeOut: 700,
            closeButton: false,
            preventDuplicates: true,
            newestOnTop: true,
        });
        return;
    }

    console.info(`[${EXTENSION_NAME}] ${title}: ${message}`);
}

function notifyError(message, title = EXTENSION_TITLE) {
    if (typeof globalThis.toastr?.error === 'function') {
        globalThis.toastr.error(message, title, {
            timeOut: 4200,
            extendedTimeOut: 900,
            closeButton: false,
            preventDuplicates: true,
            newestOnTop: true,
        });
        return;
    }

    console.error(`[${EXTENSION_NAME}] ${title}: ${message}`);
}

async function readResponseError(response) {
    try {
        const payload = await response.json();
        return normalizeString(payload?.error ?? payload?.message) || `${response.status} ${response.statusText}`;
    } catch {
        const text = normalizeString(await response.text());
        return text || `${response.status} ${response.statusText}`;
    }
}

async function fetchFullCharacter(character, context = getContextSafe()) {
    const avatarUrl = normalizeString(character?.raw?.avatar ?? character?.raw?.avatar_url ?? character?.key);
    if (!avatarUrl) {
        return null;
    }

    if (typeof context?.getOneCharacter === 'function') {
        try {
            const contextCharacter = await context.getOneCharacter(avatarUrl);
            if (contextCharacter) {
                return contextCharacter;
            }
        } catch (error) {
            log('getOneCharacter failed, falling back to API request', error);
        }
    }

    const response = await fetch('/api/characters/get', {
        method: 'POST',
        headers: getJsonHeaders(context),
        body: JSON.stringify({ avatar_url: avatarUrl }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(await readResponseError(response));
    }

    return await response.json();
}

function removeCharacterFromLocalState(character, context) {
    if (Array.isArray(context?.characters)) {
        const index = context.characters.findIndex((item, itemIndex) => buildCharacterKey(item, itemIndex) === character.key || item === character.raw);
        if (index >= 0) {
            context.characters.splice(index, 1);
        }
    }

    const root = getExtensionSettingsRoot(context);
    const tagRoot = context?.tagMap ?? context?.tag_map ?? root?.tag_map ?? null;
    if (tagRoot && typeof tagRoot === 'object') {
        delete tagRoot[character.key];
        if (character.raw?.avatar) {
            delete tagRoot[character.raw.avatar];
        }
        if (character.raw?.name) {
            delete tagRoot[character.raw.name];
        }
    }

    delete settings.favorites[character.key];
    delete settings.creatorLinks[character.key];
    delete settings.overrides[character.key];
    delete state.tokenCounts[character.key];
    state.tokenCountPending.delete(character.key);
}

async function deleteCharacter(character) {
    if (!globalThis.confirm?.(`Delete ${character.name}? This cannot be undone.`)) {
        return;
    }

    const context = getContextSafe();
    const avatarUrl = normalizeString(character.raw?.avatar ?? character.raw?.avatar_url ?? character.key);
    if (!avatarUrl) {
        notifyError('Missing avatar identifier for this character.', 'Delete failed');
        return;
    }

    try {
        const response = await fetch('/api/characters/delete', {
            method: 'POST',
            headers: getJsonHeaders(context),
            body: JSON.stringify({ avatar_url: avatarUrl, delete_chats: true }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            notifyError(await readResponseError(response), 'Delete failed');
            return;
        }

        if (typeof context?.getCharacters === 'function') {
            await context.getCharacters();
        }

        removeCharacterFromLocalState(character, context);
        await persistSettings(context);
        state.openMenuKey = null;
        state.selectedCharacterKey = null;
        scheduleRender();
        notifySuccess(`${character.name} was deleted.`, 'Character deleted');
    } catch (error) {
        notifyError(normalizeString(error?.message) || 'Request failed while deleting the character.', 'Delete failed');
    }
}

function upsertBuiltInTags(characterKey, tagNames) {
    const context = getContextSafe();
    const root = getExtensionSettingsRoot(context);
    const tagRoot = context?.tagMap ?? context?.tag_map ?? root?.tag_map ?? (root ? (root.tag_map ??= {}) : {});
    const existingTags = context?.tags ?? context?.tagList ?? root?.tags ?? globalThis.tags ?? [];

    const lookup = new Map(existingTags.map((tag) => [normalizeString(tag.name).toLowerCase(), tag]));
    const nextTagIds = [];

    for (const tagName of tagNames) {
        const key = normalizeString(tagName).toLowerCase();
        if (!key) {
            continue;
        }

        let tag = lookup.get(key);
        if (!tag) {
            tag = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: tagName,
                color: '',
            };
            existingTags.push(tag);
            lookup.set(key, tag);
        }
        nextTagIds.push(tag.id);
    }

    tagRoot[characterKey] = nextTagIds;
}

async function saveEditForm(form) {
    const formData = new FormData(form);
    const characterKey = String(form.dataset.characterKey || '');
    const character = state.characters.find((item) => item.key === characterKey);
    if (!character) {
        return;
    }

    const override = {
        description: normalizeString(formData.get('description')),
        creator: normalizeString(formData.get('creator')),
        version: normalizeString(formData.get('version')),
        creatorLink: normalizeString(formData.get('creatorLink')),
        firstMessage: normalizeString(formData.get('firstMessage')),
        personality: normalizeString(formData.get('personality')),
    };

    const tagNames = parseTagInputValue(formData.get('tags'));
    const context = getContextSafe();
    const avatar = normalizeString(character.raw?.avatar ?? character.raw?.avatar_url ?? character.key);
    if (!avatar) {
        notifyError('Missing avatar identifier for this character.', 'Save failed');
        return;
    }

    try {
        const fullCharacter = await fetchFullCharacter(character, context);
        if (!fullCharacter) {
            notifyError('Could not load the full character card before saving.', 'Save failed');
            return;
        }

        const existingExtensions = cloneValue(fullCharacter?.data?.extensions ?? character.raw?.data?.extensions ?? {});
        existingExtensions.creator_link = override.creatorLink;
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getJsonHeaders(context),
            body: JSON.stringify({
                avatar,
                creatorcomment: override.description,
                first_mes: override.firstMessage,
                description: override.personality,
                creator: override.creator,
                character_version: override.version,
                tags: tagNames,
                data: {
                    creator_notes: override.description,
                    first_mes: override.firstMessage,
                    description: override.personality,
                    creator: override.creator,
                    character_version: override.version,
                    tags: tagNames,
                    extensions: existingExtensions,
                },
            }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            notifyError(await readResponseError(response), 'Save failed');
            return;
        }

        settings.overrides[characterKey] = override;
        settings.creatorLinks[characterKey] = override.creatorLink;
        upsertBuiltInTags(characterKey, tagNames);
        delete state.tokenCounts[characterKey];
        state.tokenCountPending.delete(characterKey);
        await persistSettings(context);

        if (typeof context?.getCharacters === 'function') {
            await context.getCharacters();
        }

        state.modalTab = 'overview';
        scheduleRender();
        notifySuccess(`${character.name} was updated.`, 'Character saved');
    } catch (error) {
        log('Save failed', error);
        notifyError(normalizeString(error?.message) || 'Request failed while saving the character.', 'Save failed');
    }
}

function observeApp() {
    return;
}

function registerGlobalHooks() {
    const context = getContextSafe();
    const eventSource = context?.eventSource ?? globalThis.eventSource;
    const eventTypes = context?.eventTypes ?? globalThis.event_types ?? globalThis.eventTypes ?? {};
    const rerenderEvents = [
        eventTypes.CHAT_CHANGED,
        eventTypes.CHARACTER_SELECTED,
        eventTypes.CHARACTER_DELETED,
        eventTypes.CHARACTER_CREATED,
        eventTypes.APP_READY,
    ].filter(Boolean);

    if (eventSource?.on) {
        for (const eventName of rerenderEvents) {
            eventSource.on(eventName, scheduleRender);
        }
    }

    window.addEventListener('hashchange', scheduleRender);
    document.addEventListener('visibilitychange', scheduleRender);
}

function updateSettingsPanel(wrapper) {
    if (!(wrapper instanceof HTMLElement)) {
        return;
    }

    const enabledInput = wrapper.querySelector('[data-acl-setting="enabled"]');
    if (enabledInput instanceof HTMLInputElement) {
        enabledInput.checked = Boolean(settings.enabled);
    }

    const status = wrapper.querySelector('[data-role="landing-status"]');
    if (status instanceof HTMLElement) {
        status.textContent = settings.enabled
            ? 'The character library is enabled and will replace the default landing page when no chat is active.'
            : 'The character library is disabled. SillyTavern will use the default landing page instead.';
    }
}

function injectSettingsButton() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) {
        return;
    }

    const existing = host.querySelector(`[data-extension-panel="${EXTENSION_NAME}"]`);
    if (existing instanceof HTMLElement) {
        updateSettingsPanel(existing);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.extensionPanel = EXTENSION_NAME;
    wrapper.className = 'acl-settings-panel';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${EXTENSION_TITLE}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label acl-settings-toggle">
                    <input type="checkbox" data-acl-setting="enabled" ${settings.enabled ? 'checked' : ''}>
                    <span>Enable character library landing page</span>
                </label>
                <p class="acl-settings-copy" data-role="landing-status"></p>
                <p class="acl-settings-copy">Cards pull tags from SillyTavern's built-in tag system and prefer Creator's Notes for descriptions.</p>
            </div>
        </div>
    `;

    wrapper.addEventListener('change', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        if (target.dataset.aclSetting !== 'enabled') {
            return;
        }

        settings.enabled = target.checked;
        if (!settings.enabled) {
            state.selectedCharacterKey = null;
            state.openMenuKey = null;
        }
        updateSettingsPanel(wrapper);
        await persistSettings();
        scheduleRender();
    });

    host.append(wrapper);
    updateSettingsPanel(wrapper);
}

async function init() {
    ensureSettings();
    ensureRoot();
    injectSettingsButton();
    observeApp();
    registerGlobalHooks();
    scheduleRender();
    state.mounted = true;
    log('Initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
