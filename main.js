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
// 3. BÖLÜM LİSTESİ (BASİTLEŞTİRİLMİŞ & KAPSAM HATASI GİDERİLMİŞ)
// ==============================================================================
async function extractEpisodes(url) {
    // 1. Ana Anime Verisini Çek
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var allEpisodes = [];

    try {
        var text = await response.text();
        var data = JSON.parse(text);
        var mainInfo = data.title ? data.title : data;
        var titleId = mainInfo.id || mainInfo._id;

        // --- SENARYO 1: SEZONLU DİZİ İSE ---
        // Sadece İLK sezonu çekiyoruz (Karmaşayı önlemek için)
        if (mainInfo.seasons && mainInfo.seasons.length > 0) {
            
            // İlk sezonun numarasını al (Genelde 1)
            var sNum = mainInfo.seasons[0].number; 
            
            // API İsteği: secure/titles/123?seasonNumber=1
            var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
            var sResp = await soraFetch(seasonUrl);
            
            if (sResp) {
                var sText = await sResp.text();
                var sJson = JSON.parse(sText);
                var sData = sJson.title ? sJson.title : sJson;
                
                // Bölümler buraya düşer
                var rawEps = sData.videos || sData.episodes || [];

                for (var k = 0; k < rawEps.length; k++) {
                    var ep = rawEps[k];
                    
                    // Fragmanları atla
                    if (ep.type === "embed" && ep.category === "trailer") continue;

                    // Kapsam hatasını önlemek için değişkenleri burada tanımla
                    var epId = ep.id || ep._id;
                    var epNumber = parseFloat(ep.episode_number || ep.episode);
                    if (isNaN(epNumber)) epNumber = k + 1;
                    
                    var epTitle = ep.name ? ("Bölüm " + epNumber + " - " + ep.name) : ("Bölüm " + epNumber);

                    allEpisodes.push({
                        href: BASE_URL + "/video/" + epId, // Video linki eşsiz ID içeriyor
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
                 if (vid.type === "embed" && vid.category === "trailer") continue;

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
        // Hata durumunda kullanıcı görsün diye sahte bölüm bas
        allEpisodes.push({ href: "", number: 1, title: "Hata: " + e.message });
    }
    return JSON.stringify(allEpisodes);
}

// ==============================================================================
// 4. VİDEO URL ÇÖZÜCÜ (Headerlı Obje Dönüşü)
// ==============================================================================
async function extractStreamUrl(url) {
    // 1. Animecix Video Sayfasını Çek
    // URL Örn: https://animecix.tv/video/12345
    var response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    var html = await response.text();
    
    // Iframe'i daha esnek bir Regex ile ara
    var tauMatch = html.match(/src\s*=\s*["']([^"']*tau-video[^"']*)["']/);

    if (tauMatch) {
        var tauUrl = tauMatch[1];
        if (tauUrl.indexOf("//") === 0) tauUrl = "https:" + tauUrl;

        // Hash ve ID al
        var hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        var vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            var apiHash = hashMatch[1];
            var apiVid = "";
            
            if (vidMatch) {
                apiVid = vidMatch[1];
            } else {
                // Eğer vid parametresi yoksa URL'in sonundaki ID'yi al
                var parts = url.split("/");
                apiVid = parts[parts.length - 1];
            }
            
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
            // Headerlar (Siteden ve attığın JS'lerden örnek alındı)
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
                    var m3u8Url = "";

                    if (tauData.list && tauData.list.length > 0) {
                        m3u8Url = tauData.list[0].url;
                    } else if (tauData.url) {
                        m3u8Url = tauData.url;
                    }

                    if (m3u8Url) {
                        // "1Movies.js" dosyasındaki yapıya uygun dönüş
                        var result = {
                            streams: [{
                                title: "Otomatik",
                                streamUrl: m3u8Url,
                                headers: headers 
                            }],
                            subtitles: [] 
                        };
                        return JSON.stringify(result);
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
    
    // Headerları garantiye al
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    options.headers["Referer"] = BASE_URL + "/";

    try {
        // useCookies: true (Attığın dosyalarda önemliydi)
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
