/**
 * LibriVox Plugin for Grayjay
 *
 * This plugin enables browsing, searching, and listening to free public domain audiobooks
 * from LibriVox. It prioritizes latest releases and provides access to the complete catalog.
 */

// ---------------------- Constants ----------------------
const PLATFORM = 'librivox';

const API_BASE_URL = 'https://librivox-api.openaudiobooks.org';

// API and URL Constants
const URLS = {
    BASE: 'https://librivox.org',
    AUTHOR_BASE: 'https://librivox.org/author',
    READER_BASE: 'https://librivox.org/reader',
    API_AUDIOBOOKS_FEED: `${API_BASE_URL}/api/v3/audiobooks/feed?sort_field=id&sort_order=desc`,
    API_AUDIOBOOKS_DETAILS: `${API_BASE_URL}/api/v3/audiobooks/{audioBookId}`,
    API_AUDIOBOOKS_SEARCH: `${API_BASE_URL}/api/v3/audiobooks/search`,
    API_AUTHORS_DETAILS: (id) => `${API_BASE_URL}/api/v3/authors/${id}`,
    API_AUTHORS_SEARCH: `${API_BASE_URL}/api/v3/authors/search`,
    API_AUTHORS_AUDIOBOOKS: (id) => `${API_BASE_URL}/api/v3/authors/${id}/audiobooks`,
    API_READERS_DETAILS: (id) => `${API_BASE_URL}/api/v3/readers/${id}`,
    API_READERS_SECTIONS: (id) => `${API_BASE_URL}/api/v3/readers/${id}/sections`,
    API_READERS_AUDIOBOOKS: (id) => `${API_BASE_URL}/api/v3/readers/${id}/audiobooks`,
    API_AUTOCOMPLETE: `${API_BASE_URL}/api/v3/search/autocomplete`,

    ARCHIVE_VIEWS: 'https://be-api.us.archive.org/views/v1/short',
};

// Default images
const DEFAULT_IMAGES = {
    BOOK_COVER: 'https://grayjay-plugin-librivox.pages.dev/assets/default-book-cover.png',
    AUTHOR_AVATAR: 'https://grayjay-plugin-librivox.pages.dev/LibriVoxIcon.png',
    READER_AVATAR: 'https://grayjay-plugin-librivox.pages.dev/LibriVoxIcon.png'
};

