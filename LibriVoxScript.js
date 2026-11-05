/**
 * LibriVox Plugin for Grayjay
 *
 * This plugin enables browsing, searching, and listening to free public domain audiobooks
 * from LibriVox. It prioritizes latest releases and provides access to the complete catalog.
 */

// ---------------------- Constants ----------------------
const PLATFORM = 'librivox';

// API and URL Constants
let URLS = {
    BASE: 'https://librivox.org',
    AUTHOR_BASE: 'https://librivox.org/author',
    READER_BASE: 'https://librivox.org/reader',

    ARCHIVE_VIEWS: 'https://be-api.us.archive.org/views/v1/short',
};

// Default images
const DEFAULT_IMAGES = {
    BOOK_COVER: 'https://grayjay-plugin-librivox.craftwithstefan.com/assets/default-book-cover.png',
    AUTHOR_AVATAR: 'https://grayjay-plugin-librivox.craftwithstefan.com/LibriVoxIcon.png',
    READER_AVATAR: 'https://grayjay-plugin-librivox.craftwithstefan.com/LibriVoxIcon.png'
};

// Regular Expressions
const REGEX = {
    CONTENT_DETAILS: /https:\/\/librivox\.org\/[\w\-]+(?:\/[\w\-]+)*\/\?([^#&]*&)*chapter=(\d+)(?:&[^#]*)?$/,
    // @example https://grayjay.internal/librivox/book/23008 (older releases used book?id=23008)
    INTERNAL_BOOK: /^https:\/\/grayjay\.internal\/librivox\/book(?:\/[^/?#]+|\?id=[^&#]+)/,
    // @example https://grayjay.internal/librivox/book/23008?chapter=0
    INTERNAL_CHAPTER: /^https:\/\/grayjay\.internal\/librivox\/book\/[^/?#]+\?(?:[^#]*&)?chapter=\d+/,
    AUTHOR_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/author\/(\d+)\/?(?:\?[^#\s]*)?$/,
    READER_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/reader\/(\d+)\/?(?:\?[^#\s]*)?$/,
    PLAYLIST: /^https?:\/\/(?:www\.)?librivox\.org\/(?!(?:search|pages|category|reader|author|group|collections|\d{4}\/\d{2}\/\d{2})\/?)(?:[a-zA-Z0-9-]+)(?:-by-[a-zA-Z0-9-]+)?\/?(?:\?[^#\s]*)?$/,
    COLLECTION: /^https:\/\/librivox\.org\/.*collection.*\/$/,
    ARCHIVE_ORG_DETAILS: /https:\/\/(?:www\.)?archive\.org\/details\/([^\/]+)/
};

// Request Headers
const REQUEST_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

// Default request headers
const REQUEST_HEADERS_API = {};

// Pagination Constants
const ITEMS_PER_PAGE = 10; // Max items per page allowed by API

// HTTP Request Constants
const DEFAULT_RETRIES = 3; // Retries for network errors, 408, 429 and 5xx only
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const RATE_LIMIT_DELAY_MS = 5000;
const INTERNAL_BOOK_BASE = 'https://grayjay.internal/librivox/book';

// Fallback Text Constants
const FALLBACK_AUTHOR = 'Unknown Author';
const FALLBACK_TITLE = 'Unknown Title';
const FALLBACK_READER_DESCRIPTION = 'LibriVox volunteer reader.';

// Numeric Constants
const UNKNOWN_COUNT = -1; // Indicates unknown/unavailable count (subscribers, views, etc.)
const NO_SUBSCRIBERS = 0; // Default subscriber count for LibriVox channels

// Plugin State
let config = {};
let state = {
    readers: {} // Cache for reader data
};

let settings = {}

let LANGUAGE_OPTIONS = [];
let GENRE_OPTIONS = [];

// ====================== PLUGIN ENTRY POINTS ======================

/**
 * Initialize the plugin with configuration
 * @param {Object} conf Configuration object
 * @param {Object} settings User settings
 * @param {string} saveStateStr Previously saved state
 */
source.enable = function (conf, set, saveStateStr) {
    config = conf;
    settings = set;

    // done this way to easily test with development instance of the API or change it in the future
    const API_BASE_URL = plugin.config.constants.baseUrl;

    URLS = {
        ...URLS,
        API_AUDIOBOOKS_FEED: `${API_BASE_URL}/api/v3/audiobooks/feed?sort_field=id&sort_order=desc`,
        API_AUDIOBOOKS_DETAILS: `${API_BASE_URL}/api/v3/audiobooks/{audioBookId}`,
        API_AUDIOBOOKS_SEARCH: `${API_BASE_URL}/api/v3/audiobooks/search`,
        API_AUTHORS_DETAILS: (id) => `${API_BASE_URL}/api/v3/authors/${id}`,
        API_AUTHORS_SEARCH: `${API_BASE_URL}/api/v3/authors/search`,
        API_AUTHORS_AUDIOBOOKS: (id) => `${API_BASE_URL}/api/v3/authors/${id}/audiobooks`,
        API_AUTHORS_AUDIOBOOKS_SEARCH: (id) => `${API_BASE_URL}/api/v3/authors/${id}/audiobooks/search`,
        API_READERS_DETAILS: (id) => `${API_BASE_URL}/api/v3/readers/${id}`,
        API_READERS_SECTIONS: (id) => `${API_BASE_URL}/api/v3/readers/${id}/sections`,
        API_READERS_AUDIOBOOKS: (id) => `${API_BASE_URL}/api/v3/readers/${id}/audiobooks`,
        API_READERS_AUDIOBOOKS_SEARCH: (id) => `${API_BASE_URL}/api/v3/readers/${id}/audiobooks/search`,
        API_AUTOCOMPLETE: `${API_BASE_URL}/api/v3/search/autocomplete`,
    }


    if (IS_TESTING || settings.languageOptionIndex === undefined) {
        settings.languageOptionIndex = 0;
    }

    if (IS_TESTING || settings.genreOptionIndex === undefined) {
        settings.genreOptionIndex = 0;
    }

    LANGUAGE_OPTIONS = loadOptionsForSetting('languageOptionIndex');
    GENRE_OPTIONS = loadOptionsForSetting('genreOptionIndex');

    if (saveStateStr) {
        try {
            state = JSON.parse(saveStateStr);

            // Ensure readers object exists
            if (!state.readers) {
                state.readers = {};
            }
        } catch (e) {
            bridge.log('Failed to restore state: ' + e.message);
            state.readers = {};
        }
    } else {
        state.readers = {};
    }
};

/**
 * Save plugin state for persistence
 * @returns {string} State as JSON string
 */
source.saveState = function () {
    return JSON.stringify(state);
};

/**
 * Get home page content with latest releases first
 * @returns {ContentPager} Paged results for home page
 */
source.getHome = function () {
    return new HomeContentPager();
};

/**
 * Check if URL is a playlist (audiobook)
 * @param {string} url URL to check
 * @returns {boolean} True if URL is an audiobook
 */
source.isPlaylistUrl = (url) => {
    // Chapter URLs also match the book patterns; Android search checks playlists first
    if (source.isContentDetailsUrl(url)) {
        return false;
    }
    return REGEX.INTERNAL_BOOK.test(url) || REGEX.PLAYLIST.test(url);
};

/**
 * Get search capabilities with language and genre filters
 * @returns {ResultCapabilities} Search capabilities
 */
source.getSearchCapabilities = function() {
    const languages = LANGUAGE_OPTIONS.filter(lang => lang !== 'All');
    const genres = GENRE_OPTIONS.filter(genre => genre !== 'All');

    return new ResultCapabilities(
        [Type.Feed.Mixed],
        [Type.Order.Chronological],
        [
            new FilterGroup(
                "Language",
                languages.map(lang => new FilterCapability(lang, lang)),
                false,
                "language"
            ),
            new FilterGroup(
                "Genre",
                genres.map(genre => new FilterCapability(genre, genre)),
                false,
                "genre"
            )
        ]
    );
};

/**
 * Search for audiobooks with optional filters
 * @param {string} query Search query
 * @param {string} type Content type (unused)
 * @param {string} order Sort order (unused)
 * @param {Object} filters Filter object with language and/or genre
 * @returns {ContentPager} Paged results for search
 */
source.search = function (query, type, order, filters) {
    return createAudiobookSearchPager(
        URLS.API_AUDIOBOOKS_SEARCH,
        query,
        null,
        filters
    );
};

/**
 * Search for LibriVox authors
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for author search
 */
source.searchChannels = function (query) {
    return new AuthorSearchPager({ context: { query, offset: 0 } }).nextPage();
};

/**
 * Search within a specific channel (author or reader)
 * @param {string} channelUrl Channel URL
 * @param {string} query Search query
 * @param {string} type Content type
 * @param {string} order Sort order
 * @param {Object} filters Search filters
 * @returns {ContentPager} Paged search results
 */
source.searchChannelContents = function (channelUrl, query, type, order, filters) {
    let searchUrl = null;

    if (REGEX.AUTHOR_CHANNEL.test(channelUrl)) {
        const match = channelUrl.match(REGEX.AUTHOR_CHANNEL);
        const id = match ? match[1] : null;
        searchUrl = id ? URLS.API_AUTHORS_AUDIOBOOKS_SEARCH(id) : null;
    } else if (REGEX.READER_CHANNEL.test(channelUrl)) {
        const match = channelUrl.match(REGEX.READER_CHANNEL);
        const id = match ? match[1] : null;
        searchUrl = id ? URLS.API_READERS_AUDIOBOOKS_SEARCH(id) : null;
    }

    if (!searchUrl || !query) {
        return new ContentPager([], false);
    }

    return createAudiobookSearchPager(searchUrl, query, null, filters);
};

/**
 * Get search suggestions for autocomplete
 * @param {string} query Search query
 * @returns {string[]} Array of suggestion strings
 */
source.searchSuggestions = function (query) {
    if (!query || query.trim().length === 0) {
        return [];
    }

    try {
        const url = `${URLS.API_AUTOCOMPLETE}?q=${encodeURIComponent(query.trim())}`;
        const response = httpGET(url);
        return Array.isArray(response?.data) ? response.data : [];
    } catch (error) {
        if (IS_TESTING) {
            bridge.log(`Error fetching search suggestions: ${error.message}`);
        }
    }

    return [];
}

/**
 * Check if URL is a channel (author or reader)
 * @param {string} url URL to check
 * @returns {boolean} True if URL is a channel
 */
source.isChannelUrl = function (url) {
    return REGEX.AUTHOR_CHANNEL.test(url) || REGEX.READER_CHANNEL.test(url);
};

/**
 * Get channel information (author or reader)
 * @param {string} url Channel URL
 * @returns {PlatformChannel} Channel information
 */
source.getChannel = function (url) {
    if (REGEX.AUTHOR_CHANNEL.test(url)) {
        return getAuthorChannel(url);
    } else if (REGEX.READER_CHANNEL.test(url)) {
        return getReaderChannel(url);
    }

    // Fallback for unknown channel type
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, url, config.id),
        name: 'Unknown Channel',
        thumbnail: DEFAULT_IMAGES.AUTHOR_AVATAR,
        subscribers: NO_SUBSCRIBERS,
        description: '',
        url,
        links: {}
    });
};
/**
 * Get channel contents (books by author or reader)
 * @param {string} url Channel URL
 * @returns {ContentPager} Paged results for channel contents
 */
source.getChannelContents = function (url) {
    if (REGEX.AUTHOR_CHANNEL.test(url)) {
        return getAuthorAudiobooks(url);
    } else if (REGEX.READER_CHANNEL.test(url)) {
        return getReaderAudiobooks(url);
    }

    return new ContentPager([], false);
};
/**
 * Get audiobook details (playlist)
 * @param {string} url Audiobook URL
 * @returns {PlatformPlaylistDetails} Audiobook details
 */
source.getPlaylist = function (url) {
    return getAudiobookDetails(url);
};

/**
 * Check if URL is a chapter details URL
 * @param {string} url URL to check
 * @returns {boolean} True if URL is a chapter URL
 */
source.isContentDetailsUrl = function (url) {
    return REGEX.INTERNAL_CHAPTER.test(url) || REGEX.CONTENT_DETAILS.test(url);
};

/**
 * Get chapter details
 * @param {string} url Chapter URL
 * @returns {PlatformVideoDetails} Chapter details
 */
source.getContentDetails = function (url) {
    const chapterId = new URL(url).searchParams.get('chapter');
    const playlistInfo = fetchAudiobookDetails(url);

    // Find chapter by index
    const chapter = playlistInfo.chapters.find(c => c.chapterId == chapterId);

    if (!chapter) {
        throw new ScriptException(`Chapter not found: ${chapterId}`);
    }

    // Format author information with links
    let authorsText = "";
    if (playlistInfo.authors && Array.isArray(playlistInfo.authors) && playlistInfo.authors.length > 0) {
        authorsText = "Author" + (playlistInfo.authors.length > 1 ? "s" : "") + ": ";
        authorsText += playlistInfo.authors.map(author => {
            const authorUrl = author.url || (author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '');
            if (authorUrl) {
                return `<a href="${authorUrl}">${author.name}</a>`;
            }
            return author.name;
        }).join(", ");
    } else if (playlistInfo.authorName && playlistInfo.authorUrl) {
        // Fallback for single author stored in legacy format
        authorsText = `Author: <a href="${playlistInfo.authorUrl}">${playlistInfo.authorName}</a>`;
    }

    // Format readers information with links
    let readersText = "";
    if (chapter.readers && chapter.readers.length > 0) {
        readersText = "\n\nRead by: ";
        readersText += chapter.readers.map(reader => {
            if (reader.url) {
                return `<a href="${reader.url}">${reader.name}</a>`;
            }
            return reader.name;
        }).join(", ");
    }

    // Create combined description
    const combinedDescription = `${playlistInfo.description || ''}\n\n${authorsText}${readersText}`;

    const duration = chapter.duration;

    const sources = [];

    if (chapter.chapterFile) {
        sources.push(new AudioUrlSource({
            name: 'audio (archive.org)',
            container: 'audio/mpeg',
            codec: 'mp3',
            url: chapter.chapterFile,
            language: 'Unknown',
            duration
        }));
    }

    if (sources.length === 0) {
        throw new ScriptException(`No audio sources found for chapter`);
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, `${playlistInfo.id}_chapter_${chapterId}`, config.id),
        name: chapter.chapterName,
        description: combinedDescription,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
            playlistInfo.authorName,
            playlistInfo.authorUrl,
            playlistInfo.authorThumbnailUrl
        ),
        url: `${INTERNAL_BOOK_BASE}/${playlistInfo.id}?chapter=${chapterId}`,
        duration: chapter.duration,
        thumbnails: new Thumbnails([new Thumbnail(playlistInfo.bookCoverUrl)]),
        video: new UnMuxVideoSourceDescriptor([], sources),
        viewCount: playlistInfo.viewCount
    });
};

function extractSlug(url) {
    // Extract the book slug from various LibriVox URL formats:
    // - /book-title/
    // - /book-title
    // - /book-title-by-author/
    // - /book-title/?params
    // - /book-title-by-author/?params
    const match = url.match(/\/([a-zA-Z0-9-]+)(?:-by-[a-zA-Z0-9-]+)?\/?(?:\?|$)/);
    return match ? match[1] : null;
}

// ====================== CUSTOM PAGER IMPLEMENTATIONS ======================

/**
 * Custom home content pager with latest releases first
 */
class HomeContentPager extends ContentPager {
    constructor() {
        super([], true, { offset: 0 });
        this.offset = 0;
        this.pageSize = ITEMS_PER_PAGE;
        this.nextPage();
    }

    nextPage() {
        this.results = [];
        // Only load more regular books on subsequent pages
        let languageOption = LANGUAGE_OPTIONS[settings.languageOptionIndex];
        let genreOption = GENRE_OPTIONS[settings.genreOptionIndex];

        let nextPageUrl = `${URLS.API_AUDIOBOOKS_FEED}&limit=${this.pageSize}&offset=${this.offset}`;

        if (languageOption && languageOption !== 'All') {
            nextPageUrl += `&language=${encodeURIComponent(languageOption)}`;
        }

        if (genreOption && genreOption !== 'All') {
            nextPageUrl += `&genre=${encodeURIComponent(genreOption)}`;
        }

        const books = httpGET(nextPageUrl).data;

        this.results = books
            .map(audiobookToPlaylist)
            .filter(book => book?.id);
        this.offset += this.pageSize;
        this.hasMore = this.results.length > 0;

        return this;
    }
}

/**
 * Search pager for audiobooks
 */
class SearchAudiobooksPager extends VideoPager {
    constructor({ videos = [], hasMore = true, context = {} } = {}) {
        super(videos, hasMore, context);
    }

    nextPage() {
        let offset = this.context.offset ?? 0;
        let searchResults = [];
        const params = {
            limit: this.context.limit || ITEMS_PER_PAGE,
            offset,
            q: this.context.query?.toLowerCase()?.trim(),
        };

        // Add filters if present
        if (this.context.filters) {
            if (this.context.filters.language) {
                params.language = this.context.filters.language;
            }
            if (this.context.filters.genre) {
                params.genre = this.context.filters.genre;
            }
        }

        const queryParams = objectToUrlEncodedString(params);
        const url = `${this.context.baseUrl}?${queryParams}`;

        const books = httpGET(url).data;

        searchResults = books
            .filter(b => b.url_librivox) // audiobooks in-progress or Abandoned don't have URL
            .filter(this.context.filterCb || (() => true))
            .map(audiobookToPlaylist);

        offset += (this.context.limit || ITEMS_PER_PAGE);
        let hasMore = books.length === (this.context.limit || ITEMS_PER_PAGE);

        return new SearchAudiobooksPager({
            videos: searchResults,
            hasMore,
            context: {
                ...this.context,
                offset: offset,
                filters: this.context.filters // Preserve filters for pagination
            },
        });
    }
}

/**
 * Reader audiobooks pager - provides proper pagination for a reader's audiobook list using API
 */
class ReaderAudiobooksPager extends VideoPager {
    constructor({ videos = [], hasMore = true, context = {} } = {}) {
        super(videos, hasMore, context);
    }

    nextPage() {
        const currentPage = this.context.page || 1;
        const readerId = this.context.readerId;
        const limit = ITEMS_PER_PAGE;
        const offset = (currentPage - 1) * limit;

        if (!readerId) {
            logError('Reader ID is required for ReaderAudiobooksPager');
            return new ReaderAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }

        const audiobooks = httpGET(`${URLS.API_READERS_AUDIOBOOKS(readerId)}?limit=${limit}&offset=${offset}`).data;

        const results = audiobooks
            .filter(audiobook => audiobook && audiobook.id)
            .filter(audiobook => !REGEX.COLLECTION.test(audiobook.url_librivox || ''))
            .map(audiobookToPlaylist)
            .filter(playlist => playlist !== null);

        return new ReaderAudiobooksPager({
            videos: results,
            hasMore: audiobooks.length === limit,
            context: {
                ...this.context,
                page: currentPage + 1
            }
        });
    }
}

/**
 * Author audiobooks pager - provides proper pagination for an author's audiobook list using API
 */
class AuthorAudiobooksPager extends VideoPager {
    constructor({ videos = [], hasMore = true, context = {} } = {}) {
        super(videos, hasMore, context);
    }

    nextPage() {
        const currentPage = this.context.page || 1;
        const authorId = this.context.authorId;
        const limit = ITEMS_PER_PAGE;
        const offset = (currentPage - 1) * limit;

        if (!authorId) {
            logError('Author ID is required for AuthorAudiobooksPager');
            return new AuthorAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }

        const audiobooks = httpGET(`${URLS.API_AUTHORS_AUDIOBOOKS(authorId)}?limit=${limit}&offset=${offset}`).data;

        const results = audiobooks
            .filter(audiobook => audiobook && audiobook.id)
            .map(audiobookToPlaylist)
            .filter(playlist => playlist !== null);

        return new AuthorAudiobooksPager({
            videos: results,
            hasMore: audiobooks.length === limit,
            context: {
                ...this.context,
                page: currentPage + 1
            }
        });
    }
}

/**
 * Author search pager; hasMore follows the API's meta.total
 */
class AuthorSearchPager extends ChannelPager {
    constructor({ channels = [], hasMore = true, context = {} } = {}) {
        super(channels, hasMore, context);
    }

    nextPage() {
        const offset = this.context.offset;
        const params = objectToUrlEncodedString({ q: this.context.query, limit: ITEMS_PER_PAGE, offset });
        const response = httpGET(`${URLS.API_AUTHORS_SEARCH}?${params}`);

        const channels = response.data.map(author => {
            const authorUrl = `${URLS.AUTHOR_BASE}/${author.id}`;

            return new PlatformChannel({
                id: new PlatformID(PLATFORM, authorUrl, config.id),
                name: author.name || FALLBACK_AUTHOR,
                thumbnail: author.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR,
                subscribers: UNKNOWN_COUNT,
                description: author.description || '',
                url: authorUrl,
                links: buildAuthorLinks(author)
            });
        });

        return new AuthorSearchPager({
            channels,
            hasMore: offset + response.data.length < response.meta.total,
            context: {
                ...this.context,
                offset: offset + ITEMS_PER_PAGE
            }
        });
    }
}
// ====================== CORE FUNCTIONALITY ======================


/**
 * Create a search pager for finding audiobooks by specific criteria
 * @param {string} baseUrl API base URL
 * @param {string} query Search query
 * @param {Function} filterCb Optional filter callback
 * @param {Object} filters Optional filters object (language, genre)
 * @returns {SearchAudiobooksPager} Search pager
 */
function createAudiobookSearchPager(baseUrl, query, filterCb = () => true, filters = null) {
    return new SearchAudiobooksPager({
        context: {
            baseUrl,
            query,
            filterCb,
            filters,
            limit: ITEMS_PER_PAGE,
            offset: 0
        }
    }).nextPage();
}

/**
 * Get author channel details
 * @param {string} url Author URL
 * @returns {PlatformChannel} Author channel
 */
function getAuthorChannel(url) {
    const channelId = extractChannelId(url);
    const author = httpGET(URLS.API_AUTHORS_DETAILS(channelId)).data;

    if (!author?.id) {
        throw new ScriptException(`Author not found: ${channelId}`);
    }

    // Subscriptions key on the channel url, so a trailing slash or query must not create a second one
    const authorUrl = `${URLS.AUTHOR_BASE}/${author.id}`;

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, authorUrl, config.id),
        name: author.name || FALLBACK_AUTHOR,
        thumbnail: author.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR,
        subscribers: NO_SUBSCRIBERS,
        description: author.description || '',
        url: authorUrl,
        links: buildAuthorLinks(author)
    });
}
/**
 * Get reader channel details
 * @param {string} url Reader URL
 * @returns {PlatformChannel} Reader channel
 */
function getReaderChannel(url) {
    const readerId = extractReaderIdFromUrl(url);

    // Earlier releases cached a placeholder when the request failed; refetch those
    let readerInfo = state.readers[readerId];
    if (!readerInfo || readerInfo.description === FALLBACK_READER_DESCRIPTION) {
        readerInfo = fetchReaderInfo(readerId);
        state.readers[readerId] = readerInfo;
    }

    const readerUrl = `${URLS.READER_BASE}/${readerId}`;

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, readerUrl, config.id),
        name: `${readerInfo.name} (reader)`,
        thumbnail: DEFAULT_IMAGES.READER_AVATAR,
        subscribers: NO_SUBSCRIBERS,
        description: readerInfo.description,
        url: readerUrl,
        links: {
            'LibriVox': readerUrl
        }
    });
}

