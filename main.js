// Global Sabitler
var BASE_URL = "https://animecix.tv";
var TAU_BASE = "https://tau-video.xyz";

// ==============================================================================
// 1. ARAMA FONKSİYONU
// ==============================================================================
async function searchResults(keyword) {
    var url = BASE_URL + "/secure/search/" + encodeURIComponent(keyword) + "?limit=20";
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    try {
        var text = await response.text();
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
                href: BASE_URL + "/secure/titles/" + (item.id || item._id)
            });
        }
        return JSON.stringify(results);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// ==============================================================================
// 2. DETAY FONKSİYONU
// ==============================================================================
async function extractDetails(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    try {
        var text = await response.text();
        var data = JSON.parse(text);
        var info = data.title ? data.title : data;

        var details = [{
            description: info.description || info.plot || "Açıklama yok",
            aliases: info.original_name || info.name_romanji || "N/A",
            airdate: info.year ? String(info.year) : "Bilinmiyor"
        }];
        return JSON.stringify(details);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// ==============================================================================
// 3. BÖLÜM LİSTESİ (SIRALI ÇEKİM - DUPLİKE ÖNLEYİCİ)
// ==============================================================================
async function extractEpisodes(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var allEpisodes = [];

    try {
        var text = await response.text();
        var data = JSON.parse(text);
        var mainInfo = data.title ? data.title : data;
        var titleId = mainInfo.id || mainInfo._id;

        // --- SENARYO 1: SEZONLAR (Sırayla Çek - Bekle) ---
        if (mainInfo.seasons && mainInfo.seasons.length > 0) {
            
            // DİKKAT: forEach veya map kullanmıyoruz, for döngüsü ile await yapıyoruz
            // Böylece biri bitmeden diğeri başlamaz, veriler karışmaz.
            for (var i = 0; i < mainInfo.seasons.length; i++) {
                var season = mainInfo.seasons[i];
                var sNum = season.number;
                
                var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
                var sResp = await soraFetch(seasonUrl);
                
                if (sResp) {
                    var sText = await sResp.text();
                    try {
                        var sJson = JSON.parse(sText);
                        var sData = sJson.title ? sJson.title : sJson;
                        var rawEps = sData.videos || sData.episodes || [];

                        for (var k = 0; k < rawEps.length; k++) {
                            var ep = rawEps[k];
                            // Fragman kontrolü
                            if (ep.type === "embed" && ep.category === "trailer") continue;

                            var epNum = parseFloat(ep.episode_number || ep.episode);
                            if (isNaN(epNum)) epNum = k + 1;

                            allEpisodes.push({
                                href: BASE_URL + "/video/" + (ep.id || ep._id),
                                number: epNum,
                                season: sNum,
                                title: (ep.name && ep.name !== "Bölüm " + epNum) ? ep.name : ("S" + sNum + " B" + epNum),
                                date: ep.created_at || ""
                            });
                        }
                    } catch (err) {}
                }
            }
        } 
        // --- SENARYO 2: SEZONSUZ ---
        else if (mainInfo.videos && mainInfo.videos.length > 0) {
             for (var k = 0; k < mainInfo.videos.length; k++) {
                 var vid = mainInfo.videos[k];
                 if (vid.type === "embed" && vid.category === "trailer") continue;

                 var epNum2 = parseFloat(vid.episode_number || vid.episode);
                 if (isNaN(epNum2)) epNum2 = k + 1;

                 allEpisodes.push({
                    href: BASE_URL + "/video/" + (vid.id || vid._id),
                    number: epNum2,
                    title: vid.name || ("Bölüm " + epNum2),
                    date: vid.created_at || ""
                });
             }
             allEpisodes.reverse(); // Eskiden yeniye sırala
        }
        // --- SENARYO 3: FİLM ---
        else if (mainInfo.video_id || mainInfo.videoId) {
            allEpisodes.push({
                href: BASE_URL + "/video/" + (mainInfo.video_id || mainInfo.videoId),
                number: 1,
                title: "Film / İzle",
                date: ""
            });
        }

    } catch (e) {
        console.log("Episodes Error: " + e);
    }
    return JSON.stringify(allEpisodes);
}

// ==============================================================================
// 4. VİDEO URL ÇÖZÜCÜ (TAU API DÜZELTİLDİ)
// ==============================================================================
async function extractStreamUrl(url) {
    // 1. Animecix Video Sayfası
    var response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    var html = await response.text();
    
    // Iframe bul
    var tauMatch = html.match(/src\s*=\s*["']([^"']*tau-video[^"']*)["']/);

    if (tauMatch) {
        var tauUrl = tauMatch[1];
        if (tauUrl.indexOf("//") === 0) tauUrl = "https:" + tauUrl;

        // ID ve Hash ayıkla
        var hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        var vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            var apiHash = hashMatch[1];
            var apiVid = "";
            
            if (vidMatch) {
                apiVid = vidMatch[1];
            } else {
                var parts = url.split("/");
                apiVid = parts[parts.length - 1];
            }
            
            // Tau API İsteği
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
            // Headerlar (Loglardakinin aynısı)
            var headers = { 
                "Referer": BASE_URL + "/",
                "Origin": BASE_URL,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
            };
            
            var tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                var tauText = await tauResponse.text();
                try {
                    var tauData = JSON.parse(tauText);
                    var m3u8Url = "";

                    // Loglarda bazen 'list', bazen direkt 'url' dönüyor
                    if (tauData.list && tauData.list.length > 0) {
                        m3u8Url = tauData.list[0].url;
                    } else if (tauData.url) {
                        m3u8Url = tauData.url;
                    }

                    if (m3u8Url) {
                        return JSON.stringify({
                            streams: [{
                                title: "Otomatik (HLS)",
                                streamUrl: m3u8Url,
                                headers: headers // Oynatıcıya da bu headerları gönder
                            }]
                        });
                    }
                } catch (e) {
                    console.log("Tau JSON parse error: " + e);
                }
            }
        }
    }
    return JSON.stringify({ streams: [] });
}

// ==============================================================================
// YARDIMCI: soraFetch
// ==============================================================================
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    // Animecix Headerları (Zorunlu)
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (!options.headers["Referer"]) options.headers["Referer"] = BASE_URL + "/";

    try {
        return await fetchv2(
            url, 
            options.headers, 
            options.method || 'GET', 
            options.body || null, 
            true, // useCookies
            'utf-8' // encoding
        );
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
