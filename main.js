///////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////        Main Functions           //////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

const BASE_URL = "https://animecix.tv";
const TAU_BASE = "https://tau-video.xyz";

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        // Animecix API Search Endpoint
        const searchUrl = `${BASE_URL}/secure/search/${encodedKeyword}?limit=20`;
        
        const response = await fetchv2(searchUrl);
        // Animecix JSON döner, bu yüzden .json() deniyoruz.
        // Eğer uygulama .json() desteklemezse aşağıda catch'e düşer, text parse ederiz.
        const data = await response.json();

        const results = [];
        // API bazen array, bazen {results: []} dönebilir.
        const items = Array.isArray(data) ? data : (data.results || data.titles || []);

        for (const item of items) {
            // Görsel URL'ini düzeltme
            let img = item.poster || item.image || item.cover;
            if (img && !img.startsWith("http")) {
                img = img.startsWith("/") ? BASE_URL + img : img;
            }

            results.push({
                title: item.name || item.title || item.original_name,
                // href kısmına Detay API linkini saklıyoruz ki sonraki adımda kullanalım
                href: `${BASE_URL}/secure/titles/${item.id}`,
                image: img || "https://animecix.tv/storage/logo/logo.png"
            });
        }

        return JSON.stringify(results);
    }
    catch (error) {
        console.log('SearchResults function error: ' + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        // url değişkeni searchResults'dan gelen API linkidir
        const response = await fetchv2(url);
        const data = await response.json();

        const details = [];

        if (data) {
            details.push({
                description: data.description || data.plot || "Açıklama yok",
                aliases: data.original_name || "Bilinmiyor",
                airdate: data.year ? String(data.year) : "Bilinmiyor"
            });
        }

        return JSON.stringify(details);
    }
    catch (error) {
        console.log('Details error:' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Unknown',
            airdate: 'Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        // url yine detay API linkimiz
        const response = await fetchv2(url);
        const data = await response.json();

        const episodes = [];
        // Animecix yapısında videolar "videos" arrayinde gelir
        const videoList = data.videos || data.episodes || [];

        // Eğer dizi değil filmse ve videos boşsa
        if (videoList.length === 0 && data.video_id) {
             episodes.push({
                href: `${BASE_URL}/video/${data.video_id}`,
                number: 1,
                title: "Film / İzle"
            });
        } else {
            for (const vid of videoList) {
                episodes.push({
                    // href kısmına videonun sayfa linkini koyuyoruz (Stream aşamasında iframe arayacağız)
                    href: `${BASE_URL}/video/${vid.id}`,
                    number: parseFloat(vid.episode_number || vid.episode || vid.order || 0)
                });
            }
        }
        
        // Genellikle bölümler tersten gelir, düzeltelim
        return JSON.stringify(episodes.reverse());

    }
    catch (error) {
        console.log('Episodes error:' + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        // 1. Adım: Animecix video sayfasını HTML olarak çek (fetchv2 ile)
        const response = await fetchv2(url);
        const html = await response.text();

        // 2. Adım: Iframe içindeki Tau Video linkini Regex ile bul
        const tauRegex = /src="([^"]*tau-video[^"]*)"/;
        const tauMatch = tauRegex.exec(html);
        
        if (!tauMatch) {
            console.log("Tau player bulunamadı");
            return "https://error.org";
        }

        let tauUrl = tauMatch[1];
        if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;

        // 3. Adım: Tau API için Hash ve ID'yi ayıkla
        // URL Örneği: https://tau-video.xyz/embed/HASH?vid=ID
        const hashRegex = /\/embed\/([a-zA-Z0-9]+)/;
        const vidRegex = /vid=([0-9]+)/;

        const hashMatch = hashRegex.exec(tauUrl);
        const vidMatch = vidRegex.exec(tauUrl);

        if (hashMatch) {
            const apiHash = hashMatch[1];
            // URL'deki vid parametresini al, yoksa url'in sonundan almaya çalış
            const apiVid = vidMatch ? vidMatch[1] : url.split("/").pop();
            
            const tauApiUrl = `${TAU_BASE}/api/video/${apiHash}?vid=${apiVid}`;

            // 4. Adım: Tau API'den asıl video linkini (m3u8) al
            const tauResponse = await fetchv2(tauApiUrl);
            const tauData = await tauResponse.json();

            let finalUrl = "";

            if (tauData.list && tauData.list.length > 0) {
                // Genellikle ilk sıradaki veya 'Auto' olanı alırız
                finalUrl = tauData.list[0].url;
            } else if (tauData.url) {
                finalUrl = tauData.url;
            }
            
            return finalUrl;
        }

        return "https://error.org";

    }
    catch (error) {
        console.log('Stream URL error:' + error);
        return "https://error.org";
    }
}

////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////        Helper Functions       ////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////

// AnimeKai'den kalan yardımcılar, lazım olursa diye dursun.
function cleanJsonHtml(jsonHtml) {
    if (!jsonHtml) return "";
    return jsonHtml
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r');
}