/**
 * Fetch reader information from the API
 * @param {string} readerId Reader ID
 * @returns {Object} Reader information; throws when the API has no such reader
 */
function fetchReaderInfo(readerId) {
    const reader = httpGET(URLS.API_READERS_DETAILS(readerId)).data;

    if (!reader?.id) {
        throw new ScriptException(`Reader not found: ${readerId}`);
    }

    let description = `LibriVox volunteer reader`;
    if (reader.display_name) {
        description = `LibriVox reader ${reader.display_name}`;
    }

    if (reader.section_count > 0) {
        description += ` who has recorded ${reader.section_count} sections`;
    }

    if (reader.audiobook_count > 0) {
        description += ` across ${reader.audiobook_count} audiobooks`;
    }

    description += '.';

    return {
        name: reader.display_name || `Reader ${readerId}`,
        catalogName: reader.display_name || `Reader ${readerId}`,
        forumName: '',
        totalSections: reader.section_count || NO_SUBSCRIBERS,
        totalMatches: reader.audiobook_count || NO_SUBSCRIBERS,
        description: description,
        bookCount: reader.audiobook_count || NO_SUBSCRIBERS
    };
}
/**
 * Get audiobooks by author
 * @param {string} url Author URL
 * @returns {AuthorAudiobooksPager} Paged author audiobooks
 */
