// services/analysisService.js
const { parse, differenceInDays, format } = require('date-fns'); // Tarih işlemleri için

const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || 0.05);
const MIN_SIMILAR_CATEGORIES = parseInt(process.env.MIN_SIMILAR_CATEGORIES || 3, 10);
// const MIN_FLEXIBLE_MATCHES = 3; // Python'daki IY/MS gibi esnek eşleşme sayısı (şimdilik kullanmıyoruz, basitleştirelim)

// --- Yardımcı Fonksiyonlar (Analize Özel) ---

/**
 * Skor string'ini (örn: "2-1") sayısal [evGol, deplasmanGol] dizisine çevirir.
 * @param {string|null} scoreStr Skor string'i.
 * @returns {Array<number|null>} [evGol, deplasmanGol] veya [null, null].
 */
function parseScore(scoreStr) {
    if (!scoreStr || typeof scoreStr !== 'string' || scoreStr.trim() === '-' || scoreStr.trim() === '- - -' || scoreStr.includes('None')) {
        return [null, null];
    }
    try {
        const parts = scoreStr.split('-').map(s => s.trim());
        if (parts.length !== 2) return [null, null];
        const home = parseInt(parts[0], 10);
        const away = parseInt(parts[1], 10);
        if (isNaN(home) || isNaN(away)) return [null, null];
        return [home, away];
    } catch (e) {
        return [null, null];
    }
}

/**
 * Verilen skorlara göre maç sonucunu ('1', 'X', '2') döndürür.
 * @param {number|null} homeGoals Ev sahibi gol sayısı.
 * @param {number|null} awayGoals Deplasman gol sayısı.
 * @returns {string|null} '1', 'X', '2' veya skorlar geçersizse null.
 */
function getMatchResult(homeGoals, awayGoals) {
    if (homeGoals === null || awayGoals === null) return null;
    if (homeGoals > awayGoals) return '1';
    if (homeGoals === awayGoals) return 'X';
    return '2';
}

/**
 * Toplam gol sayısını döndürür.
 * @param {number|null} homeGoals Ev sahibi gol sayısı.
 * @param {number|null} awayGoals Deplasman gol sayısı.
 * @returns {number|null} Toplam gol veya skorlar geçersizse null.
 */
function getTotalGoals(homeGoals, awayGoals) {
     if (homeGoals === null || awayGoals === null) return null;
     return homeGoals + awayGoals;
}

/**
 * Karşılıklı gol olup olmadığını kontrol eder.
 * @param {number|null} homeGoals Ev sahibi gol sayısı.
 * @param {number|null} awayGoals Deplasman gol sayısı.
 * @returns {boolean|null} KG Varsa true, Yoksa false, skor geçersizse null.
 */
function isKgVar(homeGoals, awayGoals) {
    if (homeGoals === null || awayGoals === null) return null;
    return homeGoals > 0 && awayGoals > 0;
}

/**
 * Belirtilen çizginin üstünde mi altında mı gol olduğunu kontrol eder.
 * @param {number|null} totalGoals Toplam gol sayısı.
 * @param {number} line Gol çizgisi (örn: 2.5).
 * @returns {'Üst'|'Alt'|null} Sonuç veya toplam gol geçersizse null.
 */
function getOverUnder(totalGoals, line) {
    if (totalGoals === null) return null;
    return totalGoals > line ? 'Üst' : 'Alt';
}

/**
 * IY/MS sonucunu döndürür.
 * @param {number|null} htHome HT Ev Gol.
 * @param {number|null} htAway HT Dep Gol.
 * @param {number|null} ftHome FT Ev Gol.
 * @param {number|null} ftAway FT Dep Gol.
 * @returns {string|null} Örn: "1/X", "2/2" veya skorlar geçersizse null.
 */
function getHtFtResult(htHome, htAway, ftHome, ftAway) {
    const htResult = getMatchResult(htHome, htAway);
    const ftResult = getMatchResult(ftHome, ftAway);
    if (!htResult || !ftResult) return null;
    return `${htResult}/${ftResult}`;
}

// --- Ana Analiz Fonksiyonları ---

/**
 * Belirli bir maç için geçmiş verilerde benzer oranlı maçları bulur.
 * @param {object} currentMatch Analiz edilecek güncel maç objesi (oranlar dahil).
 * @param {object} historicData Tüm geçmiş maç verileri ({ matches: { 'YYYY-MM-DD': [...] } }).
 * @returns {Array<object>} Bulunan benzer geçmiş maçların listesi (detaylarla).
 */
