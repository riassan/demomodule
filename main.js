class AnimecixSource {
    constructor() {
        this.baseUrl = "https://animecix.tv";
        this.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://animecix.tv/",
            "Origin": "https://animecix.tv",
            "X-Requested-With": "XMLHttpRequest"
        };
    }

    // Arama
    async search(query) {
        const searchUrl = `${this.baseUrl}/secure/search/${encodeURIComponent(query)}?limit=20`;
        try {
            const response = await fetch(searchUrl, { headers: this.headers });
            const data = await response.json();
            const results = Array.isArray(data) ? data : (data.results || data.titles || []);

            return results.map(item => ({
                url: `${this.baseUrl}/title/${item.id}`,
                image: item.poster || item.image || item.cover,
                title: item.name || item.title || item.original_name,
                type: "series"
            }));
        } catch (e) {
            console.error("Search Error:", e);
            return [];
        }
    }

    // Detay
    async getDetail(url) {
        const id = url.split("/").pop();
        const apiUrl = `${this.baseUrl}/secure/titles/${id}`;
        
        try {
            const response = await fetch(apiUrl, { headers: this.headers });
            const data = await response.json();
            
            const title = data.name || data.title || "Bilinmeyen";
            const description = data.description || data.plot || "";
            const image = data.poster || data.cover || "";
            const episodes = [];
            const videoList = data.videos || data.episodes || [];

            videoList.forEach(vid => {
                const epNum = vid.episode_number || vid.episode || vid.order;
                episodes.push({
                    name: `Bölüm ${epNum}`,
                    url: `${this.baseUrl}/watch/${vid.id}`,
                    date: vid.created_at || ""
                });
            });

            if (episodes.length === 0 && data.video_id) {
                 episodes.push({
                    name: "Film / Tek Bölüm",
                    url: `${this.baseUrl}/watch/${data.video_id}`,
                    date: ""
                });
            }

            return {
                title: title,
                description: description,
                image: image,
                episodes: episodes.reverse()
            };
        } catch (e) {
            return { title: "Hata", description: e.message, episodes: [] };
        }
    }

    // Video Kaynağı
    async getVideo(url) {
        const videoId = url.split("/").pop();
        
        // Önce iframe HTML'ini çekip Tau URL'ini bulmaya çalışalım
        try {
            const htmlResponse = await fetch(`${this.baseUrl}/video/${videoId}`, { headers: this.headers });
            const html = await htmlResponse.text();
            
            const tauMatch = html.match(/src="([^"]*tau-video[^"]*)"/);
            
            if (tauMatch) {
                let tauUrl = tauMatch[1];
                if (tauUrl.startsWith("//")) tauUrl = "https:" + tauUrl;
                
                const hashMatch = tauUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
                const vidMatch = tauUrl.match(/vid=([0-9]+)/);
                
                if (hashMatch) {
                    const apiHash = hashMatch[1];
                    const apiVid = vidMatch ? vidMatch[1] : videoId;
                    const tauApiUrl = `https://tau-video.xyz/api/video/${apiHash}?vid=${apiVid}`;
                    
                    const tauResponse = await fetch(tauApiUrl, { 
                        headers: { "Referer": this.baseUrl } 
                    });
                    const tauData = await tauResponse.json();
                    
                    const sources = [];
                    if (tauData.list) {
                        tauData.list.forEach(v => {
                            sources.push({
                                url: v.url,
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
            console.error("Video Error:", e);
            return [];
        }
    }
}
