const BASE_URL = "https://animecix.tv";
const TAU_BASE = "https://tau-video.xyz";

// Animecix için gerekli başlıklar (Erişim reddedilmesin diye)
const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://animecix.tv/",
    "X-Requested-With": "XMLHttpRequest"
};

// ------------------------------------------------------------------
// 1. ARAMA FONKSİYONU
// ------------------------------------------------------------------
async function searchResults(keyword) {
    // Animecix API endpoint
    const url = `${BASE_URL}/secure/search/${encodeURIComponent(keyword)}?limit=20`;
    
    // AnimeHeaven örneğindeki soraFetch'i kullanıyoruz
    const response = await soraFetch(url, { headers: COMMON_HEADERS });
    
    if (!response) return JSON.stringify([]);

    const text = await response.text();
    
    try {
        const data = JSON.parse(text);
        const results = [];
        
        // API bazen array bazen obje döner, kontrol ediyoruz
        const items = Array.isArray(data) ? data : (data.results || data.titles || []);

        items.forEach(item => {
            // Görsel URL kontrolü
            let img = item.poster || item.image || item.cover;
            if (img && !img.startsWith("http")) {
                img = img.startsWith("/") ? BASE_URL + img : img;
            }

            results.push({
                title: item.name || item.title || item.original_name,
                image: img || "https://animecix.tv/storage/logo/logo.png",
                // HREF kısmına API linkini saklıyoruz (Detay fonksiyonu için)
                href: `${BASE_URL}/secure/titles/${item.id}`
            });
        });

        console.log("Search Results Found:", results.length);
        return JSON.stringify(results);

    } catch (e) {
        console.error("Search Parse Error:", e);
        return JSON.stringify([]);
    }
}

// ------------------------------------------------------------------
// 2. DETAY FONKSİYONU
// ------------------------------------------------------------------
async function extractDetails(url) {
    // Url searchResults'dan gelen API linkidir
    const response = await soraFetch(url, { headers: COMMON_HEADERS });
    
    if (!response) return JSON.stringify([]);

    const text = await response.text();
    const details = [];

    try {
        const data = JSON.parse(text);
        
        if (data) {
            details.push({
                description: data.description || data.plot || "Açıklama yok",
                aliases: data.original_name || "N/A",
                airdate: data.year ? String(data.year) : "Bilinmiyor"
            });
        }
    } catch (e) {
        console.error("Details Parse Error:", e);
    }

    return JSON.stringify(details);
}

// ------------------------------------------------------------------
// 3. BÖLÜM LİSTESİ
// ------------------------------------------------------------------
async function extractEpisodes(url) {
    const response = await soraFetch(url, { headers: COMMON_HEADERS });
    
    if (!response) return JSON.stringify([]);

    const text = await response.text();
    const episodes = [];

    try {
        const data = JSON.parse(text);
        // Bölüm listesi "videos" veya "episodes" içindedir
        const videoList = data.videos || data.episodes || [];

        if (videoList.length === 0 && data.video_id) {
            // Film ise
            episodes.push({
                href: `${BASE_URL}/video/${data.video_id}`,
                number: 1
            });
        } else {
            // Dizi ise
            videoList.forEach(vid => {
                episodes.push({
                    href: `${BASE_URL}/video/${vid.id}`,
                    number: parseFloat(vid.episode_number || vid.episode || vid.order || 0)
                });
            });
        }
        
        // Genellikle tersten gelir
        episodes.reverse();

    } catch (e) {
        console.error("Episodes Parse Error:", e);
    }

    return JSON.stringify(episodes);
}

// ------------------------------------------------------------------
// 4. VİDEO URL ÇÖZÜCÜ (Tau Video)
// ------------------------------------------------------------------
async function extractStreamUrl(url) {
    // 1. Adım: Animecix video sayfasını (HTML) çek
    const response = await soraFetch(url, { headers: COMMON_HEADERS });
    
    if (!response) return "";

    const html = await response.text();

    // 2. Adım: Iframe içindeki Tau linkini bul
    // Örnek: src="//tau-video.xyz/embed/..."
    const tauRegex = /src=["']([^"']*tau-video[^"']*)["']/;
    const tauMatch = html.match(tauRegex);

    if (tauMatch) {
        let tauUrl = tauMatch[1];
        if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;

        // 3. Adım: Embed linkinden API parametrelerini çıkar
        const hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        const vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            const apiHash = hashMatch[1];
            const apiVid = vidMatch ? vidMatch[1] : url.split("/").pop();
            
            // Tau API'sine istek at
            const tauApiUrl = `${TAU_BASE}/api/video/${apiHash}?vid=${apiVid}`;
            
            const tauResponse = await soraFetch(tauApiUrl, { 
                headers: { "Referer": BASE_URL } // Referer önemli!
            });

            if (tauResponse) {
                const tauText = await tauResponse.text();
                try {
                    const tauData = JSON.parse(tauText);
                    
                    if (tauData.list && tauData.list.length > 0) {
                        console.log("Stream URL Found:", tauData.list[0].url);
                        return tauData.list[0].url;
                    } else if (tauData.url) {
                        return tauData.url;
                    }
                } catch (e) {
                    console.error("Tau JSON Error:", e);
                }
            }
        }
    } else {
        console.error("Tau Player not found in HTML");
    }

    return "";
}

// ------------------------------------------------------------------
// 5. HELPER: soraFetch (AnimeHeaven'dan alındı)
// ------------------------------------------------------------------
async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        // Önce uygulamanın native fetchv2'sini dene
        return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
    } catch(e) {
        try {
            // Olmazsa standart fetch'i dene (Fallback)
            return await fetch(url, options);
        } catch(error) {
            console.error("Fetch Error:", error);
            return null;
        }
    }
}
