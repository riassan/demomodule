const BASE_URL = "https://animecix.tv";
const TAU_BASE = "https://tau-video.xyz";

// Standart Headerlar
const getHeaders = () => {
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://animecix.tv/",
        "Origin": "https://animecix.tv",
        "X-Requested-With": "XMLHttpRequest"
    };
};

/**
 * ARAMA FONKSİYONU
 * Log referansı: https://animecix.tv/secure/search/naruto?limit=20
 */
async function search(query) {
    const searchUrl = `${BASE_URL}/secure/search/${encodeURIComponent(query)}?limit=20`;
    
    try {
        const response = await fetch(searchUrl, { headers: getHeaders() });
        const data = await response.json(); // Doğrudan JSON döner
        
        // Gelen veride "results" veya direkt array olup olmadığını kontrol ediyoruz
        // Loglara göre array dönme ihtimali yüksek.
        const results = Array.isArray(data) ? data : (data.results || data.titles || []);

        return results.map(item => ({
            // Detay isteği için ID'yi URL kısmına saklıyoruz
            url: `${BASE_URL}/title/${item.id}`, 
            // Poster genellikle 'poster' veya 'image' fieldındadır
            image: item.poster || item.image || item.cover,
            title: item.name || item.title || item.original_name,
            // ID'yi context olarak da saklayabiliriz ama Sora URL sever
            type: "series" 
        }));
    } catch (e) {
        console.error("Arama hatası:", e);
        return [];
    }
}

/**
 * DETAY VE BÖLÜM LİSTESİ
 * Log referansı: https://animecix.tv/secure/titles/9207?titleId=9207
 */
async function getDetail(url) {
    // URL'den ID'yi çıkar: .../title/9207 -> 9207
    const id = url.split("/").pop();
    
    // API endpointi: /secure/titles/{id}
    const apiUrl = `${BASE_URL}/secure/titles/${id}`;
    
    try {
        const response = await fetch(apiUrl, { headers: getHeaders() });
        const data = await response.json();
        
        // Animecix API yapısında başlık bilgisi "title" veya obje kökünde olabilir.
        const title = data.name || data.title || "Bilinmeyen Başlık";
        const description = data.description || data.plot || "";
        const image = data.poster || data.cover || "";

        const episodes = [];

        // Bölüm listesi genellikle "videos", "episodes" veya "seasons" içinde gelir.
        // Animecix yapısında genellikle "videos" array'i bulunur.
        const videoList = data.videos || data.episodes || [];

        videoList.forEach(vid => {
            // Video ID'si önemli. Loglarda vid=714879 görülüyor.
            // Bu ID'yi video oynatıcıya göndereceğiz.
            const epNum = vid.episode_number || vid.episode || vid.order;
            episodes.push({
                name: `Bölüm ${epNum} - ${vid.name || ''}`,
                url: `${BASE_URL}/watch/${vid.id}`, // Video ID'sini buraya gömüyoruz
                date: vid.created_at || ""
            });
        });

        // Eğer filmse ve tek video varsa
        if (episodes.length === 0 && data.video_id) {
             episodes.push({
                name: "Film / Tek Bölüm",
                url: `${BASE_URL}/watch/${data.video_id}`,
                date: ""
            });
        }

        return {
            title: title,
            description: description,
            image: image,
            episodes: episodes.reverse() // Yeniden eskiye sıralıysa ters çevir
        };

    } catch (e) {
        console.error("Detay hatası:", e);
        return { title: "Hata", description: e.toString(), episodes: [] };
    }
}

/**
 * VİDEO KAYNAĞI (TAU VIDEO)
 * Log referansı: https://tau-video.xyz/api/video/67fab...?vid=714879
 */
async function getVideo(url) {
    // URL: .../watch/714879 -> 714879
    const videoId = url.split("/").pop();
    
    // 1. Adım: Animecix'ten Tau Video URL'sini almamız gerekebilir.
    // Ancak loglarda direkt Tau isteği var. Animecix muhtemelen video detayında iframe URL'i veriyor.
    // Biz önce Animecix'e bu video ID ile soralım.
    
    const animecixVideoUrl = `${BASE_URL}/secure/videos/${videoId}`; // Tahmini endpoint
    // Alternatif: Direkt Tau yapısını simüle etmek.
    
    try {
        // Animecix'in video bilgisini döndüğü endpointi çağırıyoruz (tahmini)
        // Eğer bu endpoint yoksa, yukarıdaki getDetail içindeki veride "embed_url" veya "code" aranmalı.
        // Varsayalım ki video detayını çekmemiz gerekiyor:
        
        /* Senaryo: Animecix bize direkt Tau URL'i vermiyor, bir iframe veriyor.
           Loglarda "tau-video.xyz/api/video/HASH?vid=ID" yapısı var.
           Bu HASH (67fab...) dinamik olabilir. Bunu bulmak için video sayfasına istek atıyoruz.
        */
        
        // Video sayfasının HTML'ini çekip iframe'i bulalım (En garanti yöntem)
        const htmlResponse = await fetch(`${BASE_URL}/video/${videoId}`, { headers: getHeaders() });
        const html = await htmlResponse.text();
        
        // Iframe içindeki Tau linkini bul: src="//tau-video.xyz/..."
        const tauMatch = html.match(/src="([^"]*tau-video[^"]*)"/);
        
        if (tauMatch) {
            let tauUrl = tauMatch[1];
            if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;
            
            // Şimdi Tau Video API'sine gidiyoruz.
            // Tau URL şuna benzer: https://tau-video.xyz/embed/HASH?vid=...
            // Bunu API call'a çevirelim: https://tau-video.xyz/api/video/HASH?vid=...
            
            // Embed URL'den Hash'i ve ID'yi ayıkla
            // Örn: .../embed/67fab6b5a1f1541a9c4030df?vid=714879
            const hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
            const vidMatch = tauUrl.match(/vid=([0-9]+)/);
            
            if (hashMatch) {
                const apiHash = hashMatch[1];
                const apiVid = vidMatch ? vidMatch[1] : videoId;
                
                const tauApiUrl = `${TAU_BASE}/api/video/${apiHash}?vid=${apiVid}`;
                
                // Tau API İsteği
                const tauResponse = await fetch(tauApiUrl, { 
                    headers: { "Referer": BASE_URL } 
                });
                const tauData = await tauResponse.json();
                
                // Tau JSON yanıtı genellikle { list: [ { url: "...", label: "1080p" } ] } döner
                const sources = [];
                
                if (tauData.list) {
                    tauData.list.forEach(v => {
                        sources.push({
                            url: v.url, // .m3u8 linki burada
                            label: v.label || "Auto",
                            type: v.url.includes(".m3u8") ? "hls" : "mp4"
                        });
                    });
                } else if (tauData.url) {
                     sources.push({
                        url: tauData.url,
                        label: "Auto",
                        type: "hls"
                    });
                }
                
                return sources;
            }
        }
        
        return [];
        
    } catch (e) {
        console.error("Video kaynağı hatası:", e);
        return [];
    }
}
