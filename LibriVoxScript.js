const PLATFORM = 'librivox';

const LIBRIVOX_AUTHOR_URL = 'https://librivox.org/author';
const LIBRIVOX_READER_URL = 'https://librivox.org/reader';
const ARCHIVE_VIEWS_URL = 'https://be-api.us.archive.org/views/v1/short';
const INTERNAL_BOOK_BASE = 'https://grayjay.internal/librivox/book';

const DEFAULT_BOOK_COVER = 'https://grayjay-plugin-librivox.craftwithstefan.com/assets/default-book-cover.png';
const DEFAULT_AVATAR = 'https://grayjay-plugin-librivox.craftwithstefan.com/LibriVoxIcon.png';

const USER_AGENT = `grayjay.app/${bridge.buildPlatform}/${bridge.buildVersion}`;
const ARCHIVE_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

// The API accepts at most 10 items per page
const ITEMS_PER_PAGE = 10;
const MAX_RETRIES = 3;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const RATE_LIMIT_DELAY_MS = 5000;

const FALLBACK_AUTHOR = 'Unknown Author';
const FALLBACK_TITLE = 'Unknown Title';
const FALLBACK_READER_DESCRIPTION = 'LibriVox volunteer reader.';
const UNKNOWN_COUNT = -1;
const NO_SUBSCRIBERS = 0;

// [label, API field, link template]; {value} is replaced with the field value
const AUTHOR_LINKS = [
    ['Wikipedia', 'wikipedia_url', '{value}'],
    ['Goodreads', 'goodreads_id', 'https://www.goodreads.com/author/show/{value}/'],
    ['IMDB', 'imdb_id', 'https://www.imdb.com/name/{value}/'],
    ['Amazon', 'amazon_id', 'https://www.amazon.com/stores/author/{value}/'],
    ['Library of Congress', 'lc_naf_id', 'https://id.loc.gov/authorities/names/{value}'],
    ['Wikidata', 'wikidata_id', 'https://www.wikidata.org/wiki/{value}'],
    ['VIAF', 'viaf_id', 'https://viaf.org/viaf/{value}/'],
    ['ISNI', 'isni_id', 'https://isni.org/isni/{value}'],
    ['Open Library', 'openlibrary_id', 'https://openlibrary.org/authors/{value}/'],
    ['Project Gutenberg', 'project_gutenberg_id', 'https://www.gutenberg.org/ebooks/author/{value}/'],
    ['BookBrainz', 'bookbrainz_id', 'https://bookbrainz.org/author/{value}'],
    ['LibraryThing', 'librarything_id', 'https://www.librarything.com/author/{value}/'],
    ['StoryGraph', 'storygraph_id', 'https://app.thestorygraph.com/authors/{value}'],
    ['MusicBrainz', 'musicbrainz_id', 'https://musicbrainz.org/artist/{value}'],
    ['Italian National Library', 'opac_sbn_id', 'https://opac.sbn.it/nome/{value}'],
    ['German National Library', 'gnd_id', 'https://d-nb.info/gnd/{value}'],
    ['YouTube', 'youtube_id', '{value}']
];

