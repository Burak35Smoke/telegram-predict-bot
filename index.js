// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs/promises');
const { format: formatDateFn, parse: parseDateFn, subDays, isValid, startOfDay } = require('date-fns'); // date-fns'den ek fonksiyonlar

// Servisleri ve yardımcıları import et
const mackolikService = require('./services/mackolikService');
const geminiService = require('./services/geminiService');
const analysisService = require('./services/analysisService');
const { loadHistoricData, saveHistoricData, updateMatchFields } = require('./utils/dataStore'); // updateMatchFields'i de ekledik (ileride lazım olabilir)
// const { initializeDirectories } = require('./utils/helpers'); // Eğer helpers.js'e taşıdıysanız

// --- Ayarlar ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const historicDataPath = process.env.HISTORIC_DATA_FILE || './data/historic_matches.json';

if (!token) {
    console.error("Hata: TELEGRAM_BOT_TOKEN bulunamadı. .env dosyasını kontrol edin.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
let historicData = { matches: {}, last_update: null }; // Veriyi bellekte tutalım

// --- Yardımcı Fonksiyonlar (utils/helpers.js içine taşınabilir) ---
/**
 * Gerekli data dizinini oluşturur.
 */
async function initializeDirectoriesLocal() {
    const dataDir = path.dirname(historicDataPath);
    try {
        await fs.mkdir(dataDir, { recursive: true });
        console.log(`✅ Gerekli dizinler kontrol edildi/oluşturuldu: ${dataDir}`);
    } catch (error) {
        console.error("❌ Dizinler oluşturulurken hata:", error.message);
    }
}

/**
 * Bellekteki historicData içinde belirtilen takımlar arasındaki güncel (başlamamış) maçı bulur.
 * @param {string} teamA Takım A'nın adı (yaklaşık).
 * @param {string} teamB Takım B'nin adı (yaklaşık).
 * @returns {object|null} Bulunan maç objesi veya null.
 */
function findCurrentMatch(teamA, teamB) {
    const today = startOfDay(new Date()); // Bugünün başlangıcı
    const teamALower = teamA.toLowerCase();
    const teamBLower = teamB.toLowerCase();

    // Bugün ve sonraki 2 günü kontrol edelim (maçlar gece yarısını geçebilir)
    for (let i = 0; i < 3; i++) {
        const checkDate = new Date(today.getTime() + i * 86400000); // Gün ekle
        const dateStr = formatDateFn(checkDate, 'yyyy-MM-dd');
        const dailyMatches = historicData.matches[dateStr];

        if (dailyMatches && Array.isArray(dailyMatches)) {
            const foundMatch = dailyMatches.find(m =>
                m.status === 1 && // Sadece başlamamış maçlar
                (
                    (m.homeTeam.toLowerCase().includes(teamALower) && m.awayTeam.toLowerCase().includes(teamBLower)) ||
                    (m.homeTeam.toLowerCase().includes(teamBLower) && m.awayTeam.toLowerCase().includes(teamALower))
                )
            );
            if (foundMatch) {
                console.log(`ℹ️ Güncel maç bulundu (${dateStr}): ${foundMatch.homeTeam} vs ${foundMatch.awayTeam}`);
                return foundMatch;
            }
        }
    }
    console.log(`ℹ️ ${teamA} vs ${teamB} için güncel maç bulunamadı.`);
    return null; // Maç bulunamadı
}

// --- Bot Başlangıç ---
async function startBot() {
    console.log('🤖 Telegram Bot Başlatılıyor...');
    await initializeDirectoriesLocal(); // Dizinleri kontrol et/oluştur
    historicData = await loadHistoricData(historicDataPath); // Geçmiş veriyi yükle

    console.log('✅ Bot Başlatıldı!');
    if (historicData.last_update) {
        console.log(`ℹ️ Son veri güncelleme: ${historicData.last_update}`);
    } else {
        console.log("ℹ️ Henüz veri güncellemesi yapılmamış.");
    }

    // TODO: Otomatik güncelleyiciyi başlat (autoUpdater.js eklenecek)
    // const autoUpdater = require('./autoUpdater');
    // autoUpdater.startUpdater(60, historicDataPath, historicData); // Örnek: Saatte bir güncelle
}

startBot(); // Botu başlat

// --- Bot Komutları ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Merhaba ${msg.from.first_name}! Ben Maç Analiz Botu.
    \nVeri çekme ve analiz özellikleri için komutları kullanabilirsiniz.
    \n/help komutu ile yardım alabilirsiniz.
    \n⚠️ **UYARI:** Bu bot deneyseldir ve tahminler/analizler yatırım tavsiyesi değildir!`);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Kullanılabilir Komutlar:
/start - Botu başlatır.
/help - Bu yardım mesajını gösterir.
/fetch_matches <tarih> - Belirtilen tarihteki (YYYY-MM-DD) maçları çeker (Test amaçlı).
/analyze_pro <Takım A> vs <Takım B> - Belirtilen maç için hibrit (veri + AI) analiz yapar.
/force_update - (Yakında) Veri güncellemesini manuel tetikler.`); // Komut açıklaması güncellendi
});