function findSimilarMatches(currentMatch, historicData) {
    console.log(`🔍 ${currentMatch.homeTeam} vs ${currentMatch.awayTeam} için benzer maçlar aranıyor...`);
    const similarMatches = [];
    const todayOdds = currentMatch.odds || {};

    if (Object.keys(todayOdds).length === 0) {
        console.warn("   -> Uyarı: Analiz edilecek maçın oranları bulunamadı.");
        return [];
    }

    // Hangi market tiplerini karşılaştıracağımızı belirleyelim (Python'daki gibi)
    const marketsToCompare = [
        "Maç Sonucu", "İlk Yarı", "Karşılıklı Gol", "A/U 2.5",
        "IY 1.5", "EV 1.5", "DEP 1.5", "IY/MS", "Toplam Gol"
    ];

    // Tüm geçmiş maçları düz bir listeye alalım
    const allPastMatches = Object.values(historicData.matches || {}).flat();

    console.log(`   -> Toplam ${allPastMatches.length} geçmiş maç taranacak.`);

    for (const pastMatch of allPastMatches) {
        // Sadece bitmiş (status=3) ve oranları olan geçmiş maçları dikkate al
        if (pastMatch.status !== 3 || !pastMatch.odds || Object.keys(pastMatch.odds).length === 0) {
            continue;
        }

        const pastOdds = pastMatch.odds;
        let matchedCategories = 0;
        const matchedOddsDetails = {};

        for (const marketType of marketsToCompare) {
            const outcomes = Object.keys(todayOdds).filter(k => k.startsWith(`${marketType}_`));
            if (outcomes.length === 0) continue; // Bu market bugünkü maçta yok

            let allOutcomesMatch = true;
            let marketDetails = [];
            let validOddsCount = 0; // Bu markette kaç tane oran karşılaştırılabildi?

            for (const key of outcomes) {
                const todayOdd = todayOdds[key];
                const pastOdd = pastOdds[key];

                // Her iki oran da geçerli bir sayı mı?
                if (typeof todayOdd === 'number' && typeof pastOdd === 'number' && !isNaN(todayOdd) && !isNaN(pastOdd)) {
                    validOddsCount++;
                    const difference = Math.abs(todayOdd - pastOdd);
                    if (difference <= SIMILARITY_THRESHOLD) {
                        marketDetails.push({
                            outcome: key.substring(marketType.length + 1), // Sadece sonucu al (örn: "1", "Üst")
                            today: todayOdd,
                            historical: pastOdd,
                            difference: difference,
                        });
                    } else {
                        allOutcomesMatch = false; // Bir oran bile eşleşmiyorsa bu kategori eşleşmedi
                        break; // Bu marketi kontrol etmeyi bırak
                    }
                } else {
                    // Eğer bir oran eksikse, bu kategorinin tam eşleştiğini söyleyemeyiz
                    // Ancak IY/MS gibi bazı marketlerde esneklik isteyebiliriz
                    // Şimdilik basit tutalım: Eğer bir oran eksikse eşleşme sayılmaz.
                    allOutcomesMatch = false;
                    break;
                }
            }

            // Eğer marketteki tüm geçerli oranlar eşleştiyse ve en az 1 oran varsa
            if (allOutcomesMatch && validOddsCount > 0 && marketDetails.length === validOddsCount) {
                 matchedCategories++;
                 matchedOddsDetails[marketType] = marketDetails;
            }
             // TODO: Python'daki gibi min_flexible_matches mantığını buraya ekle (IY/MS için)
             // Şimdilik sadece tam eşleşen kategorileri sayıyoruz.
        }

        // Yeterli sayıda kategori eşleştiyse, bu maçı benzer olarak ekle
        if (matchedCategories >= MIN_SIMILAR_CATEGORIES) {
            similarMatches.push({
                todayMatch: `${currentMatch.homeTeam} vs ${currentMatch.awayTeam}`,
                pastMatch: `${pastMatch.homeTeam} vs ${pastMatch.awayTeam}`,
                pastDate: pastMatch.date,
                pastLeague: pastMatch.league || '-',
                pastFtScore: pastMatch.result?.ftScore || null,
                pastHtScore: pastMatch.result?.htScore || null,
                matchedOdds: matchedOddsDetails,
                matchedCategoryCount: matchedCategories
            });
        }
    }

    console.log(`   -> ${similarMatches.length} benzer maç bulundu (Eşik: ${SIMILARITY_THRESHOLD}, Min Kategori: ${MIN_SIMILAR_CATEGORIES}).`);
    // Eşleşen kategori sayısına göre sırala (en çok eşleşen en üstte)
    return similarMatches.sort((a, b) => b.matchedCategoryCount - a.matchedCategoryCount);
}

/**
 * Benzer maç listesinden istatistikler hesaplar.
 * @param {Array<object>} similarMatches `findSimilarMatches` tarafından döndürülen liste.
 * @returns {object} Hesaplanan istatistikler objesi.
 */
