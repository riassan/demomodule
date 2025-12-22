// Global Değişkenler
var BASE_URL = "https://animecix.tv";
var TAU_BASE = "https://tau-video.xyz";

// ------------------------------------------------------------------
// 1. ARAMA FONKSİYONU
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 2. DETAY FONKSİYONU
// ------------------------------------------------------------------
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
    } catch (e) { }
    return JSON.stringify(details);
}

// ------------------------------------------------------------------
// 3. BÖLÜM LİSTESİ (SEZON DESTEKLİ - YENİ!)
// ------------------------------------------------------------------
async function extractEpisodes(url) {
    // 1. Ana Anime Verisini Çek
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var allEpisodes = [];

    try {
        var data = JSON.parse(text);
        
        // --- SENARYO 1: SEZONLU DİZİ (Verdiğin JSON Örneği) ---
        if (data.seasons && data.seasons.length > 0) {
            // Sezonları döngüye al (Sıralı gelmeyebilir, id'ye göre çekeceğiz)
            for (var i = 0; i < data.seasons.length; i++) {
                var season = data.seasons[i];
                // Her sezon için API'ye ek istek atıyoruz: /secure/seasons/{ID}
                var seasonUrl = BASE_URL + "/secure/seasons/" + season.id;
                
                var sResp = await soraFetch(seasonUrl);
                if (sResp) {
                    var sText = await sResp.text();
                    var sData = JSON.parse(sText);
                    
                    // Sezon içindeki bölümleri al
                    var sEps = sData.episodes || [];
                    for (var j = 0; j < sEps.length; j++) {
                        var ep = sEps[j];
                        var epNum = parseFloat(ep.episode_number || ep.episode);
                        if (isNaN(epNum)) epNum = j + 1;

                        allEpisodes.push({
                            // Video ID'sini href'e sakla
                            href: BASE_URL + "/video/" + ep.id,
                            number: epNum,
                            season: season.number || 1, // Uygulama sezonu destekliyorsa
                            title: "Sezon " + (season.number || 1) + " - Bölüm " + epNum,
                            date: ep.created_at || ""
                        });
                    }
                }
            }
        } 
        
        // --- SENARYO 2: DÜZ LİSTE (Eski usül veya tek sezon) ---
        else if (data.videos && data.videos.length > 0) {
             // Sadece fragman değilse ekle (type kontrolü yapılabilir ama riskli)
             for (var k = 0; k < data.videos.length; k++) {
                 var vid = data.videos[k];
                 // Fragmanları ele (Embed type genelde fragmandır)
                 if (vid.type === "embed" && vid.category === "trailer") continue;

                 var epNum2 = parseFloat(vid.episode_number || vid.episode);
                 allEpisodes.push({
                    href: BASE_URL + "/video/" + vid.id,
                    number: isNaN(epNum2) ? k + 1 : epNum2,
                    title: vid.name || ("Bölüm " + (k+1)),
                    date: vid.created_at || ""
                });
             }
        }

        // --- SENARYO 3: FİLM (Tek Video) ---
        if (allEpisodes.length === 0 && (data.video_id || data.videoId)) {
            var vidId = data.video_id || data.videoId;
            allEpisodes.push({
                href: BASE_URL + "/video/" + vidId,
                number: 1,
                title: "Film / İzle",
                date: ""
            });
        }
        
        // Eğer Sezonlu çekim yaptıysak liste karışık olabilir, sıralamak iyi olur ama zorunlu değil.
        // Genellikle uygulama kendi sıralar.

    } catch (e) {
        console.log("Episode Error: " + e);
    }
    return JSON.stringify(allEpisodes);
}

// ------------------------------------------------------------------
// 4. VIDEO URL ÇÖZÜCÜ
// ------------------------------------------------------------------
async function extractStreamUrl(url) {
    var response = await soraFetch(url);
    if (!response) return "";

    var html = await response.text();
    
    // Iframe ara
    var tauRegex = /src\s*=\s*["']([^"']*tau-video[^"']*)["']/;
    var tauMatch = html.match(tauRegex);

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
            
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
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

// ------------------------------------------------------------------
// YARDIMCI: soraFetch
// ------------------------------------------------------------------
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (!options.headers["Referer"]) options.headers["Referer"] = BASE_URL + "/";

    try {
        return await fetchv2(url, options.headers, options.method || 'GET', options.body || null);
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