function getAuthorAudiobooks(url) {
    const channelId = extractChannelId(url);

    if (!channelId) {
        logError('Could not extract author ID from URL');
        return new ContentPager([], false);
    }

    // Use the new AuthorAudiobooksPager to handle pagination
    return new AuthorAudiobooksPager({
        context: {
            authorId: channelId,
            page: 1
        }
    }).nextPage();
}

/**
 * Get audiobooks by reader
 * @param {string} url Reader URL
 * @returns {ReaderAudiobooksPager} Paged reader audiobooks
 */
function getReaderAudiobooks(url) {
    const readerId = extractReaderIdFromUrl(url);

    if (!readerId) {
        logError(`Invalid reader URL: ${url}`);
        return new ContentPager([], false);
    }

    // Use the new ReaderAudiobooksPager to handle pagination
    return new ReaderAudiobooksPager({
        context: {
            readerId: readerId,
            page: 1
        }
    }).nextPage();
}

/**
 * Get detailed audiobook information
 * @param {string} url Audiobook URL
 * @returns {PlatformPlaylistDetails} Audiobook details
 */
function getAudiobookDetails(url) {

    const playlistInfo = fetchAudiobookDetails(url);

    const author = new PlatformAuthorLink(
        new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
        playlistInfo.authorName,
        playlistInfo.authorUrl,
        playlistInfo.authorThumbnailUrl
    );

    // Slug URLs resolve to the numeric id so every form of a book shares one url and id
    const bookId = playlistInfo.id;
    const internalUrl = `${INTERNAL_BOOK_BASE}/${bookId}`;

    const bookCoverUrl = playlistInfo.bookCoverUrl;
    const contents = playlistInfo.chapters.map((chapter, idx) => {
        // For chapter URLs, we'll use a similar internal format with chapter parameter
        const chapterUrl = `${internalUrl}?chapter=${idx}`;

        return new PlatformVideo({
            id: new PlatformID(PLATFORM, `${bookId}_chapter_${idx}`, config.id),
            name: chapter.chapterName,
            author: author,
            url: chapterUrl,
            duration: chapter.duration,
            thumbnails: new Thumbnails([new Thumbnail(bookCoverUrl)]),
        });
    });

    return new PlatformPlaylistDetails({
        id: new PlatformID(PLATFORM, String(bookId), config.id),
        author: author,
        name: playlistInfo.title,
        videoCount: contents.length ?? 0,
        contents: new VideoPager(contents),
        url: internalUrl,
    });
}

