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
// 3. BÖLÜM LİSTESİ (AGRESİF GETİRİCİ)
// ==============================================================================
async function extractEpisodes(url) {
    // 1. Ana Veriyi Çek
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var allEpisodes = [];

    try {
        var text = await response.text();
        var data = JSON.parse(text);
        var mainInfo = data.title ? data.title : data;
        var titleId = mainInfo.id || mainInfo._id;

        // --- ADIM A: ANA VERİDEKİ VİDEOLARI KONTROL ET ---
        // Tek sezonlu animeler veya yeni eklenen bölümler burada olabilir.
        var initialVideos = mainInfo.videos || mainInfo.episodes || [];
        var validEpisodes = parseVideos(initialVideos, 1);

        if (validEpisodes.length > 0) {
            // Eğer ana veride bölüm bulduysak, bunları kullan (Hız için)
            // Fragman kontrolü yapılmış temiz listedir.
            allEpisodes = validEpisodes;
        } 
        
        // --- ADIM B: EĞER BOŞSA VEYA SEZONLUYSA, SEZON 1'İ ZORLA ÇEK ---
        // "Attack on Titan" gibi dizilerde ana listede sadece fragman olabilir.
        // O yüzden liste boşsa veya Sezon bilgisi varsa API'ye tekrar soruyoruz.
        if (allEpisodes.length === 0 && mainInfo.seasons && mainInfo.seasons.length > 0) {
            // İlk sezonun numarasını al
            var sNum = mainInfo.seasons[0].number || 1;
            
            var seasonUrl = BASE_URL + "/secure/titles/" + titleId + "?seasonNumber=" + sNum;
            var sResp = await soraFetch(seasonUrl);
            
            if (sResp) {
                var sText = await sResp.text();
                var sJson = JSON.parse(sText);
                var sData = sJson.title ? sJson.title : sJson;
                
                // Sezon sorgusundan gelen videolar
                var seasonVideos = sData.videos || sData.episodes || [];
                var seasonEps = parseVideos(seasonVideos, sNum);
                
                allEpisodes = allEpisodes.concat(seasonEps);
            }
        }

        // --- ADIM C: HALA BOŞSA, FİLM OLABİLİR ---
        if (allEpisodes.length === 0 && (mainInfo.video_id || mainInfo.videoId)) {
            allEpisodes.push({
                href: BASE_URL + "/video/" + (mainInfo.video_id || mainInfo.videoId),
                number: 1,
                title: "Film / İzle",
                date: ""
            });
        }

        // --- SIRALAMA VE TEMİZLİK ---
        // Genellikle eskiden yeniye sıralı olmasını isteriz
        // Eğer zaten sıralı değilse (API genelde tersten verir), düzelt.
        if (allEpisodes.length > 1) {
            // Numaraya göre sırala (Küçükten büyüğe)
            allEpisodes.sort(function(a, b) {
                return a.number - b.number;
            });
        }

    } catch (e) {
        // Hata olsa bile boş dönme, hata mesajı bas (Debug için)
        console.log("Episodes Error: " + e);
        allEpisodes.push({ href: "", number: 1, title: "Hata: " + e.toString() });
    }
    
    return JSON.stringify(allEpisodes);
}

// Yardımcı: Video Listesini İşleyen Fonksiyon
function parseVideos(videoList, seasonNum) {
    var parsed = [];
    if (!videoList || !Array.isArray(videoList)) return parsed;

    for (var k = 0; k < videoList.length; k++) {
        var ep = videoList[k];
        
        // Fragmanları (Trailer) kesinlikle atla
        if (ep.type === "embed" && (ep.category === "trailer" || ep.name.toLowerCase().includes("tanıtım"))) continue;
        // Eğer URL youtube ise bu bir bölüm değildir
        if (ep.url && ep.url.includes("youtube")) continue;

        var epId = ep.id || ep._id;
        if (!epId) continue;

        var epNum = parseFloat(ep.episode_number || ep.episode);
        if (isNaN(epNum)) epNum = k + 1;

        var epTitle = "Bölüm " + epNum;
        if (ep.name && ep.name.length > 2 && ep.name !== epTitle) {
            epTitle += " - " + ep.name;
        }

        parsed.push({
            href: BASE_URL + "/video/" + epId,
            number: epNum,
            season: seasonNum,
            title: epTitle,
            date: ep.created_at || ""
        });
    }
    return parsed;
}

// ==============================================================================
// 4. VİDEO URL ÇÖZÜCÜ (Referer Garantili)
// ==============================================================================
async function extractStreamUrl(url) {
    // 1. Video Sayfasını Çek
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
            
            // Tau API çağrısı
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
            // Bu Headerlar Oynatıcı için ŞART
            var headers = { 
                "Referer": BASE_URL + "/",
                "Origin": BASE_URL,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
                        return JSON.stringify({
                            streams: [{
                                title: "Otomatik (HLS)",
                                streamUrl: m3u8Url,
                                headers: headers // Oynatıcıya headerları iletiyoruz
                            }]
                        });
                    }
                } catch (e) { }
            }
        }
    }
    // Eğer hiçbir şey bulunamazsa boş dön
    return JSON.stringify({ streams: [] });
}

// ==============================================================================
// YARDIMCI: soraFetch (Cookie Destekli)
// ==============================================================================
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    // Header Seti
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    options.headers["Referer"] = BASE_URL + "/";

    try {
        // useCookies = true
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