// Regular Expressions
const REGEX = {
    CONTENT_DETAILS: /https:\/\/librivox\.org\/[\w\-]+(?:\/[\w\-]+)*\/\?([^#&]*&)*chapter=(\d+)(?:&[^#]*)?$/,
    AUTHOR_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/author\/(\d+)(?:\?[^#\s]*)?$/,
    READER_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/reader\/(\d+)(?:\?[^#\s]*)?$/,
    PLAYLIST: /^https?:\/\/(?:www\.)?librivox\.org\/(?!(?:search|pages|category|reader|author|group|collections|\d{4}\/\d{2}\/\d{2})\/?)(?:[a-zA-Z0-9-]+)(?:-by-[a-zA-Z0-9-]+)?\/?(?:\?[^#\s]*)?$/,
    COLLECTION: /^https:\/\/librivox\.org\/.*collection.*\/$/,
    ARCHIVE_ORG_DETAILS: /https:\/\/(?:www\.)?archive\.org\/details\/([^\/]+)/
};

// Request Headers
const REQUEST_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

// Default request headers
const REQUEST_HEADERS_API = {};

// Plugin State
let config = {};
let state = {
    readers: {} // Cache for reader data
};

let settings = {}

let LANGUAGE_OPTIONS = [];

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

    if (IS_TESTING || settings.languageOptionIndex === undefined) {
        settings.languageOptionIndex = 0;
    }

    LANGUAGE_OPTIONS = loadOptionsForSetting('languageOptionIndex');

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
    if (IS_TESTING) {
        bridge.log(`source.isPlaylistUrl . ${url}`);
    }
    // Add check for internal URL format
    if (url.startsWith('https://grayjay.internal/librivox/book')) {
        return true;
    }
    return REGEX.PLAYLIST.test(url);
};

/**
 * Search for audiobooks
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
source.search = function (query) {
    return createAudiobookSearchPager(
        URLS.API_AUDIOBOOKS_SEARCH,
        query
    );
};

/**
 * Search for LibriVox authors
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for author search
 */
source.searchChannels = function (query) {
    return searchAuthors(query);
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
        const resp = http.GET(url, REQUEST_HEADERS_API);
        if (resp.isOk) {
            const suggestions = JSON.parse(resp.body);
            return Array.isArray(suggestions?.data) ? suggestions.data : [];
        }
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
        subscribers: 0,
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
    if (url.startsWith('https://grayjay.internal/librivox/book/') && url.includes('?chapter=')) {
        return true;
    }
    return REGEX.CONTENT_DETAILS.test(url);
};

/**
 * Get chapter details
 * @param {string} url Chapter URL
 * @returns {PlatformVideoDetails} Chapter details
 */
/**
 * Get chapter details
 * @param {string} url Chapter URL
 * @returns {PlatformVideoDetails} Chapter details
 */
source.getContentDetails = function (url) {
    let bookId, chapterId;

    // Handle internal URL format
    if (url.startsWith('https://grayjay.internal/librivox/book/')) {
        bookId = url.split('/').pop().split('?')[0];
        const urlObj = new URL(url);
        chapterId = urlObj.searchParams.get("chapter");
    } else {
        // Handle traditional URL
        const meta = new URL(url);
        chapterId = meta.searchParams.get("chapter");
        bookId = extractId(url);
    }

    // Get audiobook details
    let id;

    if (bookId) {
        id = bookId;

    } else {
        id = extractSlug(url);
    }

    let apiUrl = URLS.API_AUDIOBOOKS_DETAILS.replace('{audioBookId}', id);

    let playlistInfo = fetchAudiobookDetailsFromApi(apiUrl);

    // Validate playlistInfo has chapters
    if (!playlistInfo || !Array.isArray(playlistInfo.chapters)) {
        throw new ScriptException(`No chapters found for audiobook`);
    }

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
            codec: 'mp4a.40.2',
            url: chapter.chapterFile,
            language: 'Unknown',
            duration
        }));
    }

    if (sources.length === 0) {
        throw new ScriptException(`No audio sources found for chapter`);
    }

    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, `${bookId}_chapter_${chapterId}`, config.id),
        name: chapter.chapterName,
        description: combinedDescription,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, extractChannelId(playlistInfo.authorUrl) || '', config.id),
            playlistInfo.authorName,
            playlistInfo.authorUrl,
            playlistInfo?.authorThumbnailUrl ?? ''
        ),
        url: url,
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
        this.pageSize = 10;
        this.nextPage();
    }

    nextPage() {
        this.results = [];
        // Only load more regular books on subsequent pages
        let languageOption = LANGUAGE_OPTIONS[settings.languageOptionIndex];

        let nextPageUrl = `${URLS.API_AUDIOBOOKS_FEED}&limit=${this.pageSize}&offset=${this.offset}`;

        if (languageOption && languageOption !== 'All') {
            nextPageUrl += `&language=${languageOption}`;
        }

        const resp = http.GET(nextPageUrl, REQUEST_HEADERS_API, false);

        if (resp.isOk) {
            try {
                const response = JSON.parse(resp.body);
                const data = response.data || response;
                const books = Array.isArray(data) ? data : [];

                if (books && books.length > 0) {
                    const newBooks = books
                        .map(audiobookToPlaylist)
                        .filter(book => book?.id);

                    // Add new books to results
                    this.results = [...this.results, ...newBooks];
                    this.offset += this.pageSize;
                    this.hasMore = newBooks.length > 0;
                } else {
                    this.hasMore = false;
                }
            } catch (error) {
                logError(`Error parsing more books: ${error.message}`);
                this.hasMore = false;
            }
        } else {
            this.hasMore = false;
        }

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
        const queryParams = objectToUrlEncodedString({
            limit: this.context.limit || 50,
            offset,
            q: this.context.query?.toLowerCase()?.trim(),
        });

        const url = `${this.context.baseUrl}?${queryParams}`;

        const res = http.GET(url, REQUEST_HEADERS_API);

        let responseLength = 0;

        if (res.isOk) {
            try {
                const response = JSON.parse(res.body);
                const books = response.data || [];

                responseLength = books.length;
                searchResults = books
                    .filter(b => b.url_librivox) // audiobooks in-progress or Abandoned don't have URL
                    .filter(this.context.filterCb || (() => true))
                    .map(audiobookToPlaylist);
            } catch (error) {
                logError(`Error parsing search results: ${error.message}`);
                return new SearchAudiobooksPager({
                    videos: [],
                    hasMore: false,
                    context: this.context
                });
            }
        }

        offset += (this.context.limit || 10);
        let hasMore = responseLength === (this.context.limit || 10);

        return new SearchAudiobooksPager({
            videos: searchResults,
            hasMore,
            context: {
                ...this.context,
                offset: offset
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
        const limit = 50; // Items per page
        const offset = (currentPage - 1) * limit;

        if (!readerId) {
            logError('Reader ID is required for ReaderAudiobooksPager');
            return new ReaderAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }

        try {
            // Get audiobooks narrated by this reader using the /api/v3/readers/{id}/audiobooks endpoint
            const audiobooksUrl = `${URLS.API_READERS_AUDIOBOOKS(readerId)}?limit=${limit}&offset=${offset}`;
            const resp = http.GET(audiobooksUrl, REQUEST_HEADERS_API);

            if (!resp.isOk) {
                logError(`Failed to fetch reader audiobooks: ${resp.code}`);
                return new ReaderAudiobooksPager({
                    videos: [],
                    hasMore: false,
                    context: this.context
                });
            }

            const audiobooksResponse = JSON.parse(resp.body);

            // The /api/v3/readers/{id}/audiobooks endpoint returns audiobooks directly in the 'data' array
            const audiobooks = audiobooksResponse.data;

            if (!audiobooks || !Array.isArray(audiobooks)) {
                logError(`Invalid audiobooks response format for reader ${readerId}`);
                return new ReaderAudiobooksPager({
                    videos: [],
                    hasMore: false,
                    context: this.context
                });
            }

            // Process audiobooks directly from the /api/v3/readers/{id}/audiobooks endpoint
            const results = audiobooks
                .filter(audiobook => audiobook && audiobook.id)
                .filter(audiobook => !REGEX.COLLECTION.test(audiobook.url_librivox || ''))
                .map(audiobookToPlaylist)
                .filter(playlist => playlist !== null);

            // Determine if there are more pages
            const hasMorePages = audiobooks.length === limit;

            return new ReaderAudiobooksPager({
                videos: results,
                hasMore: hasMorePages,
                context: {
                    ...this.context,
                    page: currentPage + 1
                }
            });

        } catch (error) {
            logError(`Error fetching reader audiobooks from /api/v3/readers/${readerId}/audiobooks: ${error.message}`);
            return new ReaderAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }
    }
}
// ====================== CORE FUNCTIONALITY ======================


/**
 * Create a search pager for finding audiobooks by specific criteria
 * @param {string} baseUrl API base URL
 * @param {string} query Search query
 * @param {Function} filterCb Optional filter callback
 * @returns {SearchAudiobooksPager} Search pager
 */
function createAudiobookSearchPager(baseUrl, query, filterCb = () => true) {
    return new SearchAudiobooksPager({
        context: {
            baseUrl,
            query,
            filterCb,
            limit: 50,
            offset: 0
        }
    }).nextPage();
}

/**
 * Search for authors by name
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for author search
 */
function searchAuthors(query) {
    const url = `${URLS.API_AUTHORS_SEARCH}?q=${encodeURIComponent(query)}`;
    const resp = http.GET(url, REQUEST_HEADERS_API);

    if (!resp.isOk) {
        return new ContentPager([], false);
    }

    try {
        const response = JSON.parse(resp.body);
        const authors = response.data || [];

        const channels = authors.map(author => {
            const authorName = author.name || 'Unknown Author';
            const authorUrl = `${URLS.AUTHOR_BASE}/${author.id}`;

            let links = {
                "LibriVox": authorUrl
            };

            if (author.wikipedia_url) {
                links['Wikipedia'] = author.wikipedia_url;
            }

            if (author.wikidata_id) {
                links['Wikidata'] = `https://www.wikidata.org/wiki/${author.wikidata_id}`;
            }

            if (author.isni_id) {
                links['ISNI'] = `https://isni.org/isni/${author.isni_id}`;
            }

            if (author.viaf_id) {
                links['Viaf'] = `https://viaf.org/en/viaf/${author.viaf_id}/`;
            }

            if (author?.openlibrary_id) {
                links['Open Library'] = `https://openlibrary.org/authors/${author.openlibrary_id}/`
            }

            if (author?.project_gutenberg_id) {
                links['Project Gutenberg'] = `https://www.gutenberg.org/ebooks/author/${author.project_gutenberg_id}/`
            }

            if (author?.goodreads_id) {
                links['Goodreads'] = `https://www.goodreads.com/author/show/${author.goodreads_id}/`
            }

            if (author?.amazon_id) {
                links['Amazon'] = `https://www.amazon.com/stores/author/${author.amazon_id}/`
            }

            if (author?.librarything_id) {
                links['Librarything'] = `https://www.librarything.com/author/${author.librarything_id}/`
            }

            return new PlatformChannel({
                id: new PlatformID(PLATFORM, authorUrl, config.id),
                name: authorName,
                thumbnail: author.imageurl || DEFAULT_IMAGES.AUTHOR_AVATAR,
                subscribers: -1,
                description: author.description || '',
                url: authorUrl,
                links: links
            });
        });

        return new ContentPager(channels, false);
    } catch (error) {
        logError(`Error parsing author search results: ${error.message}`);
        return new ContentPager([], false);
    }
}

function getAuthorByID(id) {
    const res = http.GET(URLS.API_AUTHORS_DETAILS(id), REQUEST_HEADERS_API);

    if (res.isOk) {
        const response = JSON.parse(res.body);
        return response.data;
    }
}

/**
 * Get author channel details
 * @param {string} url Author URL
 * @returns {PlatformChannel} Author channel
 */
function getAuthorChannel(url) {
    const channelId = extractChannelId(url);

    const author = getAuthorByID(channelId);

    if (!author) {
        logError(`Author not found for ID: ${channelId}`);
        return new PlatformChannel({
            id: new PlatformID(PLATFORM, url, config.id),
            name: 'Unknown Author',
            thumbnail: DEFAULT_IMAGES.AUTHOR_AVATAR,
            subscribers: 0,
            description: '',
            url,
            links: {}
        });
    }

    if (!author.url) {
        author.url = `${URLS.AUTHOR_BASE}/${author.id}`;
    }

    const authorName = author.name || 'Unknown Author';

    let links = {
        "LibriVox": `${URLS.AUTHOR_BASE}/${author.id}`
    };

    if (author.wikipedia_url) {
        links['Wikipedia'] = author.wikipedia_url;
    }

    if (author.wikidata_id) {
        links['Wikidata'] = `https://www.wikidata.org/wiki/${author.wikidata_id}`;
    }

    if (author.isni_id) {
        links['ISNI'] = `https://isni.org/isni/${author.isni_id}`;
    }

    if (author.viaf_id) {
        links['Viaf'] = `https://viaf.org/en/viaf/${author.viaf_id}/`;
    }

    if (author?.openlibrary_id) {
        links['Open Library'] = `https://openlibrary.org/authors/${author.openlibrary_id}/`
    }

    if (author?.project_gutenberg_id) {
        links['Project Gutenberg'] = `https://www.gutenberg.org/ebooks/author/${author.project_gutenberg_id}/`
    }

    if (author?.goodreads_id) {
        links['Goodreads'] = `https://www.goodreads.com/author/show/${author.goodreads_id}/`
    }

    if (author?.amazon_id) {
        links['Amazon'] = `https://www.amazon.com/stores/author/${author.amazon_id}/`
    }

    if (author?.librarything_id) {
        links['Librarything'] = `https://www.librarything.com/author/${author.librarything_id}/`
    }

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, author.url, config.id),
        name: authorName,
        thumbnail: author?.imageurl || DEFAULT_IMAGES.AUTHOR_AVATAR || '',
        subscribers: 0,
        description: author?.description || '',
        url,
        links: links
    });
}
/**
 * Get reader channel details
 * @param {string} url Reader URL
 * @returns {PlatformChannel} Reader channel
 */
