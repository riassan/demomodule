// Global Değişkenler
var BASE_URL = "https://animecix.tv";
var TAU_BASE = "https://tau-video.xyz";

// ------------------------------------------------------------------
// 1. ARAMA FONKSİYONU (Çalıştığı için dokunmadım, aynı mantık)
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
// 3. BÖLÜM LİSTESİ (TAMAMEN YENİLENDİ)
// ------------------------------------------------------------------
async function extractEpisodes(url) {
    var response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    var text = await response.text();
    var episodes = [];

    try {
        var data = JSON.parse(text);
        
        // Bölümleri bulmak için olası tüm alanları kontrol et
        var videoList = data.videos || data.episodes || [];
        
        // EĞER FİLM İSE (Video listesi boş ama ana objede video_id var)
        if (videoList.length === 0 && (data.video_id || data.videoId)) {
            var vidId = data.video_id || data.videoId;
            episodes.push({
                href: BASE_URL + "/video/" + vidId,
                number: 1, // Sayı olmak zorunda
                title: "Film / Tek Bölüm",
                date: ""
            });
        } 
        // EĞER DİZİ İSE
        else {
            for (var i = 0; i < videoList.length; i++) {
                var vid = videoList[i];
                
                // Bölüm numarası kesinlikle bir sayı olmalı. Yoksa 0 ata.
                var epNum = parseFloat(vid.episode_number || vid.episode || vid.order);
                if (isNaN(epNum)) epNum = i + 1; // Eğer API'den sayı gelmezse sırasını ver

                // Bölüm ismini oluştur
                var epName = "Bölüm " + epNum;
                if (vid.name) epName += " - " + vid.name;

                episodes.push({
                    href: BASE_URL + "/video/" + vid.id,
                    number: epNum,
                    title: epName,
                    date: vid.created_at || "" // Tarih bilgisi bazı applerde zorunlu olabilir
                });
            }
        }
        
        // Bölümleri sırala (Büyükten küçüğe veya küçükten büyüğe)
        // Genellikle uygulamalar array sırasını kullanır.
        // Animecix genellikle eskiden yeniye verir, biz ters çevirelim (Son bölüm en üstte)
        episodes.reverse();

    } catch (e) {
        // Hata durumunda boş dönmesi uygulamanın çökmesinden iyidir
    }
    return JSON.stringify(episodes);
}

// ------------------------------------------------------------------
// 4. VIDEO URL ÇÖZÜCÜ (GÜÇLENDİRİLDİ)
// ------------------------------------------------------------------
async function extractStreamUrl(url) {
    // 1. Video sayfasını çek
    var response = await soraFetch(url);
    if (!response) return "";

    var html = await response.text();
    
    // 2. Iframe ara (Regex genişletildi)
    // Hem tek tırnak hem çift tırnak, hem src başında boşluk olabilir
    var tauRegex = /src\s*=\s*["']([^"']*tau-video[^"']*)["']/;
    var tauMatch = html.match(tauRegex);

    if (tauMatch) {
        var tauUrl = tauMatch[1];
        if (tauUrl.indexOf("//") === 0) tauUrl = "https:" + tauUrl;

        // URL temizliği
        var hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        var vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            var apiHash = hashMatch[1];
            // vid parametresi url içinde yoksa, sayfa url'inden al
            var apiVid = "";
            if (vidMatch) {
                apiVid = vidMatch[1];
            } else {
                var parts = url.split("/");
                apiVid = parts[parts.length - 1];
            }
            
            var tauApiUrl = TAU_BASE + "/api/video/" + apiHash + "?vid=" + apiVid;
            
            // Referer Başlığı ŞART
            var headers = { "Referer": BASE_URL };
            var tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                var tauText = await tauResponse.text();
                try {
                    var tauData = JSON.parse(tauText);
                    
                    // List arrayinde m3u8 varsa al
                    if (tauData.list && tauData.list.length > 0) {
                        return tauData.list[0].url;
                    } 
                    // Direkt url varsa al
                    else if (tauData.url) {
                        return tauData.url;
                    }
                } catch (e) { }
            }
        }
    }
    return "";
}

// ------------------------------------------------------------------
// YARDIMCI: soraFetch (Hata Önleyici)
// ------------------------------------------------------------------
async function soraFetch(url, options) {
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    
    // Standart Headers
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    // Referer header olmadan Animecix veri vermez
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
