// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs/promises');

const mackolikService = require('./services/mackolikService');
const { loadHistoricData, saveHistoricData } = require('./utils/dataStore'); // dataStore'dan fonksiyonları import et
const { initializeDirectories } = require('./utils/helpers'); // Dizin oluşturma fonksiyonu (aşağıda tanımlanacak)

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
 * Gerekli data ve analiz dizinlerini oluşturur.
 */
async function initializeDirectoriesLocal() {
    const dataDir = path.dirname(historicDataPath);
    // const analysisDir = path.join(path.dirname(dataDir), 'Analizler'); // Python'daki gibi
    try {
        await fs.mkdir(dataDir, { recursive: true });
        // await fs.mkdir(analysisDir, { recursive: true });
        console.log(`✅ Gerekli dizinler kontrol edildi/oluşturuldu: ${dataDir}`);
    } catch (error) {
        console.error("❌ Dizinler oluşturulurken hata:", error.message);
    }
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
    // startUpdater(60, historicDataPath, historicData); // Örnek: Saatte bir güncelle
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
    /analyze_pro <Takım A> vs <Takım B> - (Yakında) Belirtilen maç için analiz yapar.
    /force_update - (Yakında) Veri güncellemesini manuel tetikler.
    `);
});

// Test Komutu: Belirli bir tarihin maçlarını çek
bot.onText(/\/fetch_matches (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const date = match[1]; // Kullanıcının girdiği tarih (YYYY-MM-DD)

    // Basit tarih formatı kontrolü
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bot.sendMessage(chatId, "Lütfen tarihi YYYY-MM-DD formatında girin (örn: /fetch_matches 2024-05-25).");
        return;
    }

    bot.sendMessage(chatId, `⏳ ${date} tarihi için maçlar Mackolik'ten çekiliyor...`);

    const token = await mackolikService.getToken();
    if (!token) {
        bot.sendMessage(chatId, "❌ Mackolik token alınamadı, işlem iptal edildi.");
        return;
    }

    try {
        const matches = await mackolikService.getMatchesForDate(token, date);

        if (matches && matches.length > 0) {
            // İlk 5 maçı örnek olarak gösterelim
            let response = `✅ ${date} tarihi için ${matches.length} maç bulundu:\n\n`;
            matches.slice(0, 10).forEach(m => {
                response += `⚽ ${m.time} | ${m.league}\n   ${m.homeTeam} vs ${m.awayTeam}`;
                if (m.status === 3) { // Maç bittiyse skoru ekle
                    response += ` (${m.result?.ftScore || 'Skor Yok'})`;
                    if (m.result?.htScore) {
                         response += ` (İY: ${m.result.htScore})`;
                    }
                }
                response += '\n\n'; // Maçlar arasına boşluk
            });
             if (matches.length > 10) {
                 response += `...ve ${matches.length - 10} maç daha.\n`;
             }
            bot.sendMessage(chatId, response);

            // İsteğe bağlı: Çekilen veriyi hemen kaydet/güncelle
            // Bu, autoUpdater olmadan manuel test için kullanılabilir
            /*
            if (!historicData.matches[date]) {
                 historicData.matches[date] = [];
            }
            // Basitçe üzerine yazmak yerine güncelleme mantığı kullanılmalı
            historicData.matches[date] = matches; // Dikkat: Bu basitçe üzerine yazar!
            historicData.last_update = new Date().toISOString(); // Geçici güncelleme zamanı
            await saveHistoricData(historicData, historicDataPath);
            bot.sendMessage(chatId, `ℹ️ ${date} verisi geçici olarak kaydedildi (Test).`);
            */

        } else {
            bot.sendMessage(chatId, `ℹ️ ${date} tarihi için Mackolik'te maç bulunamadı veya çekilemedi.`);
        }
    } catch (error) {
        console.error("Maç çekme komutu hatası:", error);
        bot.sendMessage(chatId, `❌ Maçlar çekilirken bir hata oluştu: ${error.message}`);
    }
});


// --- Hata Yönetimi ---
bot.on('polling_error', (error) => { console.error(`Polling Hatası: ${error.code} - ${error.message}`); });
bot.on('webhook_error', (error) => { console.error(`Webhook Hatası: ${error.code} - ${error.message}`); });
process.on('uncaughtException', (error) => { console.error('Beklenmeyen Hata Yakalandı:', error); });
process.on('unhandledRejection', (reason, promise) => { console.error('İşlenmeyen Promise Reddi:', reason); });
