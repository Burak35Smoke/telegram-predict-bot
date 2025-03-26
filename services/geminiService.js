// services/geminiService.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey) {
    console.error("Hata: GEMINI_API_KEY bulunamadı. .env dosyasını kontrol edin.");
    // Botun çökmesini engellemek için burada process.exit(1) yapmayalım,
    // ama Gemini fonksiyonları hata döndürecektir.
}

const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

// Güvenlik ayarları (daha önce tanımlandığı gibi)
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const model = genAI ? genAI.getGenerativeModel({
    model: "gemini-1.5-pro-latest", // Veya "gemini-pro"
    safetySettings
}) : null;

/**
 * Gemini API'ye bir prompt gönderir ve yanıtını alır.
 * @param {string} prompt Gönderilecek prompt metni.
 * @returns {Promise<string>} Gemini'nin yanıtı veya hata mesajı.
 */
async function askGemini(prompt) {
    if (!model) {
        return "Hata: Gemini API anahtarı yapılandırılmamış veya model başlatılamadı.";
    }
    console.log("--- Gemini'ye Gönderilen Prompt Başlangıcı ---");
    console.log(prompt.substring(0, 500) + (prompt.length > 500 ? "..." : "")); // Çok uzunsa kısaltarak logla
    console.log("--- Gemini'ye Gönderilen Prompt Sonu ---");
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        // Hata/Engelleme kontrolleri (daha önceki koddan alınabilir)
        if (!response || !response.candidates || response.candidates.length === 0 || !response.candidates[0].content) {
            const blockReason = response?.promptFeedback?.blockReason;
            console.error("Gemini yanıtı engellendi veya boş. Sebep:", blockReason || "Bilinmiyor");
            return `Gemini yanıtı alınamadı. Sebep: ${blockReason || 'Bilinmiyor'}.`;
        }
        if (response.candidates[0].finishReason === 'SAFETY') {
            console.error("Gemini yanıtı güvenlik nedeniyle durduruldu.");
            return "Gemini yanıtı güvenlik filtrelerine takıldı.";
        }

        const text = response.text();
        console.log("--- Gemini'den Gelen Text Başlangıcı ---");
        console.log(text.substring(0, 500) + (text.length > 500 ? "..." : ""));
        console.log("--- Gemini'den Gelen Text Sonu ---");
        return text;

    } catch (error) {
        console.error("Gemini API Hatası:", error);
        let errorMessage = "Gemini API hatası oluştu.";
        if (error.response?.data?.error?.message) {
             errorMessage += ` API Mesajı: ${error.response.data.error.message}`;
        } else if (error.message) {
            errorMessage += ` Detay: ${error.message}`;
        }
        return errorMessage;
    }
}

/**
 * Gemini'nin analiz yanıtını ayrıştırır (daha önceki koddan).
 * @param {string} responseText Gemini'den gelen ham metin yanıtı.
 * @returns {object} Ayrıştırılmış analiz objesi.
 */
function parseGeminiAnalysisResponse(responseText) {
     const analysis = {
        ms: { prediction: null, confidence: null, reason: null },
        htft: { prediction: null, confidence: null, reason: null }, // IY/MS
        iy: { prediction: null, confidence: null, reason: null },   // IY Sonucu
        goal: { prediction: null, confidence: null, reason: null }, // Gol A/Ü
        kg: { prediction: null, confidence: null, reason: null },   // KG Var/Yok
        corner: { prediction: null, confidence: null, reason: null } // Korner A/Ü
    };

    // Regex ile ayrıştırma (daha önceki koddaki extractField benzeri)
    const extractField = (regex) => {
        const match = responseText.match(regex);
        return match && match[1] ? match[1].trim() : null;
    };

     try {
        // MS, IY/MS, IY, Gol, KG, Korner için extractField çağrıları...
        // Örnek:
        analysis.ms.prediction = extractField(/MS Tahmin:\s*([1X2])/i);
        analysis.ms.confidence = extractField(/MS Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.ms.reason = extractField(/MS Gerekçe:\s*(.*)/i);

        analysis.htft.prediction = extractField(/IY\/MS Tahmin:\s*([1X2]\/[1X2])/i);
        analysis.htft.confidence = extractField(/IY\/MS Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.htft.reason = extractField(/IY\/MS Gerekçe:\s*(.*)/i);

        analysis.iy.prediction = extractField(/IY Sonucu Tahmin:\s*([1X2])/i);
        analysis.iy.confidence = extractField(/IY Sonucu Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.iy.reason = extractField(/IY Sonucu Gerekçe:\s*(.*)/i);

        analysis.goal.prediction = extractField(/Gol Tahmin:\s*((?:Alt|Üst)\s*\d+\.?\d*)/i);
        analysis.goal.confidence = extractField(/Gol Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.goal.reason = extractField(/Gol Gerekçe:\s*(.*)/i);

        analysis.kg.prediction = extractField(/KG Tahmin:\s*(Var|Yok)/i);
        analysis.kg.confidence = extractField(/KG Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.kg.reason = extractField(/KG Gerekçe:\s*(.*)/i);

        analysis.corner.prediction = extractField(/Korner Tahmin:\s*((?:Alt|Üst)\s*\d+\.?\d*)/i);
        analysis.corner.confidence = extractField(/Korner Güven:\s*(Düşük|Orta|Yüksek)/i);
        analysis.corner.reason = extractField(/Korner Gerekçe:\s*(.*)/i);

        // Gerekçelerin temizlenmesi
        Object.values(analysis).forEach(type => {
            if (type.reason) {
                type.reason = type.reason.split('\n')[0].trim();
            }
        });

    } catch (parseError) {
        console.error("Gemini yanıtı ayrıştırma hatası:", parseError);
        // Hata durumunda belki ham yanıtı bir yere ekleyebiliriz
    }
    return analysis;
}


module.exports = {
    askGemini,
    parseGeminiAnalysisResponse,
};