// ====================== DATA FETCHING ======================


/**
 * Fetch audiobook details for any accepted book or chapter URL (book?id=N, book/N, librivox.org slug)
 * @param {string} url Audiobook or chapter URL
 * @returns {Object} Audiobook details, including the numeric book id from the API
 */
function fetchAudiobookDetails(url) {
    const bookKey = extractId(url) || extractSlug(url);

    if (!bookKey) {
        throw new ScriptException(`Unrecognized audiobook URL: ${url}`);
    }

    const book = httpGET(URLS.API_AUDIOBOOKS_DETAILS.replace('{audioBookId}', encodeURIComponent(bookKey))).data;

    if (!book || !Array.isArray(book.sections)) {
        throw new ScriptException('No audiobook data found in API response');
    }

    const match = book?.url_iarchive?.match(REGEX.ARCHIVE_ORG_DETAILS);

    const iarchive_id = match ? match[1] : null;
    let viewCount = UNKNOWN_COUNT;

    if (iarchive_id) {
        viewCount = fetchViewCount(iarchive_id);
    }

    // Handle multiple authors
    const authors = book?.authors || [];
    let authorName = FALLBACK_AUTHOR;
    let authorUrl = '';
    let authorThumbnailUrl = DEFAULT_IMAGES.AUTHOR_AVATAR;

    // Format primary author
    if (authors.length > 0) {
        const primaryAuthor = authors[0];
        authorName = primaryAuthor.name || FALLBACK_AUTHOR;
        authorUrl = primaryAuthor.id ? `${URLS.AUTHOR_BASE}/${primaryAuthor.id}` : '';
        authorThumbnailUrl = primaryAuthor?.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR;
    }

    // Format all authors for description
    const formattedAuthors = authors.map(author => {
        return {
            id: author.id,
            name: author.name || FALLBACK_AUTHOR,
            url: author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : ''
        };
    });

    return {
        id: book.id,
        viewCount,
        title: book.title || FALLBACK_TITLE,
        description: book.description || '',
        authorThumbnailUrl: authorThumbnailUrl,
        authorName: authorName,  // Primary author for backward compatibility
        authorUrl: authorUrl,    // Primary author URL
        authors: formattedAuthors, // All authors
        bookCoverUrl: book.coverart_thumbnail || book.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
        chapters: book.sections.map((s, idx) => formatChapterData(s, idx))
    };
}

