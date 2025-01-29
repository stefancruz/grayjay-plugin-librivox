const PLATFORM = 'librivox'

const REGEX_CONTENT_DETAILS = /https:\/\/librivox\.org\/[\w\-]+(?:\/[\w\-]+)*\/\?([^#&]*&)*chapter=(\d+)(?:&[^#]*)?$/;
const REGEX_CHANNEL = /^https:\/\/librivox\.org\/(author|reader)\/(\d+)$/;
const REGEX_PLAYLIST = /^https:\/\/librivox\.org\/[a-z0-9-]+-by-[a-z0-9-]+\/(\?.*)?$/;
const REGEX_GROUP = /^https:\/\/librivox\.org\/group\/\d+\/?$/
const REGEX_COLLECTION = /^https:\/\/librivox\.org\/.*collection.*\/$/


let DEFAULT_COVER_BOOK_URL = '';

const URL_BASE_AUTHOR = 'https://librivox.org/author';
const URL_BASE_READER = 'https://librivox.org/reader';
const URL_API_ALL_AUTHORS = 'https://librivox.org/api/feed/authors?format=json';
const URL_API_AUDIOBOOKS_LATEST_RELEASES = 'https://librivox.org/api/feed/latest_releases?format=json&extended=1&coverart=1';
const URL_API_AUDIOBOOKS_SEARCH_BY_TITLE = 'https://librivox.org/api/feed/audiobooks/title';
const URL_API_AUDIOBOOKS_SEARCH_BY_AUTHOR = 'https://librivox.org/api/feed/audiobooks/author';
const URL_API_AUDIOBOOKS_DETAILS_PLACEHOLDER = 'https://librivox.org/api/feed/audiobooks/id/{audioBookId}?format=json&extended=1&coverart=1'

let config = {};

let state = {
    audiobookDetails: {},
    authors: []
};

source.enable = function (conf, settings, saveStateStr) {

    config = conf;

    if(IS_TESTING) {
        plugin.config.sourceUrl = 'http://100.81.58.19:3000/LibrivoxConfig.json'
    }

    const pluginOrigin = new URL(plugin.config.sourceUrl)?.origin
    DEFAULT_COVER_BOOK_URL = `${pluginOrigin}/assets/default-book-cover.png`

    if (saveStateStr) {
        try {
            state = JSON.parse(saveStateStr);
        } catch (e) {
            log(e);
            bridge.log('Failed to restore state');
        }
    } else {

        const [err, data] = parseJsonUrl(URL_API_ALL_AUTHORS);

        if (!err) {
            state.authors = data.authors.map(a => {

                const name = `${a.first_name} ${a.last_name}`.trim();

                const hasAge = a.dob && a.dod;

                let estimatedAge;
                if (hasAge) {
                    const dobYear = parseInt(a.dob);
                    const dodYear = parseInt(a.dod);

                    estimatedAge = dodYear - dobYear;
                }

                const displayName = hasAge ? `${name} (${a.dob} - ${a.dod})` : name;

                return {
                    id: a.id,
                    dob: a.dob,
                    dod: a.dod,
                    first_name: a.first_name?.trim(),
                    last_name: a.last_name?.trim(),
                    url: `${URL_BASE_AUTHOR}/${a.id}`,
                    name,
                    displayName,
                    estimatedAge,
                    displayEstimatedAge: estimatedAge ? `${estimatedAge} years old` : ''
                }
            })
        }
    }
}

source.saveState = function () {
    return JSON.stringify(state);
}

source.getHome = function () {


    let results = [];

    try {
        const res = http.GET(URL_API_AUDIOBOOKS_LATEST_RELEASES, {});

        if (res.isOk) {

            const body = JSON.parse(res.body);
debugger;
            results = body.map(audiobookToPlaylist);
        }
    } catch (e) {
        bridge.log(e)
    }

    return new ContentPager(results);
}


source.isPlaylistUrl = (url) => {
    return REGEX_PLAYLIST.test(url) || REGEX_GROUP.test(url);
};


source.search = function (query) {
    // return doSearchAudioBookPager(URL_API_AUDIOBOOKS_SEARCH_BY_TITLE, query);
    const url = `https://librivox.org/advanced_search?title=${query}&author=&reader=&keywords=&genre_id=0&status=complete&project_type=either&recorded_language=&sort_order=catalog_date&search_page=1&search_form=advanced&q=`
    const resp = http.GET(url, { 'X-Requested-With': 'XMLHttpRequest' });

    const body = JSON.parse(resp.body);
debugger;
    const results = extractBookData(body.results)
    .filter(x => {
        debugger;
        return !REGEX_COLLECTION.test(x.url_librivox)
    })
    .map(audiobookToPlaylist);

    return new ContentPager(results);

}

function doSearchAudioBookPager(baseUrl, query, filterCb = () => true) {

    const limit = 50;

    const searchQuery = encodeURIComponent(`^${query?.trim()}`);

    class SearchPager extends VideoPager {
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
                limit,
                offset
            })

            const res = http.GET(`${baseUrl}/${searchQuery}?${queryParams}`, {});

            let responseLength = 0;

            if (res.isOk) {

                const books = JSON.parse(res.body)?.books ?? [];
                responseLength = books.length;

                searchResults = books
                    .filter(b => b.url_librivox) //audiobooks in-progress or Abandoned don't url
                    .filter(filterCb).map(audiobookToPlaylist)
            }

            offset += limit;

            let hasMore = responseLength === limit;

            return new SearchPager({
                videos: searchResults,
                hasMore,
                context: { offset: offset },
            });
        }
    }

    return new SearchPager().nextPage();
}