const REGEX = {
    // @example https://librivox.org/a-spot-by-thomas-hardy/?chapter=2
    LIBRIVOX_CHAPTER: /https:\/\/librivox\.org\/[\w\-]+(?:\/[\w\-]+)*\/\?([^#&]*&)*chapter=(\d+)(?:&[^#]*)?$/,
    // @example https://grayjay.internal/librivox/book/23008 (older releases used book?id=23008)
    INTERNAL_BOOK: /^https:\/\/grayjay\.internal\/librivox\/book(?:\/[^/?#]+|\?id=[^&#]+)/,
    // @example https://grayjay.internal/librivox/book/23008?chapter=0
    INTERNAL_CHAPTER: /^https:\/\/grayjay\.internal\/librivox\/book\/[^/?#]+\?(?:[^#]*&)?chapter=\d+/,
    // @example https://librivox.org/author/92/
    AUTHOR_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/author\/(\d+)\/?(?:\?[^#\s]*)?$/,
    // @example https://librivox.org/reader/11049
    READER_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/reader\/(\d+)\/?(?:\?[^#\s]*)?$/,
    // @example https://librivox.org/a-spot-by-thomas-hardy/
    LIBRIVOX_BOOK: /^https?:\/\/(?:www\.)?librivox\.org\/(?!(?:search|pages|category|reader|author|group|collections|\d{4}\/\d{2}\/\d{2})\/?)(?:[a-zA-Z0-9-]+)(?:-by-[a-zA-Z0-9-]+)?\/?(?:\?[^#\s]*)?$/,
    // @example https://librivox.org/short-poetry-collection-100/
    COLLECTION: /^https:\/\/librivox\.org\/.*collection.*\/$/,
    // @example https://archive.org/details/aspot_2610.poem_librivox
    ARCHIVE_ORG_DETAILS: /https:\/\/(?:www\.)?archive\.org\/details\/([^\/]+)/,
    // @example https://grayjay.internal/librivox/book?id=23008
    BOOK_ID_QUERY: /[?&]id=([^&]+)/,
    // Last path segment: the numeric id of an internal url or the slug of a librivox.org url
    // @example https://librivox.org/a-spot-by-thomas-hardy/?chapter=2
    BOOK_PATH_KEY: /\/([a-zA-Z0-9-]+)\/?(?:\?|$)/
};

let config = {};
let settings = {};
let state = { readers: {} };
let apiBaseUrl = '';

/**
 * @param {Object} conf Plugin config
 * @param {Object} pluginSettings User settings
 * @param {string} savedState Output of an earlier saveState
 */
source.enable = function (conf, pluginSettings, savedState) {
    config = conf;
    settings = pluginSettings;
    // The base url lives in the config so a development API can be swapped in
    apiBaseUrl = `${conf.constants.baseUrl}/api/v3`;

    for (const variable of ['languageOptionIndex', 'genreOptionIndex']) {
        if (IS_TESTING || settings[variable] === undefined) {
            settings[variable] = 0;
        }
    }

    // Spread over the default so states saved before the reader cache existed still load
    state = savedState ? { readers: {}, ...JSON.parse(savedState) } : { readers: {} };
};

source.saveState = function () {
    return JSON.stringify(state);
};

/**
 * Newest releases first, narrowed by the language and genre settings.
 * @returns {LibriVoxPager}
 */
source.getHome = function () {
    return audiobookPager('/audiobooks/feed', {
        sort_field: 'id',
        sort_order: 'desc',
        language: selectedOption('languageOptionIndex'),
        genre: selectedOption('genreOptionIndex')
    });
};

/**
 * @param {string} url
 * @returns {boolean}
 */
source.isPlaylistUrl = function (url) {
    // Chapter URLs also match the book patterns; Android search checks playlists first
    if (source.isContentDetailsUrl(url)) {
        return false;
    }
    return REGEX.INTERNAL_BOOK.test(url) || REGEX.LIBRIVOX_BOOK.test(url);
};

/**
 * @returns {ResultCapabilities} Language and genre filters taken from the setting dropdowns
 */
source.getSearchCapabilities = function () {
    return new ResultCapabilities(
        [Type.Feed.Mixed],
        [Type.Order.Chronological],
        [
            new FilterGroup('Language', filterCapabilities('languageOptionIndex'), false, 'language'),
            new FilterGroup('Genre', filterCapabilities('genreOptionIndex'), false, 'genre')
        ]
    );
};

/**
 * @param {string} query
 * @param {string} type Unused
 * @param {string} order Unused
 * @param {Object} filters Selected `language` and `genre` values
 * @returns {LibriVoxPager}
 */
source.search = function (query, type, order, filters) {
    return audiobookSearchPager('/audiobooks/search', query, filters);
};

/**
 * Searches authors; readers have no search endpoint.
 * @param {string} query
 * @returns {LibriVoxPager}
 */
source.searchChannels = function (query) {
    return new LibriVoxPager((offset) => {
        const response = apiGET('/authors/search', { q: query, limit: ITEMS_PER_PAGE, offset });
        return {
            results: response.data.map(author => authorToChannel(author, UNKNOWN_COUNT)),
            hasMore: offset + response.data.length < response.meta.total
        };
    });
};

/**
 * @param {string} channelUrl Author or reader URL
 * @param {string} query
 * @param {string} type Unused
 * @param {string} order Unused
 * @param {Object} filters Selected `language` and `genre` values
 * @returns {ContentPager}
 */
source.searchChannelContents = function (channelUrl, query, type, order, filters) {
    if (!query) {
        return new ContentPager([], false);
    }
    return audiobookSearchPager(`${channelApiPath(channelUrl)}/audiobooks/search`, query, filters);
};

/**
 * Autocomplete suggestions; returns [] when the request fails.
 * @param {string} query
 * @returns {string[]}
 */
source.searchSuggestions = function (query) {
    // Desktop binds a blank query string to null
    if (!query?.trim()) {
        return [];
    }

    // A failed suggestion request should not surface an error while the user types
    try {
        return apiGET('/search/autocomplete', { q: query.trim() }).data;
    } catch (error) {
        log(`Search suggestions failed: ${error.message}`);
        return [];
    }
};

/**
 * @param {string} url
 * @returns {boolean}
 */
source.isChannelUrl = function (url) {
    return REGEX.AUTHOR_CHANNEL.test(url) || REGEX.READER_CHANNEL.test(url);
};

/**
 * @param {string} url Author or reader URL
 * @returns {PlatformChannel}
 */
source.getChannel = function (url) {
    const authorId = REGEX.AUTHOR_CHANNEL.exec(url)?.[1];
    if (authorId) {
        const author = apiGET(`/authors/${authorId}`).data;
        if (!author?.id) {
            throw new ScriptException(`Author not found: ${authorId}`);
        }
        return authorToChannel(author, NO_SUBSCRIBERS);
    }

    const readerId = REGEX.READER_CHANNEL.exec(url)?.[1];
    if (!readerId) {
        throw new ScriptException(`Unsupported channel URL: ${url}`);
    }

    // Earlier releases cached a placeholder when the request failed; refetch those
    let reader = state.readers[readerId];
    if (!reader || reader.description === FALLBACK_READER_DESCRIPTION) {
        reader = fetchReader(readerId);
        state.readers[readerId] = reader;
    }

    const readerUrl = `${LIBRIVOX_READER_URL}/${readerId}`;
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, readerUrl, config.id),
        name: `${reader.name} (reader)`,
        thumbnail: DEFAULT_AVATAR,
        subscribers: NO_SUBSCRIBERS,
        description: reader.description,
        url: readerUrl,
        links: { 'LibriVox': readerUrl }
    });
};

/**
 * Books by an author, or books a reader recorded sections for (collections excluded).
 * @param {string} url Author or reader URL
 * @returns {LibriVoxPager}
 */
source.getChannelContents = function (url) {
    const path = `${channelApiPath(url)}/audiobooks`;
    if (REGEX.READER_CHANNEL.test(url)) {
        return audiobookPager(path, {}, book => !REGEX.COLLECTION.test(book.url_librivox ?? ''));
    }
    return audiobookPager(path, {});
};

/**
 * @param {string} url Internal or librivox.org book URL
 * @returns {PlatformPlaylistDetails} The book with one item per chapter
 */
source.getPlaylist = function (url) {
    const book = fetchAudiobook(url);
    const chapters = book.sections.map((section, index) => new PlatformVideo(chapterFields(book, section, index)));

    return new PlatformPlaylistDetails({
        // Slug URLs resolve to the numeric id so every form of a book shares one url and id
        id: new PlatformID(PLATFORM, String(book.id), config.id),
        author: bookAuthorLink(book),
        name: book.title || FALLBACK_TITLE,
        videoCount: chapters.length,
        contents: new VideoPager(chapters),
        url: `${INTERNAL_BOOK_BASE}/${book.id}`
    });
};

/**
 * @param {string} url
 * @returns {boolean}
 */
source.isContentDetailsUrl = function (url) {
    return REGEX.INTERNAL_CHAPTER.test(url) || REGEX.LIBRIVOX_CHAPTER.test(url);
};

/**
 * @param {string} url Chapter URL; `chapter` is the section index within the book
 * @returns {PlatformVideoDetails}
 */
source.getContentDetails = function (url) {
    const chapterParam = new URL(url).searchParams.get('chapter');
    const book = fetchAudiobook(url);
    const chapterIndex = Number(chapterParam);
    const section = book.sections[chapterIndex];

    if (!section) {
        throw new ScriptException(`Chapter not found: ${chapterParam}`);
    }

    // Sections without a recording are still listed by the API
    if (!section.listen_url) {
        throw new ScriptException('No audio sources found for chapter');
    }

    return new PlatformVideoDetails({
        ...chapterFields(book, section, chapterIndex),
        description: chapterDescription(book, section),
        video: new UnMuxVideoSourceDescriptor([], [
            new AudioUrlSource({
                name: 'audio (archive.org)',
                container: 'audio/mpeg',
                codec: 'mp3',
                url: section.listen_url,
                language: 'Unknown',
                duration: parseInt(section.playtime) || 0
            })
        ]),
        viewCount: fetchViewCount(book.url_iarchive)
    });
};

/**
 * GET with retries for network errors, 408, 429 (after a delay) and 5xx.
 * Other non-OK responses and invalid JSON throw at once, with the API's error message when it sent one.
 * @param {string} url
 * @param {Object} [headers]
 * @returns {Object} Parsed JSON body
 * @throws {ScriptException}
 */
function httpGET(url, headers = {}) {
    const requestHeaders = { 'User-Agent': USER_AGENT, ...headers };
    const maxAttempts = MAX_RETRIES + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response;
        try {
            response = http.GET(url, requestHeaders, false);
        } catch (error) {
            log(`Request error on ${url}: ${error}`);
            lastError = error;
            continue;
        }

        if (response.code === HTTP_TOO_MANY_REQUESTS) {
            lastError = new ScriptException(`Rate limited [${response.code}]: ${url}`);
            if (attempt < maxAttempts) {
                bridge.sleep(RATE_LIMIT_DELAY_MS);
            }
            continue;
        }

        // Android reports a socket timeout as 408
        if (response.code === HTTP_REQUEST_TIMEOUT || response.code >= HTTP_SERVER_ERROR) {
            lastError = new ScriptException(`Request failed [${response.code}]: ${url}`);
            continue;
        }

        if (!response.isOk) {
            let detail = url;
            try {
                detail = JSON.parse(response.body).error.message ?? url;
            } catch (error) {
                // Not the API's {error: {message}} body; keep the url as the detail
            }
            throw new ScriptException(`Request failed [${response.code}]: ${detail}`);
        }

        try {
            return JSON.parse(response.body);
        } catch (error) {
            throw new ScriptException(`Invalid JSON response from ${url}: ${error.message}`);
        }
    }

    log(`Request failed after ${maxAttempts} attempts: ${url}`);
    throw lastError;
}

/**
 * @param {string} path Path below /api/v3
 * @param {Object} [params] Query parameters; null and undefined values are left out
 * @returns {Object} The API envelope, `{ data, meta }`
 */
function apiGET(path, params) {
    const query = params ? `?${toQueryString(params)}` : '';
    return httpGET(`${apiBaseUrl}${path}${query}`);
}

function toQueryString(params) {
    return Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

/**
 * Pages through an audiobook list endpoint with limit and offset.
 * @param {string} path API path
 * @param {Object} params Extra query parameters
 * @param {Function} [include] Keeps a raw book when it returns true
 * @returns {LibriVoxPager}
 */
function audiobookPager(path, params, include = () => true) {
    return new LibriVoxPager((offset) => {
        const books = apiGET(path, { ...params, limit: ITEMS_PER_PAGE, offset }).data;
        return {
            results: books.filter(include).map(audiobookToPlaylist),
            hasMore: books.length === ITEMS_PER_PAGE
        };
    });
}

function audiobookSearchPager(path, query, filters) {
    const params = {
        q: query?.toLowerCase().trim(),
        language: filters?.language,
        genre: filters?.genre
    };
    // In-progress and abandoned projects have no librivox.org page
    return audiobookPager(path, params, book => book.url_librivox);
}

/**
 * @param {string} url Author or reader URL
 * @returns {string} The matching API path, `/authors/<id>` or `/readers/<id>`
 */
function channelApiPath(url) {
    const authorId = REGEX.AUTHOR_CHANNEL.exec(url)?.[1];
    if (authorId) {
        return `/authors/${authorId}`;
    }

    const readerId = REGEX.READER_CHANNEL.exec(url)?.[1];
    if (readerId) {
        return `/readers/${readerId}`;
    }

    throw new ScriptException(`Unsupported channel URL: ${url}`);
}

/**
 * @param {string} url Any accepted book or chapter URL (book?id=N, book/N, librivox.org slug)
 * @returns {Object} The API book, with `sections` in chapter order
 */
function fetchAudiobook(url) {
    const bookKey = REGEX.BOOK_ID_QUERY.exec(url)?.[1] ?? REGEX.BOOK_PATH_KEY.exec(url)?.[1];
    if (!bookKey) {
        throw new ScriptException(`Unrecognized audiobook URL: ${url}`);
    }

    const book = apiGET(`/audiobooks/${encodeURIComponent(bookKey)}`).data;
    if (!Array.isArray(book?.sections)) {
        throw new ScriptException('No audiobook data found in API response');
    }
    return book;
}

/**
 * @param {string} readerId
 * @returns {{name: string, description: string}} The entry cached in state.readers
 */
function fetchReader(readerId) {
    const reader = apiGET(`/readers/${readerId}`).data;
    if (!reader?.id) {
        throw new ScriptException(`Reader not found: ${readerId}`);
    }

    let description = reader.display_name ? `LibriVox reader ${reader.display_name}` : 'LibriVox volunteer reader';
    // The API sends both counts as strings
    if (reader.section_count > 0) {
        description += ` who has recorded ${reader.section_count} sections`;
    }
    if (reader.audiobook_count > 0) {
        description += ` across ${reader.audiobook_count} audiobooks`;
    }

    return {
        name: reader.display_name || `Reader ${readerId}`,
        description: `${description}.`
    };
}

/**
 * All-time views from archive.org; an optional extra, so failures return UNKNOWN_COUNT.
 * @param {string|null} archiveUrl The book's archive.org details URL
 * @returns {number}
 */
function fetchViewCount(archiveUrl) {
    const archiveId = archiveUrl?.match(REGEX.ARCHIVE_ORG_DETAILS)?.[1];
    if (!archiveId) {
        return UNKNOWN_COUNT;
    }

    try {
        const views = httpGET(`${ARCHIVE_VIEWS_URL}/${archiveId}`, ARCHIVE_HEADERS)[archiveId];
        return views?.have_data ? views.all_time || UNKNOWN_COUNT : UNKNOWN_COUNT;
    } catch (error) {
        log(`View count failed for ${archiveId}: ${error.message}`);
        return UNKNOWN_COUNT;
    }
}

function audiobookToPlaylist(book) {
    return new PlatformPlaylist({
        id: new PlatformID(PLATFORM, String(book.id), config.id),
        author: bookAuthorLink(book),
        name: book.title || FALLBACK_TITLE,
        thumbnail: bookCover(book),
        videoCount: book.num_sections || UNKNOWN_COUNT,
        url: `${INTERNAL_BOOK_BASE}/${book.id}`
    });
}

/**
 * Fields shared by a chapter's playlist item and its details page.
 * @param {Object} book API book
 * @param {Object} section Entry of book.sections
 * @param {number} index Position in book.sections
 * @returns {Object}
 */
function chapterFields(book, section, index) {
    return {
        id: new PlatformID(PLATFORM, `${book.id}_chapter_${index}`, config.id),
        name: section.title || `Chapter ${index + 1}`,
        author: bookAuthorLink(book),
        url: `${INTERNAL_BOOK_BASE}/${book.id}?chapter=${index}`,
        duration: parseInt(section.playtime) || 0,
        thumbnails: new Thumbnails([new Thumbnail(bookCover(book))])
    };
}

function chapterDescription(book, section) {
    let description = `${book.description || ''}\n\n`;

    if (book.authors.length > 0) {
        const authorLinks = book.authors.map(author => `<a href="${LIBRIVOX_AUTHOR_URL}/${author.id}">${author.name}</a>`);
        description += `Author${book.authors.length > 1 ? 's' : ''}: ${authorLinks.join(', ')}`;
    }

    if (section.readers.length > 0) {
        const readerLinks = section.readers.map(reader => `<a href="${LIBRIVOX_READER_URL}/${reader.id}">${reader.display_name ?? ''}</a>`);
        description += `\n\nRead by: ${readerLinks.join(', ')}`;
    }

    return description;
}

/**
 * Links the book to its first author; books without authors get an empty url.
 * @param {Object} book API book
 * @returns {PlatformAuthorLink}
 */
function bookAuthorLink(book) {
    const author = book.authors[0];
    const authorUrl = author ? `${LIBRIVOX_AUTHOR_URL}/${author.id}` : '';

    return new PlatformAuthorLink(
        new PlatformID(PLATFORM, authorUrl, config.id),
        author?.name || FALLBACK_AUTHOR,
        authorUrl,
        author?.image_url || DEFAULT_AVATAR
    );
}

function bookCover(book) {
    return book.coverart_thumbnail || book.coverart_jpg || DEFAULT_BOOK_COVER;
}

/**
 * @param {Object} author API author
 * @param {number} subscribers NO_SUBSCRIBERS on the channel page, UNKNOWN_COUNT in search results
 * @returns {PlatformChannel}
 */
function authorToChannel(author, subscribers) {
    // Subscriptions key on the channel url, so a trailing slash or query must not create a second one
    const authorUrl = `${LIBRIVOX_AUTHOR_URL}/${author.id}`;
    const links = { 'LibriVox': authorUrl };
    for (const [label, field, template] of AUTHOR_LINKS) {
        if (author[field]) {
            links[label] = template.replace('{value}', author[field]);
        }
    }

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, authorUrl, config.id),
        name: author.name || FALLBACK_AUTHOR,
        thumbnail: author.image_url || DEFAULT_AVATAR,
        subscribers,
        description: author.description || '',
        url: authorUrl,
        links
    });
}

function settingOptions(variable) {
    return config.settings.find(setting => setting.variable === variable).options;
}

function filterCapabilities(variable) {
    return settingOptions(variable)
        .filter(option => option !== 'All')
        .map(option => new FilterCapability(option, option));
}

/**
 * @param {string} variable Dropdown setting name
 * @returns {string|undefined} The chosen option, or undefined for 'All'
 */
function selectedOption(variable) {
    const option = settingOptions(variable)[settings[variable]];
    return option === 'All' ? undefined : option;
}

/**
 * Offset pager for every list. `fetchPage(offset)` returns `{ results, hasMore }`.
 */
class LibriVoxPager extends ContentPager {
    constructor(fetchPage, offset = 0) {
        const page = fetchPage(offset);
        super(page.results, page.hasMore);
        this.fetchPage = fetchPage;
        this.offset = offset;
    }

    nextPage() {
        return new LibriVoxPager(this.fetchPage, this.offset + ITEMS_PER_PAGE);
    }
}

log('loaded');
