// utils/dataStore.js
const fs = require('fs/promises');
const path = require('path');

/**
 * Belirtilen yoldan geçmiş maç verilerini yükler.
 * Dosya yoksa veya boşsa, varsayılan bir yapı döndürür.
 * @param {string} filePath JSON dosyasının yolu.
 * @returns {Promise<object>} Yüklenen veri ({ matches: {}, last_update: null } formatında).
 */
async function loadHistoricData(filePath) {
    const defaultData = { matches: {}, last_update: null };
    try {
        await fs.access(filePath); // Dosya var mı kontrol et
        const data = await fs.readFile(filePath, 'utf-8');
        if (!data) {
            console.log(`ℹ️ Veri dosyası (${filePath}) boş, varsayılan yapı kullanılıyor.`);
            return defaultData;
        }
        const jsonData = JSON.parse(data);
        // matches anahtarının varlığını kontrol et
        if (!jsonData.matches) {
            console.warn(`⚠️ Veri dosyasında (${filePath}) 'matches' anahtarı bulunamadı, varsayılan yapı kullanılıyor.`);
            return defaultData;
        }
        console.log(`✅ Geçmiş veriler yüklendi: ${filePath}`);
        return jsonData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`ℹ️ Veri dosyası (${filePath}) bulunamadı, varsayılan yapı kullanılacak.`);
        } else {
            console.error(`❌ Geçmiş veriler yüklenirken hata (${filePath}):`, error.message);
        }
        return defaultData;
    }
}

/**
 * Veriyi belirtilen JSON dosyasına kaydeder.
 * @param {object} data Kaydedilecek veri ({ matches: {}, last_update: string }).
 * @param {string} filePath JSON dosyasının yolu.
 * @returns {Promise<void>}
 */
async function saveHistoricData(data, filePath) {
    try {
        // Kaydetmeden önce veri tutarlılığı için küçük kontroller (Python'daki gibi)
        if (data && data.matches) {
            Object.values(data.matches).forEach(dailyMatches => {
                if (Array.isArray(dailyMatches)) {
                    dailyMatches.forEach(match => {
                        // Saat formatını düzelt (örn: "19:00")
                        if (match.time && typeof match.time === 'string' && match.time.length > 5) {
                            match.time = match.time.substring(0, 5);
                        }
                        // Skorları result objesinden alıp ana seviyeye ekleyebiliriz (opsiyonel, analizde kolaylık için)
                        // if (match.result?.ftScore) match.ftScore = match.result.ftScore;
                        // if (match.result?.htScore) match.htScore = match.result.htScore;
                    });
                }
            });
        }

        const jsonData = JSON.stringify(data, null, 4); // 4 boşlukla formatla
        await fs.writeFile(filePath, jsonData, 'utf-8');
        console.log(`✅ Veriler kaydedildi: ${filePath}`);
    } catch (error) {
        console.error(`❌ Veriler kaydedilirken hata (${filePath}):`, error.message);
    }
}

/**
* Python kodundaki update_match_fields fonksiyonuna benzer şekilde,
* mevcut maç verisini yeni gelen veriyle günceller.
* Şimdilik basit bir güncelleme yapalım, skor ve durumu güncelleyelim.
* Oran güncellemeleri daha sonra eklenebilir.
* @param {object} existingMatch Mevcut maç verisi.
* @param {object} newMatch API'den yeni gelen maç verisi.
* @returns {boolean} Güncelleme yapıldıysa true, aksi takdirde false.
*/
function updateMatchFields(existingMatch, newMatch) {
    let updated = false;

    // Durumu güncelle
    if (newMatch.status && existingMatch.status !== newMatch.status) {
        existingMatch.status = newMatch.status;
        updated = true;
    }

    // Skorları güncelle (sadece null değilse)
    if (newMatch.result) {
        if (newMatch.result.ftScore !== null && existingMatch.result.ftScore !== newMatch.result.ftScore) {
            existingMatch.result.ftScore = newMatch.result.ftScore;
            existingMatch.result.ftScoreA = newMatch.result.ftScoreA;
            existingMatch.result.ftScoreB = newMatch.result.ftScoreB;
            updated = true;
        }
        if (newMatch.result.htScore !== null && existingMatch.result.htScore !== newMatch.result.htScore) {
            existingMatch.result.htScore = newMatch.result.htScore;
            existingMatch.result.htScoreA = newMatch.result.htScoreA;
            existingMatch.result.htScoreB = newMatch.result.htScoreB;
            updated = true;
        }
    }

    // TODO: Oran güncellemelerini buraya ekle (Python kodundaki gibi market_types döngüsü)
    // Şimdilik sadece skor ve durumu güncelliyoruz.

    return updated;
}


module.exports = {
    loadHistoricData,
    saveHistoricData,
    updateMatchFields,
};