function getReaderChannel(url) {
    const readerId = extractReaderIdFromUrl(url);

    // Check if we've already cached this reader's info
    if (state.readers[readerId]) {
        const reader = state.readers[readerId];
        return new PlatformChannel({
            id: new PlatformID(PLATFORM, url, config.id),
            name: `${reader.name} (reader)`,
            thumbnail: DEFAULT_IMAGES.READER_AVATAR,
            subscribers: 0,
            description: reader.description || `LibriVox reader with ${reader.bookCount || 'many'} narrated books.`,
            url,
            links: {
                'LibriVox': url
            }
        });
    }

    // Fetch reader's profile to get information
    const readerInfo = fetchReaderInfo(readerId);

    // Cache the reader info for future use
    state.readers[readerId] = readerInfo;

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, url, config.id),
        name: `${readerInfo.name} (reader)`,
        thumbnail: DEFAULT_IMAGES.READER_AVATAR,
        subscribers: 0,
        description: readerInfo.description,
        url,
        links: {
            'LibriVox': url
        }
    });
}

/**
 * Fetch reader information from the API
 * @param {string} readerId Reader ID
 * @returns {Object} Reader information
 */
function fetchReaderInfo(readerId) {
    try {
        // Get reader details from /api/v3/readers/{reader id} endpoint
        const readerUrl = URLS.API_READERS_DETAILS(readerId);
        const readerResp = http.GET(readerUrl, REQUEST_HEADERS_API);

        if (readerResp.isOk) {
            const readerResponse = JSON.parse(readerResp.body);

            // The /api/v3/readers/{id} endpoint returns the reader data directly in the 'data' field
            const reader = readerResponse.data;

            if (reader) {
                // Create a description using the available information
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
                    totalSections: reader.section_count || 0,
                    totalMatches: reader.audiobook_count || 0,
                    description: description,
                    bookCount: reader.audiobook_count || 0
                };
            }
        } else {
            logError(`Failed to fetch reader info: HTTP ${readerResp.code} for reader ${readerId}`);
        }

        // Ultimate fallback
        return {
            name: `Reader ${readerId}`,
            catalogName: `Reader ${readerId}`,
            forumName: '',
            totalSections: 0,
            totalMatches: 0,
            description: 'LibriVox volunteer reader.',
            bookCount: 0
        };

    } catch (error) {
        logError(`Error fetching reader info from API: ${error.message}`);
        return {
            name: `Reader ${readerId}`,
            catalogName: `Reader ${readerId}`,
            forumName: '',
            totalSections: 0,
            totalMatches: 0,
            description: 'LibriVox volunteer reader.',
            bookCount: 0
        };
    }
}
/**
 * Get audiobooks by author
 * @param {string} url Author URL
 * @returns {ContentPager} Paged author audiobooks
 */
