//////////////////////////////////////////////////////////////////////////////////////////
//                             Sora Extractor Module (Anizle)
//////////////////////////////////////////////////////////////////////////////////////////

const searchUrl = 'https://anizle.com/?s=';

async function searchResults(keyword) {
    try {
        const url = searchUrl + encodeURIComponent(keyword);
        const response = await fetch(url);
        const html = await response.text();

        const results = [];
        const regex = /<a[^>]*href="(https:\/\/anizle\.com\/[^"]+)"[^>]*title="([^"]+)"[^>]*>\s*<div[^>]*class="poster[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*>/g;

        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push({
                title: match[2],
                href: match[1],
                image: match[3]
            });
        }

        return JSON.stringify(results);
    } catch (e) {
        console.log("Search error: ", e);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    return JSON.stringify([
        {
            description: "Anizle'den otomatik çekilen içerik",
            aliases: "",
            airdate: "Bilinmiyor"
        }
    ]);
}

async function extractEpisodes(url) {
    return JSON.stringify([
        {
            number: 1,
            href: url
        }
    ]);
}

async function extractStreamUrl(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();
        const match = html.match(/<iframe[^>]+src="([^"]+)"/);
        if (match && match[1]) {
            const streamUrl = match[1].startsWith("http") ? match[1] : "https:" + match[1];
            return streamUrl;
        }
        return "";
    } catch (e) {
        console.log("Stream extraction error: ", e);
        return "";
    }
}

//////////////////////////////////////////////////////////////////////////////////////////
//                                  Sora.addExtractor
//////////////////////////////////////////////////////////////////////////////////////////

Sora.addExtractor({
    name: "Anizle",
    urlPatterns: ["https://anizle.com/*"],
    async extract(page) {
        const doc = page.getDocument();
        const iframe = doc.querySelector("iframe");
        if (!iframe) {
            return { streams: [] };
        }

        const src = iframe.getAttribute("src");
        return {
            streams: [
                {
                    url: src.startsWith("http") ? src : "https:" + src,
                    quality: "HD",
                    isM3U8: src.includes(".m3u8")
                }
            ]
        };
    }
});