// Test Komutu: Belirli bir tarihin maçlarını çek
bot.onText(/\/fetch_matches (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const dateInput = match[1]; // Kullanıcının girdiği tarih (YYYY-MM-DD)

    let dateToFetch = dateInput;
    // Tarih formatı kontrolü veya "bugün", "yarın" gibi anahtar kelimeler
    if (dateInput.toLowerCase() === 'bugün' || dateInput.toLowerCase() === 'today') {
        dateToFetch = formatDateFn(new Date(), 'yyyy-MM-dd');
    } else if (dateInput.toLowerCase() === 'yarın' || dateInput.toLowerCase() === 'tomorrow') {
        dateToFetch = formatDateFn(new Date(Date.now() + 86400000), 'yyyy-MM-dd');
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
        bot.sendMessage(chatId, "Lütfen tarihi YYYY-MM-DD formatında veya 'bugün', 'yarın' olarak girin (örn: /fetch_matches 2024-05-25).");
        return;
    }

    bot.sendMessage(chatId, `⏳ ${dateToFetch} tarihi için maçlar Mackolik'ten çekiliyor...`);

    const token = await mackolikService.getToken();
    if (!token) {
        bot.sendMessage(chatId, "❌ Mackolik token alınamadı, işlem iptal edildi.");
        return;
    }

    try {
        const matches = await mackolikService.getMatchesForDate(token, dateToFetch);

        if (matches && matches.length > 0) {
            let response = `✅ ${dateToFetch} tarihi için ${matches.length} maç bulundu:\n\n`;
            matches.slice(0, 15).forEach(m => { // Biraz daha fazla gösterelim
                response += `⚽ ${m.time || '??:??'} | ${m.league || 'Lig Yok'}\n   ${m.homeTeam || '?'} vs ${m.awayTeam || '?'}`;
                if (m.status === 3) {
                    response += ` (${m.result?.ftScore || '?'})`;
                    if (m.result?.htScore) {
                        response += ` (İY: ${m.result.htScore})`;
                    }
                }
                response += '\n\n';
            });
            if (matches.length > 15) {
                response += `...ve ${matches.length - 15} maç daha.\n`;
            }
            bot.sendMessage(chatId, response);

            // --- Test Amaçlı Veri Kaydetme (OPSİYONEL) ---
            // Dikkat: Bu kısım otomatik güncelleyici olmadan manuel test için.
            // Gerçek kullanımda güncelleme mantığı daha dikkatli olmalı.
            /*
            console.log(`   -> Test için ${dateToFetch} verisi belleğe ve dosyaya yazılıyor...`);
            if (!historicData.matches[dateToFetch]) {
                historicData.matches[dateToFetch] = [];
            }
            // Basitçe tüm listeyi güncelle (daha iyi birleştirme yapılabilir)
             const existingIds = new Set(historicData.matches[dateToFetch].map(m => m.id));
             let addedCount = 0;
             matches.forEach(newMatch => {
                 if (!existingIds.has(newMatch.id)) {
                     historicData.matches[dateToFetch].push(newMatch);
                     addedCount++;
                 } else {
                     // Güncelleme mantığı buraya gelebilir (updateMatchFields kullanarak)
                     const existingMatch = historicData.matches[dateToFetch].find(m => m.id === newMatch.id);
                     if (existingMatch) updateMatchFields(existingMatch, newMatch);
                 }
             });
             console.log(`   -> ${addedCount} yeni maç eklendi/güncellendi.`);
            historicData.last_update = new Date().toISOString();
            await saveHistoricData(historicData, historicDataPath);
            bot.sendMessage(chatId, `ℹ️ ${dateToFetch} verisi geçici olarak kaydedildi/güncellendi (Test).`);
            */
           // --- Test Amaçlı Veri Kaydetme Sonu ---


        } else {
            bot.sendMessage(chatId, `ℹ️ ${dateToFetch} tarihi için Mackolik'te maç bulunamadı veya çekilemedi.`);
        }
    } catch (error) {
        console.error("Maç çekme komutu hatası:", error);
        bot.sendMessage(chatId, `❌ Maçlar çekilirken bir hata oluştu: ${error.message}`);
    }
});

// ---- HİBRİT ANALİZ KOMUTU (/analyze_pro) ----
bot.onText(/\/analyze_pro (.+)\s+vs\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const teamA = match[1].trim();
    const teamB = match[2].trim();

    if (!teamA || !teamB) {
        bot.sendMessage(chatId, "Lütfen takımları doğru formatta girin. Örnek: /analyze_pro Fenerbahçe vs Galatasaray");
        return;
    }

    bot.sendMessage(chatId, `⏳ **${teamA} vs ${teamB}** maçı için hibrit analiz başlatılıyor...\n1️⃣ Benzer geçmiş maçlar aranıyor...\n2️⃣ Gemini AI analizi yapılıyor...`);

    // 1. Analiz edilecek güncel maçı bul (Bugün veya yarın için)
    const currentMatch = findCurrentMatch(teamA, teamB);

    if (!currentMatch) {
        bot.sendMessage(chatId, `❌ **${teamA} vs ${teamB}** maçı yakın zamanda (başlamamış olarak) bulunamadı.\n\n*Takım adlarını kontrol edin veya maç henüz bültende olmayabilir.*\n*Veri güncellemesi için /force_update (yakında) deneyebilirsiniz.*`);
        return;
    }
    if (!currentMatch.odds || Object.keys(currentMatch.odds).length === 0) {
        bot.sendMessage(chatId, `❌ **${currentMatch.homeTeam} vs ${currentMatch.awayTeam}** maçı bulundu ancak oran bilgisi eksik. Analiz yapılamıyor.`);
        return;
    }

    // 2. Benzer Oranlı Geçmiş Maç Analizi (Mackolik Verisi)
    let similarityStatsResult;
    try {
        console.log(`   -> Benzerlik analizi başlatılıyor...`);
        const similarMatches = analysisService.findSimilarMatches(currentMatch, historicData);
        similarityStatsResult = analysisService.calculateSimilarityStats(similarMatches);
        console.log(`   -> Benzerlik analizi tamamlandı.`);
    } catch (analysisError) {
        console.error("❌ Benzerlik analizi sırasında hata:", analysisError);
        bot.sendMessage(chatId, "❌ Benzerlik analizi sırasında bir hata oluştu.");
        // Hata olsa bile Gemini analizine devam etmeyi deneyebiliriz (ama bağlam eksik olur)
        similarityStatsResult = { summary: "Benzerlik analizi sırasında hata oluştu.", stats: {} };
    }


    // 3. Gemini İçin Bağlam Hazırla
    console.log(`   -> Gemini için bağlam hazırlanıyor...`);
    let geminiContext = `--- Analiz Bağlamı (${currentMatch.homeTeam} vs ${currentMatch.awayTeam}) ---\n`;
    geminiContext += `Tarih: ${currentMatch.date || '?'} ${currentMatch.time || '??:??'}\nLig: ${currentMatch.league || '?'}\n`;
    geminiContext += `\n**Güncel Oranlar (Referans):**\n`;
    // Temel oranları ekleyelim
    const odds = currentMatch.odds;
    geminiContext += `- MS: 1: ${odds['Maç Sonucu_1'] || '-'}, X: ${odds['Maç Sonucu_X'] || '-'}, 2: ${odds['Maç Sonucu_2'] || '-'}\n`;
    geminiContext += `- A/U 2.5: Alt: ${odds['A/U 2.5_Alt'] || '-'}, Üst: ${odds['A/U 2.5_Üst'] || '-'}\n`;
    geminiContext += `- KG: Var: ${odds['Karşılıklı Gol_Var'] || '-'}, Yok: ${odds['Karşılıklı Gol_Yok'] || '-'}\n`;
    geminiContext += `- IY: 1: ${odds['İlk Yarı_1'] || '-'}, X: ${odds['İlk Yarı_X'] || '-'}, 2: ${odds['İlk Yarı_2'] || '-'}\n`; // IY eklendi
    // ... (Diğer oranlar isteğe bağlı)

    geminiContext += `\n**Benzer Oranlı Geçmiş Maç İstatistikleri (${similarityStatsResult.summary}):**\n`;
    if (similarityStatsResult.stats && Object.keys(similarityStatsResult.stats).length > 0) {
        const stats = similarityStatsResult.stats;
        // Önemli marketleri ve en yüksek yüzdeli sonuçları gösterelim
        const addStatLine = (market, limit = 2) => {
            if (stats[market]) {
                const sortedOutcomes = Object.entries(stats[market])
                    .filter(([, data]) => data.total > 0) // Sadece eşleşme olanlar
                    .sort(([, a], [, b]) => b.percentage - a.percentage);
                if (sortedOutcomes.length > 0) {
                     geminiContext += `- ${market}:\n`;
                     sortedOutcomes.slice(0, limit).forEach(([outcome, data]) => {
                        geminiContext += `    * ${outcome}: ${data.realized}/${data.total} (%${data.percentage})\n`;
                     });
                }
            }
        };
        addStatLine("Maç Sonucu", 3); // MS için 3 sonucu da göster
        addStatLine("A/U 2.5", 2);
        addStatLine("Karşılıklı Gol", 2);
        addStatLine("İlk Yarı", 3); // IY için 3 sonucu da göster
        addStatLine("IY/MS", 3); // IY/MS için ilk 3
        // addStatLine("IY 1.5", 2);
        // addStatLine("EV 1.5", 2);
        // addStatLine("DEP 1.5", 2);
    } else if (!similarityStatsResult.summary.includes("hata")) {
        geminiContext += "- İstatistik bulunamadı veya hesaplanamadı.\n";
    } else {
         geminiContext += "- İstatistikler alınırken hata oluştu.\n";
    }

    // TODO: Takım formu ve H2H verisi ekleme (daha sonra)
    // console.log("   -> (TODO) Takım formu ve H2H verisi çekilecek...");
    // geminiContext += `\n**Takım Formları & H2H (Yakında):**\n- Bu veriler henüz eklenmedi.\n`;

    geminiContext += `--- Bağlam Sonu ---\n\n`;
    console.log(`   -> Gemini bağlamı hazırlandı.`);

    // 4. Gemini Analiz İstemi (Prompt'u biraz daha iyileştirebiliriz)
    const geminiPrompt = `
${geminiContext} Yukarıdaki veri bağlamını (güncel oranlar, benzer maç istatistikleri) ana referans alarak, ${currentMatch.homeTeam} vs ${currentMatch.awayTeam} futbol maçı için **DETAYLI ve MANTIKLI** bir analiz yaparak aşağıdaki bahis türlerinde tahminlerini belirt:

1.  **Maç Sonucu (MS):** ('1', 'X', '2')
2.  **İlk Yarı/Maç Sonucu (IY/MS):** ([X/1,..., 2/2])
3.  **İlk Yarı Sonucu (IY):** ('1', 'X', '2')
4.  **Toplam Gol 2.5 Alt/Üst:** ('Alt 2.5', 'Üst 2.5')
5.  **Karşılıklı Gol Var/Yok (KG):** ('Var', 'Yok')
6.  **Toplam Korner 9.5 Alt/Üst:** ('Alt 9.5', 'Üst 9.5') - *Bu tahmin için elinde yeterli veri olmadığını belirt ve daha spekülatif olduğunu vurgula.*

Her bir tahmin için:
*   **Teorik Güven Seviyesi:** Düşük, Orta, Yüksek olarak belirt.
*   **Gerekçe:** **SAĞLANAN BAĞLAMA (oranlar, istatistikler)** ve genel futbol bilgine dayanarak **1-2 cümlelik mantıklı bir açıklama** yap. Özellikle istatistiklerle çelişen veya destekleyen durumları belirt.

**Format Kuralları:**
*   **Sadece istenen formatta yanıt ver.** Başka hiçbir ek metin, giriş veya sonuç cümlesi kullanma.
*   Her tahmin ve gerekçesi ayrı satırlarda, belirtilen başlıklarla başlasın.

**Önemli Hatırlatma:** Bu analiz teoriktir, gerçek zamanlı etkenler dahil değildir ve finansal tavsiye niteliği taşımaz.

MS Tahmin: [1, X veya 2]
MS Güven: [Düşük, Orta veya Yüksek]
MS Gerekçe: [Bağlama dayalı kısa açıklama]

IY/MS Tahmin: [X/1,..., 2/2]
IY/MS Güven: [Düşük, Orta veya Yüksek]
IY/MS Gerekçe: [Bağlama dayalı kısa açıklama]

IY Sonucu Tahmin: [1, X veya 2]
IY Sonucu Güven: [Düşük, Orta veya Yüksek]
IY Sonucu Gerekçe: [Bağlama dayalı kısa açıklama]

Gol Tahmin: [Alt 2.5 veya Üst 2.5]
Gol Güven: [Düşük, Orta veya Yüksek]
Gol Gerekçe: [Bağlama dayalı kısa açıklama]

KG Tahmin: [Var veya Yok]
KG Güven: [Düşük, Orta veya Yüksek]
KG Gerekçe: [Bağlama dayalı kısa açıklama]

Korner Tahmin: [Alt 9.5 veya Üst 9.5]
Korner Güven: [Düşük]
Korner Gerekçe: [Korner verisi olmadığı için bu tahminin spekülatif olduğunu belirten kısa açıklama]
`;

    // 5. Gemini'ye Sor ve Yanıtı Al
    console.log(`   -> Gemini analizi isteniyor...`);
    const geminiResponseText = await geminiService.askGemini(geminiPrompt);
    let geminiAnalysis = { ms: {}, htft: {}, iy: {}, goal: {}, kg: {}, corner: {} }; // Varsayılan boş yapı
    let geminiError = false;
    if (geminiResponseText.includes("Hata:") || geminiResponseText.includes("filtrelere takıldı") || geminiResponseText.includes("alınamadı")) {
         console.error("   -> Gemini yanıtı alınırken hata oluştu veya içerik engellendi.");
         geminiError = true;
    } else {
        geminiAnalysis = geminiService.parseGeminiAnalysisResponse(geminiResponseText);
        console.log(`   -> Gemini yanıtı alındı ve ayrıştırıldı.`);
    }

    // 6. Sonucu Formatla ve Gönder
    console.log(`   -> Sonuç mesajı hazırlanıyor...`);
    let finalMessage = `📊 **${currentMatch.homeTeam} vs ${currentMatch.awayTeam} Hibrit Analizi** 📊\n`;
    finalMessage += `*(Tarih: ${currentMatch.date} ${currentMatch.time}, Lig: ${currentMatch.league})*\n\n`;

    // -- Bölüm 1: Benzer Oran İstatistikleri --
    finalMessage += `1️⃣ **Benzer Oranlı Geçmiş Maç İstatistikleri**\n`;
    finalMessage += `*(${similarityStatsResult.summary.replace(':', '')})*\n\n`; // Özeti ekle
    if (similarityStatsResult.stats && Object.keys(similarityStatsResult.stats).length > 0 && !similarityStatsResult.summary.includes("hata")) {
         const stats = similarityStatsResult.stats;
         const formatStatLine = (market, outcome) => {
             const data = stats[market]?.[outcome];
             // Sadece toplam maç sayısı 0'dan büyükse ve gerçekleşme varsa göster
             return data && data.total > 0 ? `   * ${outcome}: ${data.realized}/${data.total} (%${data.percentage})\n` : '';
         };

         if (stats["Maç Sonucu"]) {
              finalMessage += `*   **MS:** ${formatStatLine("Maç Sonucu", "1")}${formatStatLine("Maç Sonucu", "X")}${formatStatLine("Maç Sonucu", "2")}`.replace(/\n   \* /g,' '); // Tek satırda göster
              finalMessage += `\n`;
         }
         if (stats["A/U 2.5"]) {
              finalMessage += `*   **A/U 2.5:** ${formatStatLine("A/U 2.5", "Alt")}${formatStatLine("A/U 2.5", "Üst")}`.replace(/\n   \* /g,' ');
              finalMessage += `\n`;
         }
         if (stats["Karşılıklı Gol"]) {
              finalMessage += `*   **KG:** ${formatStatLine("Karşılıklı Gol", "Var")}${formatStatLine("Karşılıklı Gol", "Yok")}`.replace(/\n   \* /g,' ');
              finalMessage += `\n`;
         }
         if (stats["İlk Yarı"]) {
              finalMessage += `*   **İY:** ${formatStatLine("İlk Yarı", "1")}${formatStatLine("İlk Yarı", "X")}${formatStatLine("İlk Yarı", "2")}`.replace(/\n   \* /g,' ');
              finalMessage += `\n`;
         }
          if (stats["IY/MS"]) {
              const sortedHtFt = Object.entries(stats["IY/MS"])
                                   .filter(([,data]) => data.total > 0 && data.percentage > 0) // Sadece yüzdesi 0'dan büyük olanlar
                                   .sort(([,a],[,b]) => b.percentage - a.percentage);
              if(sortedHtFt.length > 0){
                  finalMessage += `*   **IY/MS (En Yüksek):**\n`;
                  sortedHtFt.slice(0, 2).forEach(([outcome, data]) => { // İlk 2'yi göster
                       finalMessage += `     * ${outcome}: ${data.realized}/${data.total} (%${data.percentage})\n`;
                  });
              }
         }
         finalMessage += `\n`; // Bölüm sonu boşluk

    } else {
        finalMessage += "*   Geçmiş benzer oranlı maç bulunamadı veya istatistik hesaplanamadı.\n\n";
    }

    // -- Bölüm 2: Gemini AI Analizi --
    finalMessage += `2️⃣ **Gemini AI Yorumu ve Tahminleri**\n`;
    finalMessage += `*(Verilen bağlama göre yapay zeka yorumu)*\n\n`;

    if(geminiError) {
        finalMessage += `*   ❌ Gemini AI yanıtı alınamadı veya bir hata oluştu.*\n*   Sebep: ${geminiResponseText}\n\n`;
    } else {
        const formatGeminiLine = (label, prediction, confidence, reason) => {
            let line = `*   **${label}:** \`${prediction || '?'}\``;
            if (confidence) line += ` (Güven: *${confidence}*)`;
            if (reason) line += `\n     *Gerekçe:* ${reason}\n`; else line += '\n';
            return line;
        };

        finalMessage += formatGeminiLine("MS", geminiAnalysis.ms.prediction, geminiAnalysis.ms.confidence, geminiAnalysis.ms.reason);
        finalMessage += formatGeminiLine("IY/MS", geminiAnalysis.htft.prediction, geminiAnalysis.htft.confidence, geminiAnalysis.htft.reason);
        finalMessage += formatGeminiLine("İY", geminiAnalysis.iy.prediction, geminiAnalysis.iy.confidence, geminiAnalysis.iy.reason);
        finalMessage += formatGeminiLine("Gol (2.5)", geminiAnalysis.goal.prediction, geminiAnalysis.goal.confidence, geminiAnalysis.goal.reason);
        finalMessage += formatGeminiLine("KG", geminiAnalysis.kg.prediction, geminiAnalysis.kg.confidence, geminiAnalysis.kg.reason);
        finalMessage += formatGeminiLine("Korner (9.5)", geminiAnalysis.corner.prediction, geminiAnalysis.corner.confidence, geminiAnalysis.corner.reason);
        finalMessage += `\n`; // Bölüm sonu boşluk
    }


    // -- Bölüm 3: Son Uyarılar --
    finalMessage += `3️⃣ **Önemli Uyarılar**\n`;
    finalMessage += `*   Bu analiz, istatistik ve yapay zeka yorumlarının birleşimidir; **garanti sunmaz.**\n`;
    finalMessage += `*   **Asla finansal tavsiye değildir!** Bahis oynamak risklidir.\n`;
    finalMessage += `*   Kararlarınızı kendi araştırmanızla destekleyin.\n`;
    finalMessage += `---`;

    // Mesajı gönder (çok uzunsa bölme gerekebilir - şimdilik tek parça)
    try {
         await bot.sendMessage(chatId, finalMessage, { parse_mode: "Markdown" });
         console.log(`   -> Analiz mesajı gönderildi: ${currentMatch.homeTeam} vs ${currentMatch.awayTeam}`);
    } catch (sendError) {
         console.error("   -> Mesaj gönderim hatası:", sendError.message);
         // Eğer mesaj çok uzunsa (Telegram limiti ~4096 karakter)
         if (sendError.response && sendError.response.body && sendError.response.body.description.includes('too long')) {
             console.warn("   -> Mesaj çok uzun, bölerek gönderme deneniyor...");
             try {
                 // Basit bölme: İstatistikler ve AI ayrı mesajlarda
                 const part1 = finalMessage.substring(0, finalMessage.indexOf('2️⃣ **Gemini AI Yorumu'));
                 const part2 = finalMessage.substring(finalMessage.indexOf('2️⃣ **Gemini AI Yorumu'));
                 await bot.sendMessage(chatId, part1, { parse_mode: "Markdown" });
                 await bot.sendMessage(chatId, part2, { parse_mode: "Markdown" });
                 console.log(`   -> Analiz mesajı 2 parça halinde gönderildi.`);
             } catch (splitSendError) {
                 console.error("   -> Bölünmüş mesaj gönderim hatası:", splitSendError.message);
                 bot.sendMessage(chatId, "❌ Analiz sonucu çok uzun olduğu için gönderilemedi.");
             }
         } else {
             // Başka bir gönderme hatası
              bot.sendMessage(chatId, "❌ Analiz sonucu gönderilirken bir hata oluştu.");
         }
    }


}); // /analyze_pro sonu


// --- Hata Yönetimi ---
bot.on('polling_error', (error) => { console.error(`Polling Hatası: ${error.code} - ${error.message}`); });
bot.on('webhook_error', (error) => { console.error(`Webhook Hatası: ${error.code} - ${error.message}`); });
process.on('uncaughtException', (error) => { console.error('Beklenmeyen Hata Yakalandı:', error); });
process.on('unhandledRejection', (reason, promise) => { console.error('İşlenmeyen Promise Reddi:', reason); });

// Dizin oluşturma (Eğer helpers.js kullanılmıyorsa)
async function initializeDirectoriesLocal() {
    const dataDir = path.dirname(historicDataPath);
    try {
        await fs.mkdir(dataDir, { recursive: true });
        console.log(`✅ Gerekli dizinler kontrol edildi/oluşturuldu: ${dataDir}`);
    } catch (error) {
        console.error("❌ Dizinler oluşturulurken hata:", error.message);
    }
}