/**
 * Fetch view count for an audiobook from Archive.org
 * @param {string} iarchive_id Archive.org ID
 * @returns {number} View count or UNKNOWN_COUNT if not available
 */
function fetchViewCount(iarchive_id) {
    try {
        const viewResBody = httpGET({
            url: `${URLS.ARCHIVE_VIEWS}/${iarchive_id}`,
            headers: REQUEST_HEADERS
        });

        if (viewResBody?.[iarchive_id]?.have_data) {
            return viewResBody[iarchive_id].all_time || UNKNOWN_COUNT;
        }
    } catch (error) {
        logError(`Error parsing view count: ${error.message}`);
    }
    return UNKNOWN_COUNT;
}


// ====================== CONVERSION FUNCTIONS ======================


/**
 * Format chapter data into a consistent structure
 * @param {Object} s Chapter data from API
 * @param {number} idx Chapter index
 * @returns {Object} Formatted chapter data
 */
function formatChapterData(s, idx) {
    // Handle multiple readers
    const readers = s.readers || [];
    const formattedReaders = readers.map(reader => ({
        name: reader.display_name || '',
        id: reader.id || reader.reader_id || '',
        url: reader.id || reader.reader_id ? `${URLS.READER_BASE}/${reader.id || reader.reader_id}` : ''
    }));

    return {
        section_id: s.id,
        chapterId: idx,
        chapterName: s.title || `Chapter ${idx + 1}`,
        chapterFile: s.listen_url || '',
        duration: parseInt(s.playtime) || 0,
        readers: formattedReaders
    };
}

