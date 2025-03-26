// services/mackolikService.js
const axios = require('axios');
const { format, utcToZonedTime } = require('date-fns-tz'); // Saat dilimi dönüşümü için

const TOKEN_URL = "https://www.mackolik.com/ajax/middleware/token";
const BULLETIN_API_URL = "https://api.mackolikfeeds.com/betting-service/bulletin/sport/1";
const MATCHES_API_URL = "https://api.mackolikfeeds.com/api/matches/";

const API_HEADERS = {
    "Host": "api.mackolikfeeds.com",
    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 12; SM-G991B Build/SP1A.210812.016)",
    "Connection": "Keep-Alive",
    "Accept": "*/*",
    "Accept-Encoding": "gzip",
    "X-Authorization": "token true",
};

const marketTypeMapping = {
    1: "Maç Sonucu", 3: "İlk Yarı", 6: "Karşılıklı Gol", 8: "IY/MS",
    10: "A/U 2.5", 11: "IY 1.5", 13: "Toplam Gol", 14: "EV 1.5",
    15: "DEP 1.5", /* 16: "Maç Sonucu A/U" - Python'da var ama parse edilmemiş, ekleyebiliriz */
};

/**
 * Mackolik API için token alır.
 * @returns {Promise<string|null>} Token veya hata durumunda null.
 */
async function getToken() {
    try {
        console.log("🔄 Mackolik token alınıyor...");
        const response = await axios.get(TOKEN_URL);
        const token = response.data?.data?.token;
        if (token) {
            console.log("✅ Mackolik token alındı.");
            return token;
        } else {
            console.error("❌ Mackolik token alınamadı. Yanıt:", response.data);
            return null;
        }
    } catch (error) {
        console.error("❌ Mackolik token alınırken hata:", error.message);
        return null;
    }
}

/**
 * API yanıtından saat bilgisini alır ve Türkiye saatine (+3 UTC) çevirir.
 * @param {object} matchData API'den gelen maç verisi (time veya match_time içermeli).
 * @returns {string} HH:MM formatında saat veya "00:00".
 */