source.searchChannels = function (query) {


    const results = searchByName(state.authors, query);

    const channels = results.map(r => {

        return new PlatformChannel({
            id: new PlatformID(PLATFORM, r.url, config.id),
            name: r.name,
            thumbnail: '',
            // banner,
            subscribers: 0,
            // description: scu.description,
            url: r.url,
            links: {},
        });

    })

    return new ContentPager(channels, false);


}

source.getPlaylist = function (url) {
    
    const playlistInfo = getAudioBookCachedDetails(url);

    const author = new PlatformAuthorLink(
        new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
        playlistInfo.authorName,
        playlistInfo.authorUrl,
    );

    const bookCoverUrl = playlistInfo.bookCoverUrl;

    const contents = playlistInfo.chapters.map((chapter, idx) => {

        const playlistUrlObj = new URL(url);
        playlistUrlObj.searchParams.append('chapter', idx);
        const playlistUrl = playlistUrlObj.toString();

        return new PlatformVideo({
            id: new PlatformID(
                PLATFORM,
                url,
                config.id,
            ),
            name: chapter.chapterName,
            author: author,
            url: playlistUrl,
            duration: chapter.duration,
            thumbnails: new Thumbnails([new Thumbnail(bookCoverUrl)]),
        });
    })

    const playlistDetails = new PlatformPlaylistDetails({
        id: new PlatformID(
            PLATFORM,
            url,
            config.id
        ),
        author: author,
        name: playlistInfo.title,
        videoCount: contents.length ?? 0,
        contents: new VideoPager(contents),
        url: url,
    });


    return playlistDetails;
}

source.isContentDetailsUrl = function (url) {
    return REGEX_CONTENT_DETAILS.test(url);
}

source.getContentDetails = function (url) {

    const meta = new URL(url);

    const chapterId = meta.searchParams.get("chapter");

    const playlistInfo = getAudioBookCachedDetails(url);

    const chapter = playlistInfo.chapters.find(c => c.chapterId == chapterId);

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
        id: new PlatformID(
            PLATFORM,
            url,
            config.id,
        ),
        name: chapter.chapterName,
        description: playlistInfo.description,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, playlistInfo.authorUrl, config.id),
            playlistInfo.authorName,
            playlistInfo.authorUrl,
        ),
        url: url,
        duration: chapter.duration,
        thumbnails: new Thumbnails([new Thumbnail(playlistInfo.bookCoverUrl)]),
        video: new UnMuxVideoSourceDescriptor([], sources),
    });

}

source.isChannelUrl = function (url) {
    return REGEX_CHANNEL.test(url);
}

source.getChannel = function (url) {
    const channelId = extractChannelId(url);
    const author = state.authors.find(a => a.id == channelId);

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, author.url, config.id),
        name: author.name,
        thumbnail: '',
        // banner,
        subscribers: 0,
        description: '',
        url
    });

}

source.getChannelContents = function (url) {

    const channelId = extractChannelId(url);
    const author = state.authors.find(a => a.id == channelId);
    const searchQuery = author.last_name;

    return doSearchAudioBookPager(URL_API_AUDIOBOOKS_SEARCH_BY_AUTHOR, searchQuery, function (audiobook) {
        return audiobook.authors.some(a => a.id == author.id);
    });
}

