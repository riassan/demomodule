// Global Sabitler
const BASE_URL = "https://animecix.tv";
const TAU_BASE = "https://tau-video.xyz";

// ==============================================================================
// 1. ARAMA FONKSİYONU
// ==============================================================================
async function searchResults(keyword) {
    const url = `${BASE_URL}/secure/search/${encodeURIComponent(keyword)}?limit=20`;
    const response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    try {
        const text = await response.text();
        const data = JSON.parse(text);
        const results = [];
        
        // API bazen direkt array, bazen obje döner
        const items = Array.isArray(data) ? data : (data.results || data.titles || []);

        for (const item of items) {
            let img = item.poster || item.image || item.cover;
            if (img && !img.startsWith("http")) {
                img = img.startsWith("/") ? BASE_URL + img : BASE_URL + "/" + img;
            }

            results.push({
                title: item.name || item.title || item.original_name,
                image: img || "https://animecix.tv/storage/logo/logo.png",
                // Detay sayfasına giderken ID'yi taşıyoruz
                href: `${BASE_URL}/secure/titles/${item.id || item._id}`
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
    const response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    try {
        const text = await response.text();
        const data = JSON.parse(text);
        const info = data.title ? data.title : data;

        const details = [{
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
// 3. BÖLÜM LİSTESİ (SADECE SEZON 1 VEYA TEK LİSTE)
// ==============================================================================
async function extractEpisodes(url) {
    const response = await soraFetch(url);
    if (!response) return JSON.stringify([]);

    const allEpisodes = [];

    try {
        const text = await response.text();
        const data = JSON.parse(text);
        const mainInfo = data.title ? data.title : data;
        const titleId = mainInfo.id || mainInfo._id;

        // --- SENARYO 1: SEZONLU İSE SADECE İLK SEZONU ÇEK ---
        // Kullanıcı isteği üzerine: Sadece ilk sezonu çekiyoruz. 
        // Böylece karmaşa ve "3 tane aynı bölüm" hatası engelleniyor.
        if (mainInfo.seasons && mainInfo.seasons.length > 0) {
            
            // Genellikle ilk sezon index 0'dadır.
            const firstSeason = mainInfo.seasons[0];
            const sNum = firstSeason.number;
            
            const seasonUrl = `${BASE_URL}/secure/titles/${titleId}?seasonNumber=${sNum}`;
            const sResp = await soraFetch(seasonUrl);
            
            if (sResp) {
                const sText = await sResp.text();
                const sJson = JSON.parse(sText);
                const sData = sJson.title ? sJson.title : sJson;
                
                // Bölümler burada
                const rawEps = sData.videos || sData.episodes || [];

                for (let k = 0; k < rawEps.length; k++) {
                    const ep = rawEps[k];
                    
                    // Fragmanları atla
                    if (ep.type === "embed" && ep.category === "trailer") continue;

                    let epNum = parseFloat(ep.episode_number || ep.episode);
                    if (isNaN(epNum)) epNum = k + 1;

                    allEpisodes.push({
                        href: `${BASE_URL}/video/${ep.id || ep._id}`,
                        number: epNum,
                        season: sNum,
                        title: ep.name ? `Bölüm ${epNum} - ${ep.name}` : `Bölüm ${epNum}`,
                        date: ep.created_at || ""
                    });
                }
            }
        } 
        // --- SENARYO 2: SEZONSUZ / DÜZ LİSTE ---
        else if (mainInfo.videos && mainInfo.videos.length > 0) {
             for (let k = 0; k < mainInfo.videos.length; k++) {
                 const vid = mainInfo.videos[k];
                 if (vid.type === "embed" && vid.category === "trailer") continue;

                 let epNum2 = parseFloat(vid.episode_number || vid.episode);
                 if (isNaN(epNum2)) epNum2 = k + 1;

                 allEpisodes.push({
                    href: `${BASE_URL}/video/${vid.id || vid._id}`,
                    number: epNum2,
                    title: vid.name ? `Bölüm ${epNum2} - ${vid.name}` : `Bölüm ${epNum2}`,
                    date: vid.created_at || ""
                });
             }
             // Genellikle eskiden yeniye sıralı gelmesi için ters çevir
             allEpisodes.reverse(); 
        }
        // --- SENARYO 3: FİLM ---
        else if (mainInfo.video_id || mainInfo.videoId) {
            allEpisodes.push({
                href: `${BASE_URL}/video/${mainInfo.video_id || mainInfo.videoId}`,
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
// 4. VİDEO URL ÇÖZÜCÜ (Headerlı Obje Dönüşü)
// ==============================================================================
async function extractStreamUrl(url) {
    // 1. Animecix Sayfasını Çek
    const response = await soraFetch(url);
    if (!response) return JSON.stringify({ streams: [] });

    const html = await response.text();
    
    // Iframe ara
    const tauMatch = html.match(/src\s*=\s*["']([^"']*tau-video[^"']*)["']/);

    if (tauMatch) {
        let tauUrl = tauMatch[1];
        if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;

        // Hash ve ID al
        const hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        const vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            const apiHash = hashMatch[1];
            // vid parametresi yoksa URL'den al
            const apiVid = vidMatch ? vidMatch[1] : url.split("/").pop();
            
            const tauApiUrl = `${TAU_BASE}/api/video/${apiHash}?vid=${apiVid}`;
            
            // Headerlar (Siteden kopyalandı)
            const headers = { 
                "Referer": BASE_URL + "/",
                "Origin": BASE_URL,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            };
            
            const tauResponse = await soraFetch(tauApiUrl, { headers: headers });

            if (tauResponse) {
                try {
                    const tauText = await tauResponse.text();
                    const tauData = JSON.parse(tauText);
                    let m3u8Url = "";

                    if (tauData.list && tauData.list.length > 0) {
                        m3u8Url = tauData.list[0].url;
                    } else if (tauData.url) {
                        m3u8Url = tauData.url;
                    }

                    if (m3u8Url) {
                        // Uygulamanın istediği formatta dönüş
                        const result = {
                            streams: [{
                                title: "Otomatik (HLS)",
                                streamUrl: m3u8Url,
                                headers: headers // Headerları buraya gömüyoruz
                            }],
                            subtitles: [] // Altyazı varsa buraya eklenebilir
                        };
                        return JSON.stringify(result);
                    }
                } catch (e) {
                    console.log("Tau parse error: " + e);
                }
            }
        }
    }
    // Hata durumunda boş dön
    return JSON.stringify({ streams: [] });
}

// ==============================================================================
// YARDIMCI: soraFetch (Modern Fetch Wrapper)
// ==============================================================================
async function soraFetch(url, options = {}) {
    if (!options.headers) options.headers = {};
    
    // Zorunlu Headerlar
    options.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    options.headers["X-Requested-With"] = "XMLHttpRequest";
    if (!options.headers["Referer"]) options.headers["Referer"] = BASE_URL + "/";

    try {
        // useCookies: true önemli!
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
