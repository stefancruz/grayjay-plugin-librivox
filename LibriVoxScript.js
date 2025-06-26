/**
 * LibriVox Plugin for Grayjay
 * 
 * This plugin enables browsing, searching, and listening to free public domain audiobooks
 * from LibriVox. It prioritizes latest releases and provides access to the complete catalog.
 */

// ---------------------- Constants ----------------------
const PLATFORM = 'librivox';

// API and URL Constants
const URLS = {
    BASE: 'https://librivox.org',
    AUTHOR_BASE: 'https://librivox.org/author',
    READER_BASE: 'https://librivox.org/reader',
    
    API_AUDIOBOOKS_ALL: 'https://librivox-api.openaudiobooks.org/api/feed/audiobooks?format=json&extended=1&coverart=1&sort_field=id&sort_order=desc',
    API_AUDIOBOOKS_BY_TITLE: 'https://librivox-api.openaudiobooks.org/api/feed/audiobooks/title',
    API_AUDIOBOOKS_BY_AUTHOR: 'https://librivox-api.openaudiobooks.org/api/feed/audiobooks/author',
    API_AUDIOBOOKS_DETAILS: 'https://librivox-api.openaudiobooks.org/api/feed/audiobooks/id/{audioBookId}?format=json&extended=1&coverart=1',
    API_AUTHORS: 'https://librivox-api.openaudiobooks.org/api/feed/authors?format=json',
    API_AUTHORS_SEARCH : (id) => `https://librivox-api.openaudiobooks.org/api/feed/authors/id/${id}?format=json`,

    ADVANCED_SEARCH: 'https://librivox.org/advanced_search',
    ARCHIVE_VIEWS: 'https://be-api.us.archive.org/views/v1/short',
    READER_SEARCH: 'https://librivox.org/reader/get_results'
};

// Default images
const DEFAULT_IMAGES = {
    BOOK_COVER: 'https://plugins.grayjay.app/LibriVox/assets/default-book-cover.png',
    AUTHOR_AVATAR: 'https://plugins.grayjay.app/LibriVox/LibriVoxIcon.png',
    READER_AVATAR: 'https://plugins.grayjay.app/LibriVox/LibriVoxIcon.png'
};