function extractChannelId(url) {

    const match = url.match(REGEX_CHANNEL);

    // If there's a match, the ID will be in the second capture group (index 2)
    return match ? match[2] : null;
}

function getAudioBookCachedDetails(url) {
    // Check the cache first
    if (state.audiobookDetails[url]) {
        return state.audiobookDetails[url];
    }

    const audioBookId = extractId(url);

    if (audioBookId) {

        const res = http.GET(URL_API_AUDIOBOOKS_DETAILS_PLACEHOLDER.replace('{audioBookId}', audioBookId), {});

        if (res.isOk) {
            const book = JSON.parse(res.body)?.books?.[0];

            const author = book?.authors?.[0] ?? [{ first_name: '', lastname: '', id: '', author: '' }];
            const authorName = author?.author ?? `${author.first_name} ${author.last_name}`.trim();
            const authorUrl = author.id ? `${URL_BASE_AUTHOR}/${author.id}` : '';

            state.audiobookDetails[url] = {
                title: book.books,
                description: book.description,
                authorName: authorName,
                authorUrl: authorUrl,
                bookCoverUrl: book.coverart_thumbnail || book.coverart_jpg || DEFAULT_COVER_BOOK_URL,
                chapters: book.sections.map((s, idx) => {
                    const reader = s.readers?.[0] ?? [{ display_name: '', id: '' }];
                    return {
                        chapterId: idx,
                        chapterName: s.title,
                        chapterFile: s.listen_url,
                        duration: parseInt(s.playtime),
                        readerName: reader.display_name,
                        readerUrl: `${URL_BASE_READER}/${reader.id}`
                    }
                })
            }
        }


    } else {
        // Perform the GET request to fetch the page content
        const resp = http.GET(url, {});
        const htmlElement = domParser.parseFromString(resp.body, 'text/html');

        // Cache frequently used elements
        const authorElement = htmlElement.querySelector('.book-page-author a');
        const coverElement = htmlElement.querySelector('.book-page-book-cover img');
        const chaptersElements = htmlElement.querySelectorAll('.chapter-download tbody tr');

        // Extract book details
        const title = htmlElement.querySelector('.content-wrap h1')?.text;
        const description = htmlElement.querySelector('.content-wrap .description')?.text;
        const authorName = authorElement?.text ?? '';

        const authorUrl = authorElement?.getAttribute('href') ?? '';
        const bookCoverUrl = coverElement?.getAttribute('src') ?? DEFAULT_COVER_BOOK_URL;

        // Process chapters in one pass
        const chapters = Array.from(chaptersElements).map((chapterTableRow, idx) => {
            const chapterName = chapterTableRow.querySelector('a.chapter-name')?.text ?? "";
            const chapterFile = chapterTableRow.querySelector('a.chapter-name')?.getAttribute('href') ?? '';
            const tds = chapterTableRow.querySelectorAll('td');
            const durationText = tds[tds.length - 1]?.text;
            const readerElement = tds[2].querySelector('a');
            const readerName = readerElement?.text ?? "";
            const readerUrl = readerElement?.getAttribute('href') ?? '';

            // Return chapter details
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
        state.audiobookDetails[url] = { title, description, chapters, authorName, authorUrl, bookCoverUrl };
    }

    return state.audiobookDetails[url];

}


function timeToSeconds(timeString) {
    // Split the input string into hours, minutes, and seconds
    const [hours, minutes, seconds] = timeString.split(":").map(Number);

    // Calculate the total seconds
    return hours * 3600 + minutes * 60 + seconds;
}

function extractChapterId(url) {
    const match = url.match(REGEX_CONTENT_DETAILS);

    if (match) {
        return match[1]; // The chapter id is in the first capture group
    }
    return null; // Return null if no match is found
}


function objectToUrlEncodedString(obj) {
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


function parseJsonUrl(url, opts = { is_authenticated: false, headers: {} }) {
    const headers = opts.headers || {}; // Allow custom headers
    let response;

    try {
        response = http.GET(url, headers, opts.is_authenticated);

        if (response.isOk) {
            const data = JSON.parse(response.body);
            return [null, data];
        } else {
            // Handle non-OK responses
            return [new Error(`Request failed with status: ${response.statusCode}`), null];
        }
    } catch (error) {
        // Differentiate parsing errors from others
        if (response && !response.isOk) {
            return [new Error(`Request failed: ${response.statusCode} - ${error.message}`), null];
        }
        return [error, null];
    }
}

function searchByName(array, query) {
    // Normalize the query by trimming and converting to lowercase
    const normalizedQuery = query.trim().toLowerCase();

    // Filter the array based on partial name match
    return array.filter((item) => {

        const normalizedDisplayNameName = item.displayName.trim().toLowerCase();
        const normalizedDisplayAgeName = item.displayEstimatedAge.trim().toLowerCase();

        return normalizedDisplayNameName.includes(normalizedQuery) || normalizedDisplayAgeName.includes(normalizedQuery);
    });
}

function audiobookToPlaylist(book) {
    const author = book?.authors?.[0] ?? [{ first_name: '', lastname: '', id: '', author: '' }];
    const combined_name =  author.first_name || author.last_name ? `${author.first_name} ${author.last_name}`.trim() : '';
    const author_name = author?.author || combined_name || '';
    const author_url = author.id ? `${URL_BASE_AUTHOR}/${author.id}` : '';
debugger;
    return new PlatformPlaylist({
        id: new PlatformID(
            PLATFORM,
            book?.url_librivox ?? '',
            config.id,
        ),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, author_url, config.id),
            author_name,
            author_url
        ),
        name: book?.title ?? '',
        thumbnail: book.coverart_thumbnail || book?.coverart_jpg || DEFAULT_COVER_BOOK_URL,
        videoCount: book?.sections?.length ?? -1,
        url: book.id ? `${book?.url_librivox}?id=${book.id}` : book?.url_librivox,
    });
}

function extractId(url) {
    const match = url.match(/[?&]id=([^&]+)/);
    return match ? match[1] : null;
}

// Helper function to safely extract text content
const safeTextContent = element => element?.textContent?.trim() || null;

// Helper function to safely get attribute
const safeAttribute = (element, attr) => element?.getAttribute?.(attr) || null;

function extractBookData(htmlString) {
    // Input validation
    if (!htmlString || typeof htmlString !== 'string') {
        throw new Error('Invalid input: htmlString must be a non-empty string');
    }

    const doc = domParser.parseFromString(htmlString, 'text/html');

    // Early validation of parsed document
    if (!doc || !doc.querySelector('li.catalog-result')) {
        return [];
    }

    return Array.from(doc.querySelectorAll('li.catalog-result')).map(book => {
        // Extract book details with better error handling
        const titleElement = book.querySelector('h3');
        //   const titleAnchor = titleElement?.querySelector('a');

        // Handle nested title structure
        const bookTitle = titleElement ?
            titleElement.firstChild?.textContent?.trim() || safeTextContent(titleElement) :
            null;

        // Extract additional metadata
        //   const metaElement = book.querySelector('.book-meta');
        //   const metaParts = safeTextContent(metaElement)?.split('|').map(part => part.trim()) || [];

        // Extract download information
        //   const downloadElement = book.querySelector('.download-btn a');
        //   const sizeElement = book.querySelector('.download-btn span');
        debugger
        let authorUrl = '';
        try {
            authorUrl = safeAttribute(book.querySelector('.book-author a'), 'href') ?? '';
        } catch (e) {

        }

        let url_librivox = safeAttribute(book.querySelector('a.book-cover'), 'href');  
        if(!url_librivox) {
            const categoryElement = book.querySelector('a[data-sub_category]')
            url_librivox = safeAttribute(categoryElement, 'href');
        }

        // data-sub_category


        debugger
        return {
            title: bookTitle,
            url_librivox: url_librivox,
            coverImage: safeAttribute(book.querySelector('a.book-cover img'), 'src'),
            authors: [{
                id: extractChannelId(authorUrl),
                author: safeTextContent(book.querySelector('.book-author a')),
                url: authorUrl,
                lifeDates: book.querySelector('.dod-dob')?.textContent?.replace(/[()]/g, '').trim() || null
            }],
            metadata: {
                //   status: metaParts[0] || null,
                //   type: metaParts[1] || null,
                //   language: metaParts[2] || null
            },
            download: {
                //   url: safeAttribute(downloadElement, 'href'),
                //   size: safeTextContent(sizeElement)
            }
        };
    });
}