/**
 * Convert audiobook data to platform playlist format
 * @param {Object} book Audiobook data
 * @returns {PlatformPlaylist} Platform playlist object
 */
function audiobookToPlaylist(book) {
    if (!book) {
        logError("Attempted to convert null or undefined book");
        return null;
    }

    const author = book?.authors?.[0] || { id: '', name: '' };
    const author_name = author.name || FALLBACK_AUTHOR;
    const author_url = author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '';
    const image_url = author.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR;
    const bookId = book.id || extractId(book?.url_librivox) || '';

    return new PlatformPlaylist({
        id: new PlatformID(
            PLATFORM,
            bookId.toString(),
            config.id,
        ),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, author_url, config.id),
            author_name,
            author_url,
            image_url
        ),
        name: book?.title || FALLBACK_TITLE,
        thumbnail: book.coverart_thumbnail || book?.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
        videoCount: book?.sections?.length || book?.num_sections || UNKNOWN_COUNT,
        url: `${INTERNAL_BOOK_BASE}/${bookId}`
    });
}

// ====================== HTTP UTILITIES ======================

/**
 * GET with retries for network errors, 408, 429 (after a delay) and 5xx.
 * Other non-OK responses and invalid JSON throw at once, with the API's error message when it sent one.
 * @param {string | Object} urlOrOptions - Either a URL string or an options object
 * @param {string} urlOrOptions.url - The URL to call (when using object form)
 * @param {boolean} [urlOrOptions.useAuthenticated=false] - If true, will use the authenticated headers
 * @param {boolean} [urlOrOptions.parseResponse=true] - If true, will parse the response as json
 * @param {number} [urlOrOptions.retries=DEFAULT_RETRIES] - Number of retry attempts
 * @param {Object} [urlOrOptions.headers=REQUEST_HEADERS_API] - Headers for the request
 * @returns {string | Object} the response body as a string or the parsed json object
 * @throws {ScriptException}
 */
