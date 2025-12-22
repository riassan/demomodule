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

            // Detay linki olarak direkt API adresini veriyoruz
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
        // DÜZELTME: Veri "title" içinde olabilir
        var info = data.title ? data.title : data;

        if (info) {
            details.push({
                description: info.description || info.plot || "Açıklama yok",
                aliases: info.original_name || info.name_romanji || "N/A",
                airdate: info.year ? String(info.year) : "Bilinmiyor"
            });
        }
    } catch (e) { }
    return JSON.stringify(details);
}

// ------------------------------------------------------------------
// 3. BÖLÜM LİSTESİ (HATASI GİDERİLDİ)
// ------------------------------------------------------------------
async function extractEpisodes(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var allEpisodes = [];

    try {
        var data = JSON.parse(text);
        
        // --- KRİTİK DÜZELTME BURADA ---
        // API veriyi { "title": { ... } } şeklinde dönüyor.
        // Önceki kodda direkt data.seasons diyorduk, bu yüzden undefined geliyordu.
        var mainInfo = data.title ? data.title : data;
        
        var titleId = mainInfo.id || mainInfo._id;

        // --- SENARYO 1: SEZONLU DİZİ ---
        if (mainInfo.seasons && mainInfo.seasons.length > 0) {
            // Paralel istekleri hazırla
            var promises = mainInfo.seasons.map(function(season) {
                var sNum = season.number;
                // Doğru API çağrısı: ?seasonNumber=X
                var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
                
                return soraFetch(seasonUrl).then(function(res) {
                    return res ? res.text() : null;
                }).then(function(resText) {
                    if (!resText) return [];
                    try {
                        var sJson = JSON.parse(resText);
                        // Sezon isteğinin cevabı da "title" içinde olabilir
                        var sData = sJson.title ? sJson.title : sJson;
                        
                        var rawEps = sData.videos || sData.episodes || [];
                        
                        return rawEps.map(function(ep, index) {
                            var epNum = parseFloat(ep.episode_number || ep.episode);
                            if (isNaN(epNum)) epNum = index + 1;
                            
                            // Fragmanları filtrele
                            if (ep.type === "embed" && ep.category === "trailer") return null;

                            return {
                                href: BASE_URL + "/video/" + (ep.id || ep._id),
                                number: epNum,
                                season: sNum,
                                title: (ep.name && ep.name !== "Bölüm " + epNum) ? ep.name : ("Bölüm " + epNum),
                                date: ep.created_at || ""
                            };
                        }).filter(function(e) { return e !== null; }); // Null olanları (fragmanları) temizle
                    } catch (err) { return []; }
                });
            });

            // Tüm sezonları bekle ve birleştir
            var results = await Promise.all(promises);
            results.forEach(function(seasonEps) {
                allEpisodes = allEpisodes.concat(seasonEps);
            });

        } 
        // --- SENARYO 2: DÜZ VİDEO LİSTESİ ---
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
        }

        // --- SENARYO 3: FİLM ---
        if (allEpisodes.length === 0 && (mainInfo.video_id || mainInfo.videoId)) {
            var vidId = mainInfo.video_id || mainInfo.videoId;
            allEpisodes.push({
                href: BASE_URL + "/video/" + vidId,
                number: 1,
                title: "Film / İzle",
                date: ""
            });
        }
        
        // Sıralama (İsteğe bağlı, genellikle app halleder ama garanti olsun)
        // Sezon varsa zaten sıralı ekledik. Yoksa ters çevir (eskiden yeniye)
        if (!mainInfo.seasons || mainInfo.seasons.length === 0) {
            allEpisodes.reverse();
        }

    } catch (e) {
        console.log("Episodes Error: " + e);
    }
    return JSON.stringify(allEpisodes);
}

// ------------------------------------------------------------------
// 4. VİDEO URL ÇÖZÜCÜ (Header Destekli)
// ------------------------------------------------------------------
async function extractStreamUrl(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    var html = await response.text();
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
            
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
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
// YARDIMCI: soraFetch (Cookie ve Encoding Destekli)
// ------------------------------------------------------------------
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (!options.headers["Referer"]) options.headers["Referer"] = BASE_URL + "/";

    try {
        // Attığın diğer modüllerdeki gibi gelişmiş çağrı
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