function getAuthorAudiobooks(url) {
    const channelId = extractChannelId(url);

    const apiUrl = `${URLS.API_AUTHORS_AUDIOBOOKS(channelId)}?limit=50`;

    try {
        const res = http.GET(apiUrl, REQUEST_HEADERS_API);

        if (!res.isOk) {
            logError(`Failed to fetch author audiobooks: ${res.status}`);
            return new ContentPager([], false);
        }

        const response = JSON.parse(res.body);
        const books = response.data || [];

        // Sort books by ID in descending order (most recent first)
        books.sort((a, b) => (b.id || 0) - (a.id || 0));

        const playlists = books.map(book => {
            const author = book.authors?.[0] || { id: '', name: '' };
            const authorName = author.name || 'Unknown Author';
            const authorUrl = author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '';
            const internalUrl = `https://grayjay.internal/librivox/book?id=${book.id}`;

            return new PlatformPlaylist({
                id: new PlatformID(PLATFORM, book.id.toString(), config.id),
                name: book.title,
                thumbnail: book.coverart_jpg || book.coverart_thumbnail || DEFAULT_IMAGES.BOOK_COVER,
                author: new PlatformAuthorLink(
                    new PlatformID(PLATFORM, authorUrl, config.id),
                    authorName,
                    authorUrl,
                    author.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR
                ),
                url: internalUrl,
                duration: book.totaltimesecs,
                description: book.description || ''
            });
        });

        return new ContentPager(playlists, false);

    } catch (error) {

        logError(`Error parsing author audiobooks: ${error.message}`);
        return new ContentPager([], false);
    }
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

    const playlistInfo = getAudiobookCachedDetails(url);

    const author = new PlatformAuthorLink(
        new PlatformID(PLATFORM, extractChannelId(playlistInfo.authorUrl) || '', config.id),
        playlistInfo.authorName,
        playlistInfo.authorUrl,
        playlistInfo?.authorThumbnailUrl ?? ''
    );



    // Extract the book ID from the URL or use a consistent identifier
    const bookId = extractId(url) || url.split('/').pop();
    const internalUrl = `https://grayjay.internal/librivox/book/${bookId}`;

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
        id: new PlatformID(PLATFORM, internalUrl, config.id),
        author: author,
        name: playlistInfo.title,
        videoCount: contents.length ?? 0,
        contents: new VideoPager(contents),
        url: internalUrl,
    });
}