// Regular Expressions
const REGEX = {
    CONTENT_DETAILS: /https:\/\/librivox\.org\/[\w\-]+(?:\/[\w\-]+)*\/\?([^#&]*&)*chapter=(\d+)(?:&[^#]*)?$/,
    AUTHOR_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/author\/(\d+)(?:\?[^#\s]*)?$/,
    READER_CHANNEL: /^https?:\/\/(?:www\.)?librivox\.org\/reader\/(\d+)(?:\?[^#\s]*)?$/,
    PLAYLIST: /^https?:\/\/(?:www\.)?librivox\.org\/(?!(?:search|pages|category|reader|author|group|collections|\d{4}\/\d{2}\/\d{2})\/?)(?:[a-zA-Z0-9-]+)(?:-by-[a-zA-Z0-9-]+)?\/?(?:\?[^#\s]*)?$/,
    GROUP: /^https:\/\/librivox\.org\/group\/\d+\/?$/,
    COLLECTION: /^https:\/\/librivox\.org\/.*collection.*\/$/,
    ARCHIVE_ORG_DETAILS: /https:\/\/(?:www\.)?archive\.org\/details\/([^\/]+)/
};

// Request Headers
const REQUEST_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

const REQUEST_HEADERS_API = {
    'x-api-key':'your_secret_key_1_@7yqpRcDrDw2HRcdXJZp@MnPVaQy&QmptA~Rw4Kvp4YX%AXQYVryJKhCuP2rYRY'
};

// Plugin State
let config = {};
let state = {
    authors: [],
    readers: {}, // Cache for reader data
    latestReleaseIds: new Set() // Track the IDs of latest releases
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

    if(IS_TESTING || settings.languageOptionIndex === undefined){
        settings.languageOptionIndex = 0;
    }

    LANGUAGE_OPTIONS = loadOptionsForSetting('languageOptionIndex');

    if (saveStateStr) {
        try {
            state = JSON.parse(saveStateStr);
            
            // Ensure latestReleaseIds is a Set
            if (state.latestReleaseIds && Array.isArray(state.latestReleaseIds)) {
                state.latestReleaseIds = new Set(state.latestReleaseIds);
            } else {
                state.latestReleaseIds = new Set();
            }
            
            // Ensure readers object exists
            if (!state.readers) {
                state.readers = {};
            }
        } catch (e) {
            bridge.log('Failed to restore state: ' + e.message);
            state.latestReleaseIds = new Set();
            state.readers = {};
        }
    } else {
        state.latestReleaseIds = new Set();
        state.readers = {};
    }
};

/**
 * Save plugin state for persistence
 * @returns {string} State as JSON string
 */
source.saveState = function () {
    // Convert Set to Array for JSON serialization
    const stateToSave = {
        ...state,
        latestReleaseIds: Array.from(state.latestReleaseIds)
    };
    return JSON.stringify(stateToSave);
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
    return REGEX.PLAYLIST.test(url) || REGEX.GROUP.test(url);
};

/**
 * Search for audiobooks
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
source.search = function (query) {
    return createAudiobookSearchPager(
        'https://librivox-api.openaudiobooks.org/api/feed/audiobooks/search',
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
    let originalUrl = url;
    
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
    let playlistInfo;
    if (bookId) {
        playlistInfo = fetchAudiobookDetailsFromApi(bookId, url);
    } else {
        playlistInfo = fetchAudiobookDetailsFromHtml(url);
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
        
        // sources.push(new AudioUrlSource({
        //     name: 'audio (cached)',
        //     container: 'audio/mpeg',
        //     codec: 'mp4a.40.2',
        //     url: chapter.chapterFile,
        //     language: 'Unknown',
        //     duration
        // }));

        // const t = new URL(chapter.chapterFile);
        // const contentUrl = t.searchParams.get("contentUrl");

        sources.push(new AudioUrlSource({
            name: 'audio (archive.org)',
            container: 'audio/mpeg',
            codec: 'mp4a.40.2',
            url: chapter.chapterFile,
            language: 'Unknown',
            duration
        }));


        debugger;
    }

    debugger;

    if(chapter.section_id) {
        
        if(settings.useHLS) {
            sources.push(
                new HLSSource({
                name: 'HLS',
                url: `https://librivox-api.openaudiobooks.org/api/v2/proxy/${chapter.section_id}.m3u8`,
                duration,
                priority: true,
                language: 'Unknown',
            }))
        }

        sources.push(new AudioUrlSource({
            name: 'audio (cached v2)',
            container: 'audio/mpeg',
            codec: 'mp4a.40.2',
            url: `https://librivox-api.openaudiobooks.org/api/v2/proxy/${chapter.section_id}.mp3`,
            language: 'Unknown',
            duration,
        }));
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
        url: originalUrl, // Preserve the original URL that was passed to the function
        duration: chapter.duration,
        thumbnails: new Thumbnails([new Thumbnail(playlistInfo.bookCoverUrl)]),
        video: new UnMuxVideoSourceDescriptor([], sources),
        viewCount: playlistInfo.viewCount
    });
};

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

        let nextPageUrl = `${URLS.API_AUDIOBOOKS_ALL}&limit=${this.pageSize}&offset=${this.offset}`;

        if(languageOption && languageOption !== 'All'){
            nextPageUrl += `&language=${languageOption}`;
        }
        
        const resp = http.GET(nextPageUrl, REQUEST_HEADERS_API, false);
        
        if (resp.isOk) {
            try {
                const data = JSON.parse(resp.body);
                
                if (data.books && data.books.length > 0) {
                    // Filter out any books that are latest releases
                    const newBooks = data.books
                        .map(audiobookToPlaylist)
                        .filter(book => {
                            return book && book.id && !state.latestReleaseIds.has(book.id.value);
                        });
                    
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
            format: 'json',
            extended: 1,
            coverart: 1,
            limit: this.context.limit || 50,
            offset,
            q: this.context.query?.toLowerCase()?.trim(),
        });
        
        const url = `${this.context.baseUrl}?${queryParams}`;
        
        const res = http.GET(url, REQUEST_HEADERS_API);
        
        let responseLength = 0;
        
        if (res.isOk) {
            try {
                const books = JSON.parse(res.body)?.books ?? [];
                
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
 * Reader audiobooks pager - provides proper pagination for a reader's audiobook list
 */
class ReaderAudiobooksPager extends VideoPager {
    constructor({ videos = [], hasMore = true, context = {} } = {}) {
        super(videos, hasMore, context);
    }
    
    nextPage() {
        const currentPage = this.context.page || 1;
        const readerId = this.context.readerId;
        
        if (!readerId) {
            logError('Reader ID is required for ReaderAudiobooksPager');
            return new ReaderAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }
        
        const searchUrl = `${URLS.READER_SEARCH}?primary_key=${readerId}&search_category=reader&sub_category=&search_page=${currentPage}&search_order=catalog_date&project_type=either`;
        const resp = http.GET(searchUrl, REQUEST_HEADERS);
        
        if (!resp.isOk) {
            logError(`Failed to fetch reader books: ${resp.code}`);
            return new ReaderAudiobooksPager({
                videos: [],
                hasMore: false,
                context: this.context
            });
        }
        
        try {
            const body = JSON.parse(resp.body);
            
            if (body.status !== "SUCCESS" || !body.results) {
                return new ReaderAudiobooksPager({
                    videos: [],
                    hasMore: false,
                    context: this.context
                });
            }
            
            const results = extractBookData(body.results)
                .filter(x => !REGEX.COLLECTION.test(x.url_librivox))
                .map(audiobookToPlaylist);
                
            // Parse pagination info to determine if there are more pages
            let hasMorePages = false;
            
            if (body.pagination) {
                // Check if there's a link to a page number higher than the current page
                const pageNumbers = extractPageNumbers(body.pagination);
                hasMorePages = pageNumbers.some(num => num > currentPage);
            }
            
            return new ReaderAudiobooksPager({
                videos: results,
                hasMore: hasMorePages,
                context: { 
                    ...this.context,
                    page: currentPage + 1 
                }
            });
        } catch (error) {
            logError(`Error parsing reader books: ${error.message}`);
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
    const url = `https://librivox-api.openaudiobooks.org/api/feed/authors/search?q=${encodeURIComponent(query)}`;
    const resp = http.GET(url, REQUEST_HEADERS_API);
    
    if (!resp.isOk) {
        return new ContentPager([], false);
    }
    
    try {
        const data = JSON.parse(resp.body);
        const authors = data.authors || [];
        
        const channels = authors.map(author => {
            const authorName = `${author.first_name || ''} ${author.last_name || ''}`.trim();
            const authorUrl = `${URLS.AUTHOR_BASE}/${author.id}`;
            
            let links = {
                "LibriVox": authorUrl
            };
            
            if (author.wikipediaurl) {
                links['Wikipedia'] = author.wikipediaurl;
            }
            
            if (author?.externalids?.isni) {
                links['ISNI'] = `https://isni.org/isni/${author.externalids.isni}`;
            }
            
            if (author?.externalids?.viaf) {
                links['Viaf'] = `https://viaf.org/en/viaf/${author.externalids.viaf}/`;
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
    const res = http.GET(URLS.API_AUTHORS_SEARCH(id), REQUEST_HEADERS_API);
    
    if(res.isOk) {
        
        const [body] = JSON.parse(res.body)?.authors ?? [];
        
        if(body){
            return body;
        }
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

    const authorName = `${author.first_name || ''} ${author.last_name || ''}`.trim() || 'Unknown Author';

    let links = {
        "LibriVox" : `${URLS.AUTHOR_BASE}/${author.id}`
    };

    if(author.wikipediaurl) {
        links['Wikipedia'] = author.wikipediaurl
    }

    if(author?.externalids?.isni) {
        links['ISNI'] = `https://isni.org/isni/${author.externalids.isni}`
    }

    if(author?.externalids?.viaf) {
        links['Viaf'] = `https://viaf.org/en/viaf/${author.externalids.viaf}/`
    }

    if(author?.externalids?.openlibrary) {
        links['Open Library'] = `https://openlibrary.org/authors/${author.externalids.openlibrary}/`
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
 * Fetch reader information from the reader's profile page
 * @param {string} readerId Reader ID
 * @returns {Object} Reader information
 */
function fetchReaderInfo(readerId) {
    const url = `${URLS.READER_BASE}/${readerId}`;
    const resp = http.GET(url, REQUEST_HEADERS);
    
    if (!resp.isOk) {
        return { name: `Reader ${readerId}`, bookCount: 0 };
    }
    
    try {
        const htmlElement = domParser.parseFromString(resp.body, 'text/html');
        
        // Extract reader details from the profile page
        const nameElement = htmlElement.querySelector('.page-header-wrap h1');
        const readerName = nameElement ? nameElement.textContent.trim() : `Reader ${readerId}`;
        
        // Extract additional reader information
        const catalogNameElement = htmlElement.querySelector('.page-header-half p:nth-child(1)');
        const forumNameElement = htmlElement.querySelector('.page-header-half p:nth-child(2)');
        
        const catalogName = catalogNameElement ? 
            catalogNameElement.textContent.replace('Catalog name:', '').trim() : '';
        const forumName = forumNameElement ? 
            forumNameElement.textContent.replace('Forum name:', '').trim() : '';
        
        // Find the elements with the section and match counts
        // The page structure has two .page-header-half divs - we need to check the second one
        const infoElements = htmlElement.querySelectorAll('.page-header-half');
        let totalSections = 0;
        let totalMatches = 0;
        
        if (infoElements.length > 1) {
            const secondHalf = infoElements[1];
            const sectionElement = secondHalf.querySelector('p:nth-child(1)');
            const matchesElement = secondHalf.querySelector('p:nth-child(2)');
            
            if (sectionElement) {
                const sectionsText = sectionElement.textContent;
                const sectionsMatch = sectionsText.match(/Total sections:\s*(\d+)/);
                if (sectionsMatch && sectionsMatch[1]) {
                    totalSections = parseInt(sectionsMatch[1]);
                }
            }
            
            if (matchesElement) {
                const matchesText = matchesElement.textContent;
                const matchesMatch = matchesText.match(/Total matches:\s*(\d+)/);
                if (matchesMatch && matchesMatch[1]) {
                    totalMatches = parseInt(matchesMatch[1]);
                }
            }
        }
        
        // Create a description using the available information
        let description = '';
        if (catalogName) {
            description += `LibriVox reader known as ${catalogName}. `;
        }
        
        if (totalSections > 0) {
            description += `Has recorded ${totalSections} sections across various audiobooks. `;
        }
        
        if (totalMatches > 0) {
            description += `Has participated in ${totalMatches} complete recordings. `;
        }
        
        if (!description) {
            description = `LibriVox volunteer reader.`;
        }
        
        return {
            name: readerName,
            catalogName: catalogName || readerName,
            forumName: forumName || '',
            totalSections: totalSections,
            totalMatches: totalMatches,
            description: description,
            bookCount: totalMatches || 0
        };
    } catch (error) {
        logError(`Error parsing reader info: ${error.message}`);
        return { name: `Reader ${readerId}`, bookCount: 0 };
    }
}
/**
 * Get audiobooks by author
 * @param {string} url Author URL
 * @returns {ContentPager} Paged author audiobooks
 */
function getAuthorAudiobooks(url) {
    const channelId = extractChannelId(url);
    
    const apiUrl = `https://librivox-api.openaudiobooks.org/api/feed/authors/${channelId}/audiobooks?extended=1&coverart=1&limit=50&format=json`;
    
    try {
        const res = http.GET(apiUrl, REQUEST_HEADERS_API);
        
        if (!res.isOk) {
            logError(`Failed to fetch author audiobooks: ${res.status}`);
            return new ContentPager([], false);
        }

        const data = JSON.parse(res.body);
        const books = data.books || [];
        
        const playlists = books.map(book => {
            const author = book.authors?.[0] || { first_name: '', last_name: '', id: '' };
            const authorName = `${author.first_name || ''} ${author.last_name || ''}`.trim() || 'Unknown Author';
            const authorUrl = author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '';
            const internalUrl =  `https://grayjay.internal/librivox/book?id=${book.id}`;
            
            return new PlatformPlaylist({
                id: new PlatformID(PLATFORM, `${URLS.AUDIOBOOK_BASE}/${book.id}`, config.id),
                name: book.title,
                thumbnail: book.coverart_jpg || DEFAULT_IMAGES.AUDIOBOOK_COVER,
                author: new PlatformAuthorLink(
                    new PlatformID(PLATFORM, authorUrl, config.id),
                    authorName,
                    authorUrl,
                    author.imageurl || DEFAULT_IMAGES.AUTHOR_AVATAR
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

/**
 * Get chapter details
 * @param {string} url Chapter URL
 * @returns {PlatformVideoDetails} Chapter details
 */
function getChapterDetails(url) {
    const meta = new URL(url);
    const chapterId = meta.searchParams.get("chapter");
    const playlistInfo = getAudiobookCachedDetails(url);
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
    
    const sources = [
        new AudioUrlSource({
            name: 'audio',
            container: 'audio/mpeg',
            codec: 'mp4a.40.2',
            url: chapter.chapterFile,
            language: 'Unknown',
        }),
    ];
    
    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, url, config.id),
        name: chapter.chapterName,
        description: combinedDescription,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
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
}

/**
 * Extract page numbers from pagination HTML
 * @param {string} paginationHtml Pagination HTML string
 * @returns {Array<number>} Array of page numbers
 */
function extractPageNumbers(paginationHtml) {
    if (!paginationHtml) {
        return [];
    }
    
    try {
        const pageNumberRegex = />(\d+)</g;
        const pageNumbers = [];
        let match;
        
        while ((match = pageNumberRegex.exec(paginationHtml)) !== null) {
            if (match[1]) {
                const pageNum = parseInt(match[1], 10);
                if (!isNaN(pageNum) && !pageNumbers.includes(pageNum)) {
                    pageNumbers.push(pageNum);
                }
            }
        }
        
        return pageNumbers.sort((a, b) => a - b);
    } catch (error) {
        logError(`Error extracting page numbers: ${error.message}`);
        return [];
    }
}

// ====================== DATA FETCHING ======================


/**
 * Get cached audiobook details or fetch them if not cached
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function getAudiobookCachedDetails(url) {
    
    const audioBookId = extractId(url);
    
    if (audioBookId) {
        return fetchAudiobookDetailsFromApi(audioBookId, url);
    } else {
        return fetchAudiobookDetailsFromHtml(url);
    }
}

/**
 * Fetch audiobook details from LibriVox API
 * @param {string} audioBookId Audiobook ID
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function fetchAudiobookDetailsFromApi(audioBookId, url) {
    const apiUrl = URLS.API_AUDIOBOOKS_DETAILS.replace('{audioBookId}', audioBookId);
    const res = http.GET(apiUrl, REQUEST_HEADERS_API);
    
    if (!res.isOk) {
        throw new ScriptException(`Failed to fetch audiobook details: ${res.code}`);
    }
    
    try {
        const book = JSON.parse(res.body)?.books?.[0];
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
        
        // Format primary author (for backward compatibility)
        if (authors.length > 0) {
            const primaryAuthor = authors[0];
            
            authorName = `${primaryAuthor.first_name || ''} ${primaryAuthor.last_name || ''}`.trim() || 'Unknown Author';
            authorUrl = primaryAuthor.id ? `${URLS.AUTHOR_BASE}/${primaryAuthor.id}` : '';
            authorThumbnailUrl = primaryAuthor?.imageurl || DEFAULT_IMAGES.AUTHOR_AVATAR;
        }
        
        // Format all authors for description
        const formattedAuthors = authors.map(author => {
            return {
                id: author.id,
                name: `${author.first_name || ''} ${author.last_name || ''}`.trim() || 'Unknown Author',
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
    const viewRes = http.GET(`${URLS.ARCHIVE_VIEWS}/${iarchive_id}`,REQUEST_HEADERS);
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

/**
 * Fetch audiobook details by parsing HTML
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function fetchAudiobookDetailsFromHtml(url) {
    try {
        const resp = http.GET(url, REQUEST_HEADERS);
        if (!resp.isOk) {
            throw new ScriptException(`Failed to fetch audiobook page: ${resp.code}`);
        }
        
        const htmlElement = domParser.parseFromString(resp.body, 'text/html');
        
        // Extract elements
        const authorElements = htmlElement.querySelectorAll('.book-page-author a');
        let [coverElement] = htmlElement.querySelectorAll('.book-page-image img');
        let [chaptersTable] = htmlElement.querySelectorAll('.chapter-download tbody');
        let chaptersElements = chaptersTable ? Array.from(chaptersTable.querySelectorAll('tr')) : [];
        
        // Extract book details
        let [titleElement] = htmlElement.querySelectorAll('.content-wrap h1');
        let [descriptionElement] = htmlElement.querySelectorAll('.content-wrap .description');
        
        // Process authors
        let authors = Array.from(authorElements).map(authorElement => {
            return {
                name: authorElement?.textContent?.trim() || 'Unknown Author',
                url: authorElement?.getAttribute('href') || '',
                id: extractChannelId(authorElement?.getAttribute('href') || '')
            };
        });
        
        // If no authors found, create a default one
        if (authors.length === 0) {
            authors = [{
                name: 'Unknown Author',
                url: '',
                id: null
            }];
        }
        
        const title = titleElement?.textContent?.trim() || 'Unknown Title';
        const description = descriptionElement?.textContent?.trim() || '';
        const bookCoverUrl = coverElement?.getAttribute('src') || DEFAULT_IMAGES.BOOK_COVER;
        
        // Process chapters in one pass
        const chapters = chaptersElements.map((chapterTableRow, idx) => {
            let [chapterNameLink] = chapterTableRow.querySelectorAll('a.chapter-name');
            const chapterName = chapterNameLink?.textContent?.trim() || `Chapter ${idx+1}`;
            const chapterFile = chapterNameLink?.getAttribute('href') || '';
            const tds = chapterTableRow.querySelectorAll('td');
            const durationText = tds[tds.length - 1]?.textContent?.trim() || '0:0:0';
            
            // Handle multiple readers in the reader column
            const readerLinks = tds[2]?.querySelectorAll('a') || [];
            const readers = Array.from(readerLinks).map(readerElement => ({
                name: readerElement?.textContent?.trim() || '',
                url: readerElement?.getAttribute('href') || '',
                id: extractReaderIdFromUrl(readerElement?.getAttribute('href') || '')
            }));
            
            return {
                chapterId: idx,
                chapterName,
                chapterFile,
                duration: timeToSeconds(durationText),
                readers: readers.length > 0 ? readers : [{ name: '', url: '', id: '' }]
            };
        });
        
        // Cache and return the result
        return { 
            title, 
            description, 
            chapters, 
            authorName: authors[0].name,   // Primary author for backward compatibility
            authorUrl: authors[0].url,     // Primary author URL
            authors: authors,              // All authors
            bookCoverUrl,
            authorThumbnailUrl: DEFAULT_IMAGES.AUTHOR_AVATAR,
            viewCount: -1
        };
        
    } catch (error) {
        logError(`Error parsing HTML: ${error.message}`);
        throw new ScriptException(`Failed to parse audiobook page: ${error.message}`);
    }
}

// ====================== CONVERSION FUNCTIONS ======================

/**
 * Format author data into a consistent structure
 * @param {Object} a Author data from API
 * @returns {Object} Formatted author data
 */
function formatAuthorData(a) {
    const name = `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Unknown Author';
    const hasAge = a.dob && a.dod;
    let estimatedAge;
    
    if (hasAge) {
        const dobYear = parseInt(a.dob);
        const dodYear = parseInt(a.dod);
        estimatedAge = isNaN(dobYear) || isNaN(dodYear) ? null : dodYear - dobYear;
    }
    
    const displayName = hasAge ? `${name} (${a.dob} - ${a.dod})` : name;
    
    return {
        authorThumbnailUrl: a.image_url || DEFAULT_IMAGES.AUTHOR_AVATAR,
        description: a.description || '',
        id: a.id,
        dob: a.dob,
        dod: a.dod,
        first_name: a.first_name?.trim() || '',
        last_name: a.last_name?.trim() || '',
        url: `${URLS.AUTHOR_BASE}/${a.id}`,
        name,
        displayName,
        estimatedAge,
        displayEstimatedAge: estimatedAge ? `${estimatedAge} years old` : '',
        links: {}
    };
}

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
        chapterName: s.title || `Chapter ${idx+1}`,
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
    
    const author = book?.authors?.[0] || { first_name: '', last_name: '', id: '', author: '' };
    const combined_name = author.first_name || author.last_name ? `${author.first_name || ''} ${author.last_name || ''}`.trim() : '';
    const author_name = author?.author || combined_name || 'Unknown Author';
    const author_url = author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '';
    const imageurl = author.imageurl ? author.imageurl : DEFAULT_IMAGES.AUTHOR_AVATAR;
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
        videoCount: book?.sections?.length || -1,
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
 * Extract book data from HTML
 * @param {string} htmlString HTML string
 * @returns {Array} Array of book data objects
 */
function extractBookData(htmlString) {
    // Input validation
    if (!htmlString || typeof htmlString !== 'string') {
        throw new ScriptException('Invalid input: htmlString must be a non-empty string');
    }
    
    const doc = domParser.parseFromString(htmlString, 'text/html');
    
    // Early validation of parsed document
    let [catalogResult] = doc.querySelectorAll('li.catalog-result');
    if (!doc || !catalogResult) {
        return [];
    }
    
    return Array.from(doc.querySelectorAll('li.catalog-result')).map(book => {
        // Extract book details with better error handling
        let [titleElement] = book.querySelectorAll('h3');
        
        // Handle nested title structure
        const bookTitle = titleElement ?
            titleElement.firstChild?.text?.trim() || safeTextContent(titleElement) :
            'Unknown Title';
            
        // Get author link information
        let authorUrl = '';
        try {
            let [authorLink] = book.querySelectorAll('.book-author a');
            authorUrl = safeAttribute(authorLink, 'href') || '';
        } catch (e) {
            logError(`Error extracting author URL: ${e.message}`);
        }
        
        // Get book URL
        let [bookCoverLink] = book.querySelectorAll('a.book-cover');
        let url_librivox = safeAttribute(bookCoverLink, 'href');
        if (!url_librivox) {
            let [categoryElement] = book.querySelectorAll('a[data-sub_category]');
            url_librivox = safeAttribute(categoryElement, 'href') || '';
        }

        let [coverImageElement] = book.querySelectorAll('a.book-cover img');
        const coverImage = safeAttribute(coverImageElement, 'src');

        let [authorElement] = book.querySelectorAll('.book-author a');
        const author = safeTextContent(authorElement);

        let lifeDates;
        let [lifeDatesElement] = book.querySelectorAll('.dod-dob');  

        if(lifeDatesElement){
            lifeDates = lifeDatesElement?.text?.replace(/[()]/g, '').trim() || null;
        }

        return {
            title: bookTitle,
            url_librivox: url_librivox,
            coverImage,
            authors: [{
                id: extractChannelId(authorUrl),
                author,
                url: authorUrl,
                lifeDates
            }]
        };
    });
}

/**
 * Convert time string (hh:mm:ss) to seconds
 * @param {string} timeString Time string in hh:mm:ss format
 * @returns {number} Time in seconds
 */
function timeToSeconds(timeString) {
    if (!timeString || typeof timeString !== 'string') {
        return 0;
    }
    
    // Split the input string into hours, minutes, and seconds
    const parts = timeString.split(':').map(part => parseInt(part, 10) || 0);
    
    if (parts.length === 3) {
        // Format is hh:mm:ss
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        // Format is mm:ss
        return parts[0] * 60 + parts[1];
    } else {
        // Invalid format
        return 0;
    }
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
 * Parse JSON from URL with error handling
 * @param {string} url URL to fetch JSON from
 * @param {Object} opts Options (headers, authentication)
 * @returns {Array} [error, data]
 */
function restWebRequest(url, opts = { is_authenticated: false, headers: {} }) {
    const headers = opts.headers || {}; // Allow custom headers
    let response;

    if(!opts.is_authenticated) {
        opts.is_authenticated = false;
    }
    
    try {
        
        response = http.GET(url, headers, opts.is_authenticated);
        if (response.isOk) {
            const data = JSON.parse(response.body);
            return [null, data];
        } else {
            // Handle non-OK responses
            return [new ScriptException(`Request failed with status: ${response.code}`), null];
        }
    } catch (error) {
        // Differentiate parsing errors from others
        if (response && !response.isOk) {
            return [new ScriptException(`Request failed: ${response.code} - ${error.message}`), null];
        }
        return [error, null];
    }
}


/**
 * Safely extract text content
 * @param {Element} element DOM element
 * @returns {string|null} Text content or null
 */
function safeTextContent(element) {
    return element?.textContent?.trim() || null;
}

/**
 * Safely get attribute
 * @param {Element} element DOM element
 * @param {string} attr Attribute name
 * @returns {string|null} Attribute value or null
 */
function safeAttribute(element, attr) {
    try {
        return element?.getAttribute?.(attr) || null;
    }
    catch (e) {
        bridge.log(`[LibriVox Error] ${e.message}`);
        return null;
    }
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

/**
 * Log an info message
 * @param {string} message Info message
 */
function log(message) {
    if (IS_TESTING) {
        bridge.log(`[LibriVox] ${message}`);
    }
}

function loadOptionsForSetting(settingKey, filterCb = () => true, mapCb = (x) => x) {
    const all = config?.settings?.find((s) => s.variable == settingKey)
        ?.options ?? [];

    return all.filter(filterCb).map(mapCb);
}

log('LOADED');