function httpGET(urlOrOptions) {
    const options = typeof urlOrOptions === 'string'
        ? { url: urlOrOptions }
        : urlOrOptions;

    const {
        url,
        useAuthenticated = false,
        parseResponse = true,
        retries = DEFAULT_RETRIES,
        headers = REQUEST_HEADERS_API
    } = options;

    const requestHeaders = { ...headers };
    if (!requestHeaders['User-Agent']) {
        requestHeaders['User-Agent'] = `grayjay.app/${bridge.buildPlatform}/${bridge.buildVersion}`;
    }

    const maxAttempts = retries + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let resp;
        try {
            resp = http.GET(url, requestHeaders, useAuthenticated);
        } catch (error) {
            logError(`Request error on ${url}: ${error}`);
            lastError = error;
            continue;
        }

        if (resp.code === HTTP_TOO_MANY_REQUESTS) {
            lastError = new ScriptException(`Rate limited [${resp.code}]: ${url}`);
            if (attempt < maxAttempts) {
                bridge.sleep(RATE_LIMIT_DELAY_MS);
            }
            continue;
        }

        // Android reports a socket timeout as 408
        if (resp.code === HTTP_REQUEST_TIMEOUT || resp.code >= HTTP_SERVER_ERROR) {
            lastError = new ScriptException(`Request failed [${resp.code}]: ${url}`);
            continue;
        }

        if (!resp.isOk) {
            let detail = url;
            try {
                detail = JSON.parse(resp.body).error.message ?? url;
            } catch (error) {
                // Not the API's {error: {message}} body; keep the url as the detail
            }
            throw new ScriptException(`Request failed [${resp.code}]: ${detail}`);
        }

        if (!parseResponse) {
            return resp.body;
        }

        try {
            return JSON.parse(resp.body);
        } catch (error) {
            throw new ScriptException(`Invalid JSON response from ${url}: ${error.message}`);
        }
    }

    logError(`Request failed after ${maxAttempts} attempts: ${url}`);
    throw lastError;
}