function calculateSimilarityStats(similarMatches) {
    if (!similarMatches || similarMatches.length === 0) {
        return { summary: "Benzer maç bulunamadığı için istatistik hesaplanamadı.", stats: {} };
    }

    const stats = {};
    const matchCount = similarMatches.length;

    // Hangi marketler için istatistik hesaplayacağımızı tanımla
    const marketsToAnalyze = {
        "Maç Sonucu": ['1', 'X', '2'],
        "İlk Yarı": ['1', 'X', '2'],
        "Karşılıklı Gol": ['Var', 'Yok'],
        "A/U 2.5": ['Üst', 'Alt'],
        "IY 1.5": ['Üst', 'Alt'],
        "EV 1.5": ['Üst', 'Alt'], // Ev Sahibi 1.5 Alt/Üst
        "DEP 1.5": ['Üst', 'Alt'], // Deplasman 1.5 Alt/Üst
        "IY/MS": ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"],
        // "Toplam Gol": ["0-1", "2-3", "4-5", "6+"] // İsteğe bağlı eklenebilir
    };

    // İstatistik yapısını başlat
    for (const marketType in marketsToAnalyze) {
        stats[marketType] = {};
        for (const outcome of marketsToAnalyze[marketType]) {
            stats[marketType][outcome] = { realized: 0, total: matchCount }; // Her sonucun başlangıç total'i maç sayısıdır
        }
    }

    // Benzer maçları işle
    for (const match of similarMatches) {
        const [ftHome, ftAway] = parseScore(match.pastFtScore);
        const [htHome, htAway] = parseScore(match.pastHtScore);

        // Geçerli skorlar yoksa bu maçı atla
        if (ftHome === null || ftAway === null) continue;

        const totalGoals = getTotalGoals(ftHome, ftAway);
        const htTotalGoals = getTotalGoals(htHome, htAway);

        // Maç Sonucu
        const msResult = getMatchResult(ftHome, ftAway);
        if (msResult && stats["Maç Sonucu"][msResult]) {
            stats["Maç Sonucu"][msResult].realized++;
        }

        // Karşılıklı Gol
        const kgResult = isKgVar(ftHome, ftAway);
        if (kgResult !== null && stats["Karşılıklı Gol"]) {
            const kgOutcome = kgResult ? 'Var' : 'Yok';
            if(stats["Karşılıklı Gol"][kgOutcome]) {
                stats["Karşılıklı Gol"][kgOutcome].realized++;
            }
        }

        // A/U 2.5
        const au25Result = getOverUnder(totalGoals, 2.5);
        if (au25Result && stats["A/U 2.5"] && stats["A/U 2.5"][au25Result]) {
            stats["A/U 2.5"][au25Result].realized++;
        }

        // EV 1.5
        const ev15Result = getOverUnder(ftHome, 1.5);
        if (ev15Result && stats["EV 1.5"] && stats["EV 1.5"][ev15Result]) {
            stats["EV 1.5"][ev15Result].realized++;
        }

        // DEP 1.5
        const dep15Result = getOverUnder(ftAway, 1.5);
        if (dep15Result && stats["DEP 1.5"] && stats["DEP 1.5"][dep15Result]) {
            stats["DEP 1.5"][dep15Result].realized++;
        }

        // --- İlk Yarı İstatistikleri (HT skoru varsa) ---
        if (htHome !== null && htAway !== null) {
            // İlk Yarı Sonucu
            const iyResult = getMatchResult(htHome, htAway);
            if (iyResult && stats["İlk Yarı"][iyResult]) {
                stats["İlk Yarı"][iyResult].realized++;
            }

            // IY 1.5
            const iy15Result = getOverUnder(htTotalGoals, 1.5);
            if (iy15Result && stats["IY 1.5"] && stats["IY 1.5"][iy15Result]) {
                stats["IY 1.5"][iy15Result].realized++;
            }

            // IY/MS
            const htftResult = getHtFtResult(htHome, htAway, ftHome, ftAway);
            if (htftResult && stats["IY/MS"][htftResult]) {
                stats["IY/MS"][htftResult].realized++;
            }
        }
    }

    // Yüzdeleri hesapla
    for (const marketType in stats) {
        for (const outcome in stats[marketType]) {
            const data = stats[marketType][outcome];
            data.percentage = data.total > 0 ? parseFloat(((data.realized / data.total) * 100).toFixed(1)) : 0;
        }
        // Yüzdeye göre sırala (opsiyonel)
        // stats[marketType] = Object.entries(stats[marketType])
        //     .sort(([, a], [, b]) => b.percentage - a.percentage)
        //     .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
    }


    return {
        summary: `Geçmiş ${matchCount} benzer oranlı maça göre istatistikler:`,
        stats: stats,
        similarMatchesFound: similarMatches // Ham listeyi de döndürelim, belki Gemini'ye veririz
    };
}

module.exports = {
    findSimilarMatches,
    calculateSimilarityStats,
    parseScore, // Diğer modüllerin ihtiyacı olabilir
    // Diğer yardımcı fonksiyonları da dışa aktarabiliriz
};