function getMatchTimeTR(matchData) {
    const matchTime = matchData?.match_time || matchData?.time;
    if (matchTime && typeof matchTime === 'string' && matchTime.includes(':')) {
        try {
            const [hour, minute] = matchTime.split(':').map(Number);
            // Saati UTC olarak kabul edip +3 ekleyerek Türkiye saatine çevirelim
            // Not: Bu varsayım API'nin saati UTC verdiği varsayımına dayanır.
            // Eğer API yerel saat veriyorsa bu dönüşüm yanlış olabilir. Test etmek gerekir.
            // Şimdilik basitçe +3 ekleyelim:
            let trHour = (hour + 3) % 24;
            return `${String(trHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

            /* Daha doğru timezone dönüşümü için date-fns-tz:
            const now = new Date();
            const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
            const zonedDate = utcToZonedTime(utcDate, 'Europe/Istanbul');
            return format(zonedDate, 'HH:mm', { timeZone: 'Europe/Istanbul' });
            */

        } catch (e) {
            console.warn(`Saat parse hatası: ${matchTime}`, e.message);
            return "00:00";
        }
    }
    return "00:00";
}

/**
 * Belirli bir tarihteki maçları Mackolik API'lerinden çeker.
 * @param {string} token Mackolik API token.
 * @param {string} date YYYY-MM-DD formatında tarih.
 * @returns {Promise<Array<object>>} Maç verileri listesi.
 */
async function getMatchesForDate(token, date) {
    console.log(`🔄 ${date} tarihi için maçlar çekiliyor...`);
    const bulletinUrl = `${BULLETIN_API_URL}?date=${date}&tz=3&language=tr&real_country=tr&application=com.kokteyl.mackolik&migration_status=perform`;
    const matchesUrl = `${MATCHES_API_URL}?language=tr&country=tr&add_playing=1&extended_period=1&date=${date}&tz=3.0&application=com.kokteyl.mackolik&migration_status=perform`;
    const headers = { ...API_HEADERS, "X-RequestToken": token };

    const matches = [];
    const matchDetailsMap = new Map(); // Maç detaylarını (skorlar vs.) saklamak için

    try {
        // 1. Maç Detaylarını (Skorlar, Gerçek Durum) Çek
        console.log(`   -> Detaylar alınıyor (${matchesUrl})...`);
        const detailsResponse = await axios.get(matchesUrl, { headers });

        if (detailsResponse.status === 200 && detailsResponse.data?.data?.areas) {
            for (const area of detailsResponse.data.data.areas) {
                for (const competition of area.competitions) {
                    for (const match of competition.matches) {
                        if (match.id && match.status !== "Postponed") { // Ertelenmişleri atla
                            matchDetailsMap.set(match.id.toString(), { // ID'yi string yapalım
                                htScoreA: match.hts_A,
                                htScoreB: match.hts_B,
                                ftScoreA: match.fts_A,
                                ftScoreB: match.fts_B,
                                statusApi: match.status, // API'deki durum (örn: "Played")
                                timeApi: match.time,
                                matchTimeApi: match.match_time,
                            });
                        }
                    }
                }
            }
            console.log(`   -> ${matchDetailsMap.size} maç detayı bulundu.`);
        } else {
            console.warn(`   -> Maç detayları alınamadı veya boş. Durum: ${detailsResponse.status}`);
        }

        // 2. Bülten Verilerini (Oranlar, Takımlar) Çek
        console.log(`   -> Bülten alınıyor (${bulletinUrl})...`);
        const bulletinResponse = await axios.get(bulletinUrl, { headers });

        if (bulletinResponse.status === 200 && bulletinResponse.data?.data?.soccer) {
            for (const area of bulletinResponse.data.data.soccer) {
                const leagueName = area.title;
                for (const match of area.matches) {
                    const matchId = match.id?.toString(); // ID'yi string yapalım

                    // Ertelenmiş (status=5) veya detaylarda bulunmayanları atla
                    if (match.status === 5 || !matchId || !matchDetailsMap.has(matchId)) {
                        continue;
                    }

                    const details = matchDetailsMap.get(matchId);

                    // Maç verisini yapılandır
                    const matchData = {
                        id: matchId,
                        uuid: match.uuid,
                        league: leagueName,
                        date: date,
                        time: getMatchTimeTR(details), // Detay API'sinden gelen saati kullan
                        homeTeam: match.team_A,
                        awayTeam: match.team_B,
                        status: (details.statusApi === "Played" || match.status === 3) ? 3 : 1, // 3: Bitti, 1: Başlamadı
                        result: {
                            ftScore: (details.ftScoreA !== null && details.ftScoreB !== null) ? `${details.ftScoreA}-${details.ftScoreB}` : null,
                            htScore: (details.htScoreA !== null && details.htScoreB !== null) ? `${details.htScoreA}-${details.htScoreB}` : null,
                            // Python kodunda olmayan ama API'de olan skorları da ekledik
                            ftScoreA: details.ftScoreA,
                            ftScoreB: details.ftScoreB,
                            htScoreA: details.htScoreA,
                            htScoreB: details.htScoreB,
                        },
                        odds: {}
                    };

                    // Oranları işle
                    for (const market of match.markets || []) {
                        const marketType = marketTypeMapping[market.i];
                        if (!marketType) continue;

                        // İlk oran setini al (genellikle tek set olur)
                        const firstOddsSet = market.o?.[0]?.l;
                        if (firstOddsSet) {
                            for (const outcome of firstOddsSet) {
                                // Anahtar formatı: MarketTipi_Sonuc (örn: Maç Sonucu_1, A/U 2.5_Üst)
                                const key = `${marketType}_${outcome.n}`;
                                matchData.odds[key] = outcome.v;
                            }
                        }
                    }
                    matches.push(matchData);
                }
            }
            console.log(`✅ ${date}: Toplam ${matches.length} maç işlendi.`);
        } else {
            console.warn(`   -> Bülten verisi alınamadı veya boş. Durum: ${bulletinResponse.status}`);
        }

    } catch (error) {
        console.error(`❌ ${date} tarihi için Mackolik verisi alınırken hata:`, error.message);
        if (error.response) {
            console.error("   -> Hata Detayı:", error.response.status, error.response.data);
        }
    }

    // Lig ve saate göre sırala (Python'daki gibi)
    return matches.sort((a, b) => {
        const leagueCompare = (a.league || "").localeCompare(b.league || "");
        if (leagueCompare !== 0) return leagueCompare;
        return (a.time || "00:00").localeCompare(b.time || "00:00");
    });
}

module.exports = {
    getToken,
    getMatchesForDate,
};