// ====================== UTILITY FUNCTIONS ======================

/**
 * Build external links object for an author
 * @param {Object} author Author object from API
 * @returns {Object} Links object with platform URLs
 */
function buildAuthorLinks(author) {
    const links = {
        "LibriVox": `${URLS.AUTHOR_BASE}/${author.id}`
    };

    // Popular platforms (high priority)
    if (author.wikipedia_url) {
        links['Wikipedia'] = author.wikipedia_url;
    }

    if (author?.goodreads_id) {
        links['Goodreads'] = `https://www.goodreads.com/author/show/${author.goodreads_id}/`;
    }

    if (author?.imdb_id) {
        links['IMDB'] = `https://www.imdb.com/name/${author.imdb_id}/`;
    }

    if (author?.amazon_id) {
        links['Amazon'] = `https://www.amazon.com/stores/author/${author.amazon_id}/`;
    }

    // Authority files and libraries
    if (author?.lc_naf_id) {
        links['Library of Congress'] = `https://id.loc.gov/authorities/names/${author.lc_naf_id}`;
    }

    if (author.wikidata_id) {
        links['Wikidata'] = `https://www.wikidata.org/wiki/${author.wikidata_id}`;
    }

    if (author.viaf_id) {
        links['VIAF'] = `https://viaf.org/viaf/${author.viaf_id}/`;
    }

    if (author.isni_id) {
        links['ISNI'] = `https://isni.org/isni/${author.isni_id}`;
    }

    // Book platforms
    if (author?.openlibrary_id) {
        links['Open Library'] = `https://openlibrary.org/authors/${author.openlibrary_id}/`;
    }

    if (author?.project_gutenberg_id) {
        links['Project Gutenberg'] = `https://www.gutenberg.org/ebooks/author/${author.project_gutenberg_id}/`;
    }

    if (author?.bookbrainz_id) {
        links['BookBrainz'] = `https://bookbrainz.org/author/${author.bookbrainz_id}`;
    }

    if (author?.librarything_id) {
        links['LibraryThing'] = `https://www.librarything.com/author/${author.librarything_id}/`;
    }

    if (author?.storygraph_id) {
        links['StoryGraph'] = `https://app.thestorygraph.com/authors/${author.storygraph_id}`;
    }

    // Specialized platforms
    if (author?.musicbrainz_id) {
        links['MusicBrainz'] = `https://musicbrainz.org/artist/${author.musicbrainz_id}`;
    }

    // Regional libraries
    if (author?.opac_sbn_id) {
        links['Italian National Library'] = `https://opac.sbn.it/nome/${author.opac_sbn_id}`;
    }

    if (author?.gnd_id) {
        links['German National Library'] = `https://d-nb.info/gnd/${author.gnd_id}`;
    }

    // Other platforms
    if (author?.youtube_id) {
        links['YouTube'] = author.youtube_id;
    }

    return links;
}

/**
 * Extract reader ID from reader URL
 * @param {string} url Reader URL
 * @returns {string|null} Reader ID or null
 */
function extractReaderIdFromUrl(url) {
    if (!url) return null;

    const match = url.match(REGEX.READER_CHANNEL);
    return match ? match[1] : null;
}

/**
 * Extract channel ID from URL
 * @param {string} url Channel URL
 * @returns {string|null} Channel ID or null
 */
function extractChannelId(url) {
    if (!url) return null;

    const match = url.match(REGEX.AUTHOR_CHANNEL);
    // If there's a match, the ID will be in the first capture group (index 1)
    return match ? match[1] : null;
}

/**
 * Extract ID from URL query parameter
 * @param {string} url URL with ID parameter
 * @returns {string|null} ID or null
 */
function extractId(url) {
    if (!url) return null;

    const match = url.match(/[?&]id=([^&]+)/);
    return match ? match[1] : null;
}

/**
 * Convert object to URL encoded string
 * @param {Object} obj Object to convert
 * @returns {string} URL encoded string
 */
function objectToUrlEncodedString(obj) {
    if (!obj || typeof obj !== 'object') {
        return '';
    }

    const encodedParams = [];
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const encodedKey = encodeURIComponent(key);
            const encodedValue = encodeURIComponent(obj[key]);
            encodedParams.push(`${encodedKey}=${encodedValue}`);
        }
    }
    return encodedParams.join('&');
}


/**
 * Log an error message
 * @param {string} message Error message
 */
function logError(message) {
    if (IS_TESTING) {
        bridge.log(`[LibriVox Error] ${message}`);
    }
}

function loadOptionsForSetting(settingKey, filterCb = () => true, mapCb = (x) => x) {
    const all = config?.settings?.find((s) => s.variable == settingKey)
        ?.options ?? [];

    return all.filter(filterCb).map(mapCb);
}

log('LOADED');
