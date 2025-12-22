// Global Değişkenler
var BASE_URL = "https://animecix.tv";
var TAU_BASE = "https://tau-video.xyz";

// Arama Fonksiyonu
async function searchResults(keyword) {
    var url = BASE_URL + "/secure/search/" + encodeURIComponent(keyword) + "?limit=20";
    var response = await soraFetch(url);
    
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    
    try {
        var data = JSON.parse(text);
        var results = [];
        var items = Array.isArray(data) ? data : (data.results || data.titles || []);

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var img = item.poster || item.image || item.cover;
            if (img && img.indexOf("http") === -1) {
                img = img.indexOf("/") === 0 ? BASE_URL + img : img;
            }

            results.push({
                title: item.name || item.title || item.original_name,
                image: img || "https://animecix.tv/storage/logo/logo.png",
                href: BASE_URL + "/secure/titles/" + item.id
            });
        }
        return JSON.stringify(results);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// Detay Fonksiyonu
async function extractDetails(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var details = [];

    try {
        var data = JSON.parse(text);
        if (data) {
            details.push({
                description: data.description || data.plot || "Açıklama yok",
                aliases: data.original_name || "N/A",
                airdate: data.year ? String(data.year) : "Bilinmiyor"
            });
        }
    } catch (e) {
        // Hata sessizce geçilsin
    }
    return JSON.stringify(details);
}

// Bölüm Listesi
async function extractEpisodes(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var episodes = [];

    try {
        var data = JSON.parse(text);
        var videoList = data.videos || data.episodes || [];

        if (videoList.length === 0 && data.video_id) {
            episodes.push({
                href: BASE_URL + "/video/" + data.video_id,
                number: 1
            });
        } else {
            for (var i = 0; i < videoList.length; i++) {
                var vid = videoList[i];
                episodes.push({
                    href: BASE_URL + "/video/" + vid.id,
                    number: parseFloat(vid.episode_number || vid.episode || vid.order || 0)
                });
            }
        }
        episodes.reverse();
    } catch (e) {
        // Hata
    }
    return JSON.stringify(episodes);
}

// Video Linki Çözücü
async function extractStreamUrl(url) {
    var response = await soraFetch(url);
    if (!response) return "";

    var html = await response.text();
    var tauMatch = html.match(/src=["']([^"']*tau-video[^"']*)["']/);

    if (tauMatch) {
        var tauUrl = tauMatch[1];
        if (tauUrl.indexOf("//") === 0) tauUrl = "https:" + tauUrl;

        var hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        var vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            var apiHash = hashMatch[1];
            var parts = url.split("/");
            var apiVid = vidMatch ? vidMatch[1] : parts[parts.length - 1];
            
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
            // Referer header olmadan Tau çalışmaz
            var headers = { "Referer": BASE_URL };
            var tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                var tauText = await tauResponse.text();
                try {
                    var tauData = JSON.parse(tauText);
                    if (tauData.list && tauData.list.length > 0) {
                        return tauData.list[0].url;
                    } else if (tauData.url) {
                        return tauData.url;
                    }
                } catch (e) { }
            }
        }
    }
    return "";
}

// Fetch Yardımcısı (Syntax Hatası Almamak İçin Sadeleştirildi)
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    if (!options.method) options.method = 'GET';
    
    // Animecix Headerları Zorunlu
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    options.headers["Referer"] = BASE_URL + "/";

    try {
        return await fetchv2(url, options.headers, options.method, options.body || null);
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
