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
    API_LATEST_RELEASES: 'https://librivox.org/api/feed/latest_releases?format=json&extended=1&coverart=1',
    API_AUDIOBOOKS_ALL: 'https://librivox.org/api/feed/audiobooks?format=json&extended=1',
    API_AUDIOBOOKS_BY_TITLE: 'https://librivox.org/api/feed/audiobooks/title',
    API_AUDIOBOOKS_BY_AUTHOR: 'https://librivox.org/api/feed/audiobooks/author',
    API_AUDIOBOOKS_DETAILS: 'https://librivox.org/api/feed/audiobooks/id/{audioBookId}?format=json&extended=1&coverart=1',
    API_AUTHORS: 'https://librivox.org/api/feed/authors?format=json',
    ADVANCED_SEARCH: 'https://librivox.org/advanced_search',
    ARCHIVE_VIEWS: 'https://be-api.us.archive.org/views/v1/short'
};

// Default images
const DEFAULT_IMAGES = {
    BOOK_COVER: 'https://plugins.grayjay.app/LibriVox/assets/default-book-cover.png',
    AUTHOR_AVATAR: 'https://plugins.grayjay.app/LibriVox/LibriVoxIcon.png'
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
const REQUEST_HEADERS = {};

// Plugin State
let config = {};
let state = {
    audiobookDetails: {},
    authors: [],
    latestReleaseIds: new Set() // Track the IDs of latest releases
};

// ====================== PLUGIN ENTRY POINTS ======================

/**
 * Initialize the plugin with configuration
 * @param {Object} conf Configuration object
 * @param {Object} settings User settings
 * @param {string} saveStateStr Previously saved state
 */
source.enable = function (conf, settings, saveStateStr) {
    config = conf;
    if (saveStateStr) {
        try {
            state = JSON.parse(saveStateStr);
            
            // Ensure latestReleaseIds is a Set
            if (state.latestReleaseIds && Array.isArray(state.latestReleaseIds)) {
                state.latestReleaseIds = new Set(state.latestReleaseIds);
            } else {
                state.latestReleaseIds = new Set();
            }
        } catch (e) {
            bridge.log('Failed to restore state: ' + e.message);
            state.latestReleaseIds = new Set();
        }
    } else {
        loadAuthorsData();
        state.latestReleaseIds = new Set();
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
    return REGEX.PLAYLIST.test(url) || REGEX.GROUP.test(url);
};

/**
 * Search for audiobooks
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
source.search = function (query) {
    return searchAudiobooks(query);
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
 * Check if URL is an author channel
 * @param {string} url URL to check
 * @returns {boolean} True if URL is an author channel
 */
source.isChannelUrl = function (url) {
    return REGEX.AUTHOR_CHANNEL.test(url);
};

/**
 * Get author channel information
 * @param {string} url Author URL
 * @returns {PlatformChannel} Channel information
 */
source.getChannel = function (url) {
    return getAuthorChannel(url);
};

/**
 * Get audiobooks by an author
 * @param {string} url Author URL
 * @returns {ContentPager} Paged results for author's audiobooks
 */
source.getChannelContents = function (url) {
    return getAuthorAudiobooks(url);
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
    return REGEX.CONTENT_DETAILS.test(url);
};

/**
 * Get chapter details
 * @param {string} url Chapter URL
 * @returns {PlatformVideoDetails} Chapter details
 */
source.getContentDetails = function (url) {
    return getChapterDetails(url);
};

// ====================== CUSTOM PAGER IMPLEMENTATIONS ======================

/**
 * Custom home content pager with latest releases first
 */
class HomeContentPager extends ContentPager {
    constructor() {
        super([], true, { offset: 0 });
        this.latestLoaded = false;
        this.offset = 0;
        this.pageSize = 50;
    }
    
    nextPage() {
        if (!this.latestLoaded) {
            // First load: get latest releases and initial regular books
            return this.loadInitialPage();
        } else {
            // Subsequent loads: just get more regular books
            return this.loadMoreBooks();
        }
    }
    
    loadInitialPage() {
        // Step 1: Load latest releases
        const latestResp = http.GET(URLS.API_LATEST_RELEASES, {}, false);
        let latestBooks = [];
        
        if (latestResp.isOk) {
            try {
                const latestData = JSON.parse(latestResp.body);
                // Process latest books and store their IDs
                latestBooks = latestData.map(book => {
                    const platformPlaylist = audiobookToPlaylist(book);
                    
                    // Add ID to the set of latest releases
                    if (platformPlaylist && platformPlaylist.id && platformPlaylist.id.value) {
                        state.latestReleaseIds.add(platformPlaylist.id.value);
                    }
                    
                    // Prefix title with "New: " to visually distinguish latest releases
                    if (platformPlaylist) {
                        platformPlaylist.name = `New: ${platformPlaylist.name}`;
                    }
                    
                    return platformPlaylist;
                }).filter(Boolean); // Remove null entries
            } catch (error) {
                logError(`Error parsing latest releases: ${error.message}`);
            }
        }
        
        // Step 2: Load regular books (first page)
        const otherBooksUrl = `${URLS.API_AUDIOBOOKS_ALL}&limit=${this.pageSize}&offset=0`;
        const otherResp = http.GET(otherBooksUrl, {}, false);
        let regularBooks = [];
        
        if (otherResp.isOk) {
            try {
                const otherData = JSON.parse(otherResp.body);
                
                regularBooks = otherData.books
                    .map(audiobookToPlaylist)
                    .filter(book => {
                        // Only include books that are not in latest releases
                        return book && book.id && !state.latestReleaseIds.has(book.id.value);
                    });
            } catch (error) {
                logError(`Error parsing regular books: ${error.message}`);
            }
        }
        
        // Combine both lists (latest first)
        this.results = [...latestBooks, ...regularBooks];
        this.latestLoaded = true;
        this.offset = this.pageSize;
        this.hasMore = regularBooks.length > 0;
        
        return this;
    }
    
    loadMoreBooks() {

        this.results = [];

        // Only load more regular books on subsequent pages
        const nextPageUrl = `${URLS.API_AUDIOBOOKS_ALL}&limit=${this.pageSize}&offset=${this.offset}`;
        const resp = http.GET(nextPageUrl, {}, false);
        
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
            offset
        });
        
        const url = `${this.context.baseUrl}/${encodeURIComponent(`^${this.context.query?.trim()}`)}?${queryParams}`;
        const res = http.GET(url, {});
        
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
        
        offset += (this.context.limit || 50);
        let hasMore = responseLength === (this.context.limit || 50);
        
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

// ====================== CORE FUNCTIONALITY ======================

/**
 * Search for audiobooks using the advanced search API
 * @param {string} query Search query
 * @returns {ContentPager} Paged search results
 */
function searchAudiobooks(query) {
    const url = `${URLS.ADVANCED_SEARCH}?title=${encodeURIComponent(query)}&author=&reader=&keywords=&genre_id=0&status=complete&project_type=either&recorded_language=&sort_order=catalog_date&search_page=1&search_form=advanced&q=`;
    const resp = http.GET(url, { 'X-Requested-With': 'XMLHttpRequest' });
    
    if (!resp.isOk) {
        logError(`Search request failed with status: ${resp.code}`);
        return new ContentPager([], false);
    }
    
    try {
        const body = JSON.parse(resp.body);
        const results = extractBookData(body.results)
            .filter(x => !REGEX.COLLECTION.test(x.url_librivox))
            .map(audiobookToPlaylist);
            
        return new ContentPager(results, false);
    } catch (error) {
        logError(`Search failed: ${error.message}`);
        return new ContentPager([], false);
    }
}

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
    const results = searchByName(state.authors, query);
    const channels = results.map(r => {
        return new PlatformChannel({
            id: new PlatformID(PLATFORM, r.url, config.id),
            name: r.name,
            thumbnail: r?.authorThumbnailUrl ?? '',
            subscribers: -1,
            url: r.url,
            links: r.links,
        });
    });
    
    return new ContentPager(channels, false);
}

/**
 * Get author channel details
 * @param {string} url Author URL
 * @returns {PlatformChannel} Author channel
 */
function getAuthorChannel(url) {
    const channelId = extractChannelId(url);
    const author = state.authors.find(a => a.id == channelId);
    
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
    
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, author.url, config.id),
        name: author.name,
        thumbnail: author?.authorThumbnailUrl ?? '',
        subscribers: 0,
        description: author?.description || '',
        url,
        links: {}
    });
}

