// Global Sabitler
const BASE_URL = "https://animecix.tv";
const TAU_BASE = "https://tau-video.xyz";

// Headers tanımları (Animecix isteği reddetmesin diye)
const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://animecix.tv/",
    "X-Requested-With": "XMLHttpRequest"
};

//////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////        Main Functions           //////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////

// 1. ARAMA FONKSİYONU
async function searchResults(keyword) {
    try {
        const searchUrl = `${BASE_URL}/secure/search/${encodeURIComponent(keyword)}?limit=20`;
        // Sulfur fetch yapısına uygun çağırma
        const response = await fetch(searchUrl, { method: "GET", headers: headers });
        // Demo koduna göre response string/json gelebilir, parse ediyoruz
        const data = JSON.parse(response); 

        const results = [];
        const items = Array.isArray(data) ? data : (data.results || []);

        for (const item of items) {
            results.push({
                title: item.name || item.title || item.original_name,
                // href kısmına ID'yi veya tam API linkini saklıyoruz
                href: `${BASE_URL}/secure/titles/${item.id}`,
                image: item.poster || item.image || item.cover || ""
            });
        }

        return JSON.stringify(results);

    } catch (error) {
        console.log('Search error:' + error);
        return JSON.stringify([{ title: 'Hata', image: '', href: '' }]);
    }
}

// 2. DETAY FONKSİYONU (Açıklama vb.)
async function extractDetails(url) {
    try {
        // url değişkeni searchResults'dan gelen "href" değeridir
        const response = await fetch(url, { method: "GET", headers: headers });
        const data = JSON.parse(response);

        const transformedResults = [{
            description: data.description || data.plot || 'Açıklama yok',
            aliases: data.original_name || '',
            airdate: data.year ? String(data.year) : 'Bilinmiyor'
        }];

        return JSON.stringify(transformedResults);

    } catch (error) {
        console.log('Details error:' + error);
        return JSON.stringify([{
            description: 'Detay yüklenemedi',
            aliases: '',
            airdate: ''
        }]);
    }
}

// 3. BÖLÜM LİSTESİ
async function extractEpisodes(url) {
    try {
        // url yine detay API linkimiz
        const response = await fetch(url, { method: "GET", headers: headers });
        const data = JSON.parse(response);

        const episodes = [];
        const videoList = data.videos || data.episodes || [];

        // Videoları listeye ekle
        // Not: Sulfur bölüm sıralaması için 'number' alanına bakıyor olabilir
        videoList.forEach((vid) => {
            episodes.push({
                number: vid.episode_number || vid.episode || vid.order,
                // href kısmına videonun ID'sini veya izleme linkini saklıyoruz
                href: `${BASE_URL}/video/${vid.id}`, 
                title: vid.name || `Bölüm ${vid.episode_number}`
            });
        });

        // Eğer dizi değil filmse ve videos listesi boşsa
        if (episodes.length === 0 && data.video_id) {
             episodes.push({
                number: 1,
                href: `${BASE_URL}/video/${data.video_id}`,
                title: "Film / İzle"
            });
        }

        // Genellikle bölümler tersten gelir, düzeltelim
        return JSON.stringify(episodes.reverse());

    } catch (error) {
        console.log('Episodes error:' + error);
        return JSON.stringify([{ number: 'Error', href: '' }]);
    }
}

// 4. STREAM URL (VİDEO ÇÖZME)
async function extractStreamUrl(url) {
    try {
        // 1. Adım: Animecix video sayfasını al (Iframe'i bulmak için)
        // url: https://animecix.tv/video/12345
        const htmlResponse = await fetch(url, { method: "GET", headers: headers });
        // Demo koduna göre htmlResponse direkt string olabilir
        const html = htmlResponse; 

        // 2. Adım: Iframe içindeki Tau Video linkini Regex ile bul
        const tauMatch = html.match(/src="([^"]*tau-video[^"]*)"/);
        
        if (!tauMatch) {
            console.log("Tau player bulunamadı");
            return "";
        }

        let tauUrl = tauMatch[1];
        if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;

        // 3. Adım: Tau API için Hash ve ID'yi ayıkla
        // URL Örneği: https://tau-video.xyz/embed/HASH?vid=ID
        const hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
        const vidMatch = tauUrl.match(/vid=([0-9]+)/);

        if (hashMatch) {
            const apiHash = hashMatch[1];
            // URL'deki vid parametresini al, yoksa url'in sonundan almaya çalış
            const apiVid = vidMatch ? vidMatch[1] : url.split("/").pop();
            
            const tauApiUrl = `${TAU_BASE}/api/video/${apiHash}?vid=${apiVid}`;

            // 4. Adım: Tau API'den asıl video linkini (m3u8) al
            const tauResponse = await fetch(tauApiUrl, { 
                method: "GET",
                headers: { "Referer": BASE_URL } 
            });
            const tauData = JSON.parse(tauResponse);

            let finalUrl = "";

            if (tauData.list && tauData.list.length > 0) {
                // Genellikle ilk sıradaki veya 'Auto' olanı alırız
                finalUrl = tauData.list[0].url;
            } else if (tauData.url) {
                finalUrl = tauData.url;
            }

            // Sulfur demo'suna göre direkt string URL dönmeli
            return finalUrl;
        }

        return "";

    } catch (error) {
        console.log('Stream URL error:' + error);
        return "";
    }
}