// ====================== DATA FETCHING ======================


/**
 * Get cached audiobook details or fetch them if not cached
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function getAudiobookCachedDetails(url) {

    const audioBookId = extractId(url);
    let id;

    if (audioBookId) {
        id = audioBookId;
    } else {
        id = extractSlug(url);
    }

    let apiUrl = URLS.API_AUDIOBOOKS_DETAILS.replace('{audioBookId}', id);

    return fetchAudiobookDetailsFromApi(apiUrl);
}

/**
 * Fetch audiobook details from LibriVox API
 * @param {string} audioBookId Audiobook ID
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function fetchAudiobookDetailsFromApi(apiUrl) {

    const res = http.GET(apiUrl, REQUEST_HEADERS_API);

    if (!res.isOk) {
        throw new ScriptException(`Failed to fetch audiobook details: ${res.code}`);
    }

    try {
        const response = JSON.parse(res.body);
        const book = response.data;

        if (!book) {
            throw new ScriptException("No book data found in API response");
        }

        const match = book?.url_iarchive?.match(REGEX.ARCHIVE_ORG_DETAILS);

        const iarchive_id = match ? match[1] : null;
        let viewCount = -1;

        if (iarchive_id) {
            viewCount = fetchViewCount(iarchive_id);
        }

        // Handle multiple authors
        const authors = book?.authors || [];
        let authorName = 'Unknown Author';
        let authorUrl = '';
        let authorThumbnailUrl = DEFAULT_IMAGES.AUTHOR_AVATAR;

        // Format primary author
        if (authors.length > 0) {
            const primaryAuthor = authors[0];
            authorName = primaryAuthor.name || 'Unknown Author';
            authorUrl = primaryAuthor.id ? `${URLS.AUTHOR_BASE}/${primaryAuthor.id}` : '';
            authorThumbnailUrl = primaryAuthor?.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR;
        }

        // Format all authors for description
        const formattedAuthors = authors.map(author => {
            return {
                id: author.id,
                name: author.name || 'Unknown Author',
                url: author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : ''
            };
        });

        return {
            viewCount,
            title: book.title || 'Unknown Title',
            description: book.description || '',
            authorThumbnailUrl: authorThumbnailUrl,
            authorName: authorName,  // Primary author for backward compatibility
            authorUrl: authorUrl,    // Primary author URL
            authors: formattedAuthors, // All authors
            bookCoverUrl: book.coverart_thumbnail || book.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
            chapters: book.sections.map((s, idx) => formatChapterData(s, idx))
        };
    } catch (error) {
        logError(`Error parsing API response: ${error.message}`);
        throw new ScriptException(`Failed to parse audiobook details: ${error.message}`);
    }
}

/**
 * Fetch view count for an audiobook from Archive.org
 * @param {string} iarchive_id Archive.org ID
 * @returns {number} View count or -1 if not available
 */
function fetchViewCount(iarchive_id) {
    const viewRes = http.GET(`${URLS.ARCHIVE_VIEWS}/${iarchive_id}`, REQUEST_HEADERS);
    if (viewRes.isOk) {
        try {
            const viewResBody = JSON.parse(viewRes.body);
            if (viewResBody?.[iarchive_id]?.have_data) {
                return viewResBody[iarchive_id].all_time || -1;
            }
        } catch (error) {
            logError(`Error parsing view count: ${error.message}`);
        }
    }
    return -1;
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
    const author_name = author.name || 'Unknown Author';
    const author_url = author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '';
    const imageurl = author.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR;
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
            imageurl
        ),
        name: book?.title || 'Unknown Title',
        thumbnail: book.coverart_thumbnail || book?.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
        videoCount: book?.sections?.length || book?.num_sections || -1,
        url: `https://grayjay.internal/librivox/book?id=${bookId}`
    });
}

// ====================== UTILITY FUNCTIONS ======================

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
