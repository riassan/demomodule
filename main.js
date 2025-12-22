// Global Sabitler
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
        // API bazen dizi, bazen obje içinde sonuç döner
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
        console.log("Search Parse Error: " + e);
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
// 3. BÖLÜM LİSTESİ (PARALEL ÇEKİM & GÜÇLÜ PARSER)
// ------------------------------------------------------------------
async function extractEpisodes(url) {
    // 1. Ana Anime Verisini Çek
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var allEpisodes = [];

    try {
        var data = JSON.parse(text);
        var titleId = data.id || data._id;

        // --- SENARYO 1: SEZONLU DİZİ (Paralel İstek) ---
        if (data.seasons && data.seasons.length > 0) {
            // Tüm sezonlar için istekleri hazırla
            var promises = data.seasons.map(function(season) {
                var sNum = season.number;
                // Loglardan öğrendiğimiz doğru URL yapısı
                var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
                return soraFetch(seasonUrl).then(function(res) {
                    return res ? res.text() : null;
                }).then(function(resText) {
                    if (!resText) return [];
                    try {
                        var sData = JSON.parse(resText);
                        // Bölümler nerede? Her yeri kontrol et.
                        var rawEps = sData.videos || sData.episodes || (sData.title ? sData.title.videos : []) || [];
                        
                        return rawEps.map(function(ep, index) {
                            var epNum = parseFloat(ep.episode_number || ep.episode);
                            if (isNaN(epNum)) epNum = index + 1;
                            
                            return {
                                href: BASE_URL + "/video/" + (ep.id || ep._id),
                                number: epNum,
                                season: sNum,
                                title: (ep.name && ep.name !== "Bölüm " + epNum) ? ep.name : ("Bölüm " + epNum),
                                date: ep.created_at || ""
                            };
                        });
                    } catch (err) { return []; }
                });
            });

            // Tüm sezon isteklerini aynı anda gönder ve bekle
            var results = await Promise.all(promises);
            
            // Sonuçları birleştir
            results.forEach(function(seasonEps) {
                allEpisodes = allEpisodes.concat(seasonEps);
            });

        } 
        // --- SENARYO 2: SEZONSUZ DİZİ ---
        else if (data.videos && data.videos.length > 0) {
             for (var k = 0; k < data.videos.length; k++) {
                 var vid = data.videos[k];
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
        }

        // --- SENARYO 3: FİLM ---
        if (allEpisodes.length === 0 && (data.video_id || data.videoId)) {
            var vidId = data.video_id || data.videoId;
            allEpisodes.push({
                href: BASE_URL + "/video/" + vidId,
                number: 1,
                title: "Film / İzle",
                date: ""
            });
        }
        
        // Bölümleri ters çevir (Genelde en yeni en üstte gelir, düzeltiyoruz)
        // Eğer sezonluysa zaten Promise.all sırasıyla geldiği için karıştırmayalım,
        // Sadece tek liste varsa ters çevirelim.
        if (!data.seasons || data.seasons.length === 0) {
            allEpisodes.reverse();
        }

    } catch (e) {
        console.log("Episode Error: " + e);
    }
    return JSON.stringify(allEpisodes);
}

// ------------------------------------------------------------------
// 4. VIDEO URL ÇÖZÜCÜ (JSON DÖNÜŞLÜ)
// ------------------------------------------------------------------
async function extractStreamUrl(url) {
    // 1. Video sayfasını çek
    var response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    var html = await response.text();
    
    // 2. Iframe ara
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
            
            // Referer Başlığı ŞART
            var headers = { "Referer": BASE_URL + "/" };
            var tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                var tauText = await tauResponse.text();
                try {
                    var tauData = JSON.parse(tauText);
                    var m3u8Url = "";

                    if (tauData.list && tauData.list.length > 0) {
                        m3u8Url = tauData.list[0].url;
                    } else if (tauData.url) {
                        m3u8Url = tauData.url;
                    }

                    if (m3u8Url) {
                        // BURASI ÇOK ÖNEMLİ:
                        // Sadece linki değil, oynatıcı için gerekli Headerları da gönderiyoruz.
                        // "Veni Vidi Veci" modülündeki yapıya uygun olarak.
                        return JSON.stringify({
                            streams: [{
                                title: "Otomatik (HLS)",
                                streamUrl: m3u8Url,
                                headers: {
                                    "Referer": BASE_URL + "/",
                                    "Origin": BASE_URL,
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
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

// ------------------------------------------------------------------
// YARDIMCI: soraFetch (GELİŞMİŞ)
// ------------------------------------------------------------------
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    // Standart Headers
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (!options.headers["Referer"]) options.headers["Referer"] = BASE_URL + "/";

    try {
        // Attığın modüldeki gibi 6 parametreli çağrı
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
            // Fallback (Eski fetch)
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
