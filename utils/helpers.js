// utils/helpers.js
const fs = require('fs/promises');
const path = require('path');

/**
 * Gerekli data ve analiz dizinlerini oluşturur.
 * @param {string} historicDataFilePath historic_matches.json dosyasının tam yolu.
 */
async function initializeDirectories(historicDataFilePath) {
    const dataDir = path.dirname(historicDataFilePath);
    // Analiz klasörü şimdilik devre dışı
    // const baseDir = path.dirname(dataDir); // data'nın üst klasörü
    // const analysisDir = path.join(baseDir, 'Analizler');

    try {
        await fs.mkdir(dataDir, { recursive: true });
        // await fs.mkdir(analysisDir, { recursive: true });
        console.log(`✅ Gerekli dizinler kontrol edildi/oluşturuldu: ${dataDir}`);
    } catch (error) {
        console.error("❌ Dizinler oluşturulurken hata:", error.message);
        // Hata durumunda programı durdurmak yerine devam etmeyi deneyebiliriz,
        // ancak dosya yazma işlemleri başarısız olacaktır.
    }
}

module.exports = {
    initializeDirectories,
};