/**
 * Get audiobooks by author
 * @param {string} url Author URL
 * @returns {SearchAudiobooksPager} Paged author audiobooks
 */
function getAuthorAudiobooks(url) {
    const channelId = extractChannelId(url);
    const author = state.authors.find(a => a.id == channelId);
    
    if (!author) {
        logError(`Author not found for ID: ${channelId}`);
        return new ContentPager([], false);
    }
    
    const searchQuery = author.last_name;
    return createAudiobookSearchPager(
        URLS.API_AUDIOBOOKS_BY_AUTHOR, 
        searchQuery, 
        audiobook => audiobook.authors.some(a => a.id == author.id)
    );
}

/**
 * Get detailed audiobook information
 * @param {string} url Audiobook URL
 * @returns {PlatformPlaylistDetails} Audiobook details
 */
function getAudiobookDetails(url) {
    const playlistInfo = getAudiobookCachedDetails(url);
    
    const author = new PlatformAuthorLink(
        new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
        playlistInfo.authorName,
        playlistInfo.authorUrl,
        playlistInfo?.authorThumbnailUrl ?? ''
    );
    
    const bookCoverUrl = playlistInfo.bookCoverUrl;
    const contents = playlistInfo.chapters.map((chapter, idx) => {
        const playlistUrlObj = new URL(url);
        playlistUrlObj.searchParams.append('chapter', idx);
        const playlistUrl = playlistUrlObj.toString();
        
        return new PlatformVideo({
            id: new PlatformID(PLATFORM, url, config.id),
            name: chapter.chapterName,
            author: author,
            url: playlistUrl,
            duration: chapter.duration,
            thumbnails: new Thumbnails([new Thumbnail(bookCoverUrl)]),
        });
    });
    
    return new PlatformPlaylistDetails({
        id: new PlatformID(PLATFORM, url, config.id),
        author: author,
        name: playlistInfo.title,
        videoCount: contents.length ?? 0,
        contents: new VideoPager(contents),
        url: url,
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
        description: playlistInfo.description,
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

// ====================== DATA FETCHING ======================

/**
 * Loads author data from LibriVox API
 */
function loadAuthorsData() {
    const [err, data] = restWebRequest(URLS.API_AUTHORS);
    if (!err) {
        state.authors = data.authors.map(formatAuthorData);
    } else {
        logError(`Failed to load authors data: ${err.message}`);
    }
}

/**
 * Get cached audiobook details or fetch them if not cached
 * @param {string} url Audiobook URL
 * @returns {Object} Audiobook details
 */
function getAudiobookCachedDetails(url) {
    // Check the cache first
    if (state.audiobookDetails[url]) {
        return state.audiobookDetails[url];
    }
    
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
    const res = http.GET(apiUrl, {});
    
    if (!res.isOk) {
        throw new ScriptException(`Failed to fetch audiobook details: ${res.code}`);
    }
    
    try {
        const book = JSON.parse(res.body)?.books?.[0];
        if (!book) {
            throw new ScriptException("No book data found in API response");
        }
        
        const match = book.url_iarchive.match(REGEX.ARCHIVE_ORG_DETAILS);
        const iarchive_id = match ? match[1] : null;
        let viewCount = -1;
        
        if (iarchive_id) {
            viewCount = fetchViewCount(iarchive_id);
        }
        
        const author = book?.authors?.[0] ?? { first_name: '', last_name: '', id: '', author: '' };
        const channel = state.authors.find(a => a.id == author.id);
        
        // Prepare author data with fallbacks
        const authorName = channel?.name || `${author.first_name || ''} ${author.last_name || ''}`.trim() || 'Unknown Author';
        const authorUrl = channel?.url || (author.id ? `${URLS.AUTHOR_BASE}/${author.id}` : '');
        const authorThumbnailUrl = channel?.authorThumbnailUrl || DEFAULT_IMAGES.AUTHOR_AVATAR;
        
        state.audiobookDetails[url] = {
            viewCount,
            title: book.title || 'Unknown Title',
            description: book.description || '',
            authorThumbnailUrl: authorThumbnailUrl,
            authorName: authorName,
            authorUrl: authorUrl,
            bookCoverUrl: book.coverart_thumbnail || book.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
            chapters: book.sections.map((s, idx) => formatChapterData(s, idx))
        };
        
        return state.audiobookDetails[url];
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
    const viewRes = http.GET(`${URLS.ARCHIVE_VIEWS}/${iarchive_id}`, {});
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
        const resp = http.GET(url, {});
        if (!resp.isOk) {
            throw new ScriptException(`Failed to fetch audiobook page: ${resp.code}`);
        }
        
        const htmlElement = domParser.parseFromString(resp.body, 'text/html');
        
        // Extract elements
        let [authorElement] = htmlElement.querySelectorAll('.book-page-author a');
        let [coverElement] = htmlElement.querySelectorAll('.book-page-image img');
        let [chaptersTable] = htmlElement.querySelectorAll('.chapter-download tbody');
        let chaptersElements = chaptersTable ? Array.from(chaptersTable.querySelectorAll('tr')) : [];
        
        // Extract book details
        let [titleElement] = htmlElement.querySelectorAll('.content-wrap h1');
        let [descriptionElement] = htmlElement.querySelectorAll('.content-wrap .description');
        
        const title = titleElement?.textContent?.trim() || 'Unknown Title';
        const description = descriptionElement?.textContent?.trim() || '';
        const authorName = authorElement?.textContent?.trim() || 'Unknown Author';
        const authorUrl = authorElement?.getAttribute('href') || '';
        const bookCoverUrl = coverElement?.getAttribute('src') || DEFAULT_IMAGES.BOOK_COVER;
        
        // Process chapters in one pass
        const chapters = chaptersElements.map((chapterTableRow, idx) => {
            let [chapterNameLink] = chapterTableRow.querySelectorAll('a.chapter-name');
            const chapterName = chapterNameLink?.textContent?.trim() || `Chapter ${idx+1}`;
            const chapterFile = chapterNameLink?.getAttribute('href') || '';
            const tds = chapterTableRow.querySelectorAll('td');
            const durationText = tds[tds.length - 1]?.textContent?.trim() || '0:0:0';
            let [readerElement] = tds[2]?.querySelectorAll('a') || [];
            const readerName = readerElement?.textContent?.trim() || '';
            const readerUrl = readerElement?.getAttribute('href') || '';
            
            return {
                chapterId: idx,
                chapterName,
                chapterFile,
                duration: timeToSeconds(durationText),
                readerName,
                readerUrl
            };
        });
        
        // Cache and return the result
        state.audiobookDetails[url] = { 
            title, 
            description, 
            chapters, 
            authorName, 
            authorUrl, 
            bookCoverUrl,
            authorThumbnailUrl: DEFAULT_IMAGES.AUTHOR_AVATAR,
            viewCount: -1
        };
        
        return state.audiobookDetails[url];
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
    const reader = s.readers?.[0] || { display_name: '', id: '' };
    return {
        chapterId: idx,
        chapterName: s.title || `Chapter ${idx+1}`,
        chapterFile: s.listen_url || '',
        duration: parseInt(s.playtime) || 0,
        readerName: reader.display_name || '',
        readerUrl: reader.id ? `${URLS.READER_BASE}/${reader.id}` : ''
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
    
    return new PlatformPlaylist({
        id: new PlatformID(
            PLATFORM,
            book?.url_librivox || '',
            config.id,
        ),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, author_url, config.id),
            author_name,
            author_url,
            DEFAULT_IMAGES.AUTHOR_AVATAR
        ),
        name: book?.title || 'Unknown Title',
        thumbnail: book.coverart_thumbnail || book?.coverart_jpg || DEFAULT_IMAGES.BOOK_COVER,
        videoCount: book?.sections?.length || -1,
        url: book.id ? `${book?.url_librivox}?id=${book.id}` : book?.url_librivox,
    });
}

// ====================== UTILITY FUNCTIONS ======================

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
 * Search for authors by name
 * @param {Array} array Array of authors
 * @param {string} query Search query
 * @returns {Array} Filtered array of matching authors
 */
function searchByName(array, query) {
    if (!array || !Array.isArray(array) || !query) {
        return [];
    }
    
    // Normalize the query by trimming and converting to lowercase
    const normalizedQuery = query.trim().toLowerCase();
    
    // Filter the array based on partial name match
    return array.filter((item) => {
        if (!item) return false;
        
        const normalizedDisplayNameName = (item.displayName || '').trim().toLowerCase();
        const normalizedDisplayAgeName = (item.displayEstimatedAge || '').trim().toLowerCase();
        return normalizedDisplayNameName.includes(normalizedQuery) || normalizedDisplayAgeName.includes(normalizedQuery);
    });
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

log('LOADED');
