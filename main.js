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
                img = img.indexOf("/") === 0 ? BASE_URL + img : BASE_URL + "/" + img;
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
// 3. BÖLÜM LİSTESİ (FİLTRELER DÜZELTİLDİ)
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

        // --- SENARYO 1: SEZONLU DİZİ ---
        if (mainInfo.seasons && mainInfo.seasons.length > 0) {
            // Sadece İLK sezonu çekiyoruz (Karmaşayı önlemek için)
            var firstSeason = mainInfo.seasons[0];
            var sNum = firstSeason.number; 
            
            var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
            var sResp = await soraFetch(seasonUrl);
            
            if (sResp) {
                var sText = await sResp.text();
                var sJson = JSON.parse(sText);
                var sData = sJson.title ? sJson.title : sJson;
                var rawEps = sData.videos || sData.episodes || [];

                for (var k = 0; k < rawEps.length; k++) {
                    var ep = rawEps[k];
                    
                    // --- KRİTİK DÜZELTME ---
                    // Önceki hatamız: 'embed' tipini tamamen engelliyorduk.
                    // Şimdi sadece 'category'si 'trailer' olanları veya YouTube linklerini engelliyoruz.
                    if (ep.category === "trailer" || (ep.name && ep.name.toLowerCase().includes("tanıtım"))) continue;
                    if (ep.url && (ep.url.indexOf("youtube") !== -1 || ep.url.indexOf("youtu.be") !== -1)) continue;

                    var epId = ep.id || ep._id;
                    var epNumber = parseFloat(ep.episode_number || ep.episode);
                    if (isNaN(epNumber)) epNumber = k + 1;
                    
                    var epTitle = ep.name ? ("Bölüm " + epNumber + " - " + ep.name) : ("Bölüm " + epNumber);

                    allEpisodes.push({
                        href: BASE_URL + "/video/" + epId,
                        number: epNumber,
                        season: sNum,
                        title: epTitle,
                        date: ep.created_at || ""
                    });
                }
            }
        } 
        // --- SENARYO 2: DÜZ VİDEO LİSTESİ ---
        else if (mainInfo.videos && mainInfo.videos.length > 0) {
             for (var k = 0; k < mainInfo.videos.length; k++) {
                 var vid = mainInfo.videos[k];
                 
                 // Fragman filtresi
                 if (vid.category === "trailer") continue;
                 if (vid.url && (vid.url.indexOf("youtube") !== -1 || vid.url.indexOf("youtu.be") !== -1)) continue;

                 var vidId = vid.id || vid._id;
                 var vidNum = parseFloat(vid.episode_number || vid.episode);
                 if (isNaN(vidNum)) vidNum = k + 1;

                 allEpisodes.push({
                    href: BASE_URL + "/video/" + vidId,
                    number: vidNum,
                    title: vid.name ? ("Bölüm " + vidNum + " - " + vid.name) : ("Bölüm " + vidNum),
                    date: vid.created_at || ""
                });
             }
             allEpisodes.reverse();
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
        allEpisodes.push({ href: "", number: 1, title: "Hata: " + e.message });
    }
    
    return JSON.stringify(allEpisodes);
}

// ==============================================================================
// 4. VİDEO URL ÇÖZÜCÜ (MP4 VE HEADER DESTEKLİ)
// ==============================================================================
async function extractStreamUrl(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    var html = await response.text();
    
    // Iframe'i bul
    var tauMatch = html.match(/src\s*=\s*["']([^"']*tau-video[^"']*)["']/);

    if (tauMatch) {
        var tauUrl = tauMatch[1];
        if (tauUrl.indexOf("//") === 0) tauUrl = "https:" + tauUrl;

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
            
            var headers = { 
                "Referer": BASE_URL + "/",
                "Origin": BASE_URL,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest"
            };
            
            var tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                try {
                    var tauText = await tauResponse.text();
                    var tauData = JSON.parse(tauText);
                    var finalUrl = "";
                    
                    // Loglara göre veri bazen "list", bazen "url" içinde
                    if (tauData.list && tauData.list.length > 0) {
                        finalUrl = tauData.list[0].url;
                    } else if (tauData.url) {
                        finalUrl = tauData.url;
                    }

                    if (finalUrl) {
                        return JSON.stringify({
                            streams: [{
                                title: "Otomatik",
                                streamUrl: finalUrl,
                                // Eğer URL .m3u8 değilse (mp4 ise) type belirtmiyoruz, app otomatik anlıyor.
                                // Sadece HLS ise belirtiyoruz.
                                type: finalUrl.includes(".m3u8") ? "hls" : "mp4",
                                headers: {
                                    "Referer": TAU_BASE + "/", // Video için referer Tau olmalı
                                    "User-Agent": headers["User-Agent"]
                                }
                            }]
                        });
                    }
                } catch (e) { }
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
    
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    options.headers["Referer"] = BASE_URL + "/";

    try {
        return await fetchv2(
            url, 
            options.headers, 
            options.method || 'GET', 
            options.body || null, 
            true, 
            'utf-8'
        );
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
