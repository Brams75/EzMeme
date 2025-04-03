import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { dirname } from "path";
import multer from "multer";
import { exec, spawn } from "child_process";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import https from "https";
import dotenv from "dotenv";

// Charger les variables d'environnement depuis le fichier .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const downloadsDir = path.join(__dirname, "downloads");
const PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${PORT}`;

// Accès aux variables d'environnement
console.log("Mode debug:", process.env.DEBUG_MODE === "True");
console.log("EasyOCR GPU enabled:", process.env.EASYOCR_GPU_ENABLED === "True");

// S'assurer que le répertoire de téléchargement existe
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Configurer le stockage pour multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Stocker les fichiers dans le dossier downloads
    cb(null, "downloads");
  },
  filename: function (req, file, cb) {
    // Utiliser un timestamp pour éviter les conflits de noms
    const timestamp = Date.now();
    const extension = path.extname(file.originalname) || ".mp4";
    cb(null, `video_${timestamp}${extension}`);
  },
});

const app = express();
// Configurer multer avec le stockage sur disque
const upload = multer({ storage: storage });

// Configuration CORS plus permissive
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

app.use(express.json());

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Configuration de ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
// Configurer ffprobe avec le package ffprobe-static
ffmpeg.setFfprobePath(ffprobeStatic.path);

console.log("Chemin de ffmpeg:", ffmpegStatic);
console.log("Chemin de ffprobe:", ffprobeStatic.path);

// Création des dossiers nécessaires
const dirs = ["downloads", "frames", "ocr"];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    console.log(`Dossier ${dir} créé`);
  } else {
    console.log(`Dossier ${dir} existe déjà`);
  }
});

// Fonction pour nettoyer les dossiers spécifiques
function cleanDirectories(dirsToClean = ["frames", "ocr"]) {
  console.log(`Nettoyage des dossiers: ${dirsToClean.join(", ")}...`);
  dirsToClean.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
      console.log(`Dossier ${dir} créé`);
      return;
    }

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Fichier supprimé: ${filePath}`);
          }
        } catch (e) {
          console.warn(
            `Erreur lors de la suppression du fichier ${file} dans ${dir}: ${e.message}`
          );
        }
      }
      console.log(`Dossier ${dir} nettoyé`);
    } catch (e) {
      console.error(`Erreur lors du nettoyage du dossier ${dir}: ${e.message}`);
    }
  });
}

// Fonction pour extraire les données Instagram
async function scrapeInstagram(url) {
  console.log("Scraping Instagram URL:", url);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Définir un viewport de taille raisonnable
    await page.setViewport({ width: 1280, height: 800 });

    // Définir un user agent credible
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    // Accéder à la page Instagram
    console.log("Chargement de l'URL Instagram:", url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Attendre le chargement du contenu
    await page.waitForSelector("body", { timeout: 10000 });
    console.log("Page Instagram chargée, extraction des données...");

    // Extraire la description et les hashtags uniquement avec XPath
    const extractedData = await page.evaluate(() => {
      // Fonction pour extraire les hashtags d'un texte
      function extractHashtags(text) {
        if (!text) return [];
        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        return [...new Set(text.match(hashtagRegex) || [])];
      }

      let description = "";
      let hashtags = [];

      // Récupérer la description avec le XPath exact
      const xpath =
        "/html/body/div[1]/div/div/div[2]/div/div/div[1]/div[1]/div[1]/section/main/div[2]/div[1]/article/div/div[2]/div/div[2]/div[1]/ul/div[1]/li/div/div/div[2]/div[1]/h1";
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const descriptionElement = result.singleNodeValue;

      if (descriptionElement) {
        description = descriptionElement.textContent.trim();

        // Extraire les hashtags de la description
        hashtags = extractHashtags(description);

        // Nettoyer la description en retirant les hashtags
        description = description.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
      }

      return { description, hashtags };
    });

    console.log("Données extraites:", {
      description: extractedData.description
        ? extractedData.description.substring(0, 50) + "..."
        : "Non trouvée",
      hashtags: extractedData.hashtags,
    });

    return extractedData;
  } catch (error) {
    console.error("Erreur lors du scraping Instagram:", error);
    throw error;
  } finally {
    console.log("Fermeture du navigateur...");
    await browser.close();
  }
}

// Fonction pour télécharger la vidéo
async function handleVideoDownload(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: 60000,
  });
  const page = await browser.newPage();

  try {
    console.log("Navigation vers fastvideosave.net...");
    await page.goto("https://fastvideosave.net/", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Vérifier si le bouton de consentement des cookies existe et cliquer dessus si c'est le cas
    console.log("Vérification du bouton de consentement des cookies...");
    try {
      // Essayer d'abord avec le CSS selector
      const cookieConsentSelector = await Promise.race([
        page.waitForSelector("#cookie-consent-button", { timeout: 5000 }),
        page.waitForSelector(".cookie-consent-btn", { timeout: 5000 }),
        page.waitForSelector("button[data-consent='accept']", {
          timeout: 5000,
        }),
        page.waitForXPath(
          "//button[contains(text(), 'Accept') or contains(text(), 'Accepter')]",
          { timeout: 5000 }
        ),
      ]);

      if (cookieConsentSelector) {
        console.log("Bouton de consentement trouvé, clic en cours...");

        if (cookieConsentSelector.constructor.name.includes("XPath")) {
          await cookieConsentSelector.click();
        } else {
          await cookieConsentSelector.click();
        }

        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log(
        "Aucun bouton de consentement des cookies trouvé, poursuite du processus..."
      );
    }

    // Attendre et remplir le champ de recherche
    console.log("Recherche du champ de saisie...");
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await page.type('input[type="text"]', url);

    // Cliquer sur le bouton de recherche
    console.log("Clic sur le bouton de recherche...");
    await page.click('button[type="submit"]');

    // Attendre le bouton de téléchargement avec plusieurs tentatives
    console.log("Attente du bouton de téléchargement...");
    let downloadUrl = null;

    try {
      // Attendre que la page de résultats se charge
      await page.waitForNavigation({
        waitUntil: "networkidle0",
        timeout: 20000,
      });

      // Essayer différents sélecteurs pour le lien de téléchargement
      for (const selector of [
        'a[href*=".mp4"]',
        "a.download-btn",
        'a[href*="download"]',
        ".download-button a",
        "a[download]",
      ]) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          downloadUrl = await page.evaluate((sel) => {
            const link = document.querySelector(sel);
            return link ? link.href : null;
          }, selector);

          if (downloadUrl) {
            console.log(
              `Lien de téléchargement trouvé avec le sélecteur: ${selector}`
            );
            break;
          }
        } catch (e) {
          console.log(`Sélecteur non trouvé: ${selector}`);
        }
      }

      // Si aucun sélecteur n'a fonctionné, essayer de trouver tous les liens
      if (!downloadUrl) {
        console.log("Recherche parmi tous les liens...");
        downloadUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll("a"));
          // Recherche des liens qui semblent être des liens de téléchargement
          const downloadLink = links.find(
            (a) =>
              (a.href && a.href.includes(".mp4")) ||
              (a.href && a.href.includes("download")) ||
              a.download ||
              (a.innerText &&
                (a.innerText.toLowerCase().includes("download") ||
                  a.innerText.toLowerCase().includes("télécharger")))
          );
          return downloadLink ? downloadLink.href : null;
        });
      }
    } catch (e) {
      console.error("Erreur lors de l'attente de la navigation:", e);
    }

    if (!downloadUrl) {
      throw new Error("URL de téléchargement non trouvée");
    }

    console.log("URL de téléchargement trouvée:", downloadUrl);

    // Télécharger la vidéo
    const timestamp = Date.now();
    const videoPath = path.join("downloads", `video_${timestamp}.mp4`);

    console.log("Téléchargement de la vidéo...");
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Erreur lors du téléchargement: ${response.status} ${response.statusText}`
      );
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(videoPath, Buffer.from(buffer));
    console.log("Vidéo téléchargée avec succès:", videoPath);

    return videoPath;
  } catch (error) {
    console.error("Erreur lors du téléchargement de la vidéo:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Fonction pour télécharger l'audio
async function handleAudioDownload(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: 60000,
  });
  const page = await browser.newPage();

  try {
    console.log("Navigation vers fastvideosave.net pour l'audio...");
    await page.goto("https://fastvideosave.net/audio", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Vérifier si le bouton de consentement des cookies existe et cliquer dessus si c'est le cas
    console.log("Vérification du bouton de consentement des cookies...");
    try {
      // Essayer d'abord avec plusieurs sélecteurs
      const cookieConsentSelector = await Promise.race([
        page.waitForSelector("#cookie-consent-button", { timeout: 5000 }),
        page.waitForSelector(".cookie-consent-btn", { timeout: 5000 }),
        page.waitForSelector("button[data-consent='accept']", {
          timeout: 5000,
        }),
        page.waitForXPath(
          "//button[contains(text(), 'Accept') or contains(text(), 'Accepter')]",
          { timeout: 5000 }
        ),
      ]);

      if (cookieConsentSelector) {
        console.log("Bouton de consentement trouvé, clic en cours...");

        if (cookieConsentSelector.constructor.name.includes("XPath")) {
          await cookieConsentSelector.click();
        } else {
          await cookieConsentSelector.click();
        }

        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log(
        "Aucun bouton de consentement des cookies trouvé, poursuite du processus..."
      );
    }

    // Attendre et remplir le champ de recherche
    console.log("Recherche du champ de saisie...");
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await page.type('input[type="text"]', url);

    // Cliquer sur le bouton de recherche
    console.log("Clic sur le bouton de recherche...");
    await page.click('button[type="submit"]');

    // Attendre le bouton de téléchargement audio avec plusieurs tentatives
    console.log("Attente du bouton de téléchargement audio...");
    let downloadUrl = null;

    try {
      // Attendre que la page de résultats se charge
      await page.waitForNavigation({
        waitUntil: "networkidle0",
        timeout: 20000,
      });

      // Essayer différents sélecteurs pour le lien de téléchargement audio
      for (const selector of [
        'a[href*=".mp3"]',
        'a[href*="mp3"]',
        'a[href*="audio"]',
        "a.download-audio",
        'a[title*="audio"]',
        'a:contains("MP3")',
        'a:contains("Audio")',
      ]) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          downloadUrl = await page.evaluate((sel) => {
            const link = document.querySelector(sel);
            return link ? link.href : null;
          }, selector);

          if (downloadUrl) {
            console.log(
              `Lien de téléchargement audio trouvé avec le sélecteur: ${selector}`
            );
            break;
          }
        } catch (e) {
          console.log(`Sélecteur audio non trouvé: ${selector}`);
        }
      }

      // Si aucun sélecteur n'a fonctionné, essayer de parcourir tous les liens pour trouver celui avec "mp3" ou "audio"
      if (!downloadUrl) {
        console.log("Recherche parmi tous les liens pour l'audio...");
        downloadUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll("a"));
          // Recherche des liens qui semblent être des liens de téléchargement audio
          const downloadLink = links.find(
            (a) =>
              (a.href &&
                (a.href.includes(".mp3") ||
                  a.href.includes("mp3") ||
                  a.href.includes("audio"))) ||
              (a.download &&
                (a.download.includes("mp3") || a.download.includes("audio"))) ||
              (a.innerText &&
                (a.innerText.toLowerCase().includes("mp3") ||
                  a.innerText.toLowerCase().includes("audio") ||
                  a.innerText.toLowerCase().includes("télécharger l'audio"))) ||
              (a.title &&
                (a.title.toLowerCase().includes("mp3") ||
                  a.title.toLowerCase().includes("audio")))
          );
          return downloadLink ? downloadLink.href : null;
        });
      }
    } catch (e) {
      console.error(
        "Erreur lors de l'attente de la navigation pour l'audio:",
        e
      );
    }

    if (!downloadUrl) {
      throw new Error("URL de téléchargement audio non trouvée");
    }

    console.log("URL de téléchargement audio trouvée:", downloadUrl);

    // Télécharger l'audio
    const timestamp = Date.now();
    const audioPath = path.join("downloads", `audio_${timestamp}.mp3`);

    console.log("Téléchargement de l'audio...");
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Erreur lors du téléchargement de l'audio: ${response.status} ${response.statusText}`
      );
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(audioPath, Buffer.from(buffer));
    console.log("Audio téléchargé avec succès:", audioPath);

    return audioPath;
  } catch (error) {
    console.error("Erreur lors du téléchargement de l'audio:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Fonction pour extraire les frames
function extractFrames(videoPath) {
  return new Promise((resolve, reject) => {
    console.log("Extraction des frames de la vidéo:", videoPath);

    if (!fs.existsSync(videoPath)) {
      console.error(`Le fichier vidéo n'existe pas: ${videoPath}`);
      return reject(new Error(`Le fichier vidéo n'existe pas: ${videoPath}`));
    }

    // Obtenir la durée de la vidéo d'abord
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(
          "Erreur lors de l'analyse de la vidéo avec ffprobe:",
          err
        );
        console.log(
          "Tentative d'extraction des frames sans analyse préalable..."
        );

        // Fallback: extraire quelques frames sans connaître la durée
        try {
          ffmpeg(videoPath)
            .on("start", (cmd) => console.log("Commande ffmpeg fallback:", cmd))
            .on("end", () => {
              console.log("Frames extraites avec succès (mode fallback)");
              resolve();
            })
            .on("error", (extractErr) => {
              console.error(
                "Erreur lors de l'extraction fallback des frames:",
                extractErr
              );
              reject(extractErr);
            })
            .outputOptions(["-vf fps=1/2"]) // Extraire une frame toutes les 2 secondes
            .output(path.join("frames", "frame-%03d.png"))
            .run();
        } catch (fallbackErr) {
          console.error(
            "Erreur lors du fallback d'extraction des frames:",
            fallbackErr
          );
          reject(fallbackErr);
        }
        return;
      }

      try {
        // Obtenir la durée en secondes
        const durationSec = metadata.format.duration;
        console.log(`Durée de la vidéo: ${durationSec} secondes`);

        if (!durationSec || durationSec <= 0) {
          console.error(
            "Durée de vidéo invalide, utilisation du mode fallback"
          );

          // Utiliser le même fallback en cas de durée invalide
          ffmpeg(videoPath)
            .on("start", (cmd) => console.log("Commande ffmpeg fallback:", cmd))
            .on("end", () => {
              console.log("Frames extraites avec succès (mode fallback)");
              resolve();
            })
            .on("error", (extractErr) => {
              console.error(
                "Erreur lors de l'extraction fallback des frames:",
                extractErr
              );
              reject(extractErr);
            })
            .outputOptions(["-vf fps=1/2"]) // Extraire une frame toutes les 2 secondes
            .output(path.join("frames", "frame-%03d.png"))
            .run();

          return;
        }

        // Calculer le nombre d'images à extraire (1 par seconde)
        const frameCount = Math.min(Math.ceil(durationSec), 30); // Maximum 30 frames pour éviter un trop grand nombre
        console.log(`Extraction de ${frameCount} frames...`);

        // Configurer ffmpeg pour extraire les frames à intervalles réguliers
        ffmpeg(videoPath)
          .on("start", (cmd) => console.log("Commande ffmpeg:", cmd))
          .on("end", () => {
            console.log(`${frameCount} frames extraites avec succès`);
            resolve();
          })
          .on("error", (err) => {
            console.error("Erreur lors de l'extraction des frames:", err);
            reject(err);
          })
          .outputOptions([
            `-vf fps=1/${Math.ceil(durationSec / frameCount)}`, // 1 frame par intervalle régulier
          ])
          .output(path.join("frames", "frame-%03d.png"))
          .run();
      } catch (error) {
        console.error("Erreur lors de la configuration de ffmpeg:", error);
        reject(error);
      }
    });
  });
}

// Routes API

// Route de ping pour vérifier si le serveur est en ligne
app.get("/ping", (req, res) => {
  res.status(200).json({
    status: "online",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Route pour le traitement OCR avec support d'EasyOCR
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    console.log("Réception d'une requête POST /ocr");
    const { language, videoPath, instagramUrl } = req.body;
    console.log(
      "Langue spécifiée:",
      language || "non spécifiée (utilisation de français par défaut)"
    );
    console.log("Chemin vidéo externalisé:", videoPath);
    console.log("URL Instagram:", instagramUrl);

    // Extraire les hashtags et la description dès le début si une URL Instagram est fournie
    let hashtags = [];
    let description = "";
    let metadataExtracted = false;

    if (instagramUrl) {
      try {
        console.log(
          "Extraction immédiate des hashtags et de la description depuis Instagram..."
        );
        const scrapeResult = await scrapeInstagram(instagramUrl);
        hashtags = scrapeResult.hashtags || [];
        description = scrapeResult.description || "";
        metadataExtracted = true;

        console.log("Extraction réussie:", {
          description:
            description.substring(0, 50) +
            (description.length > 50 ? "..." : ""),
          hashtags,
        });

        // Envoyer une réponse partielle avant le traitement OCR
        const metadataResponse = {
          success: true,
          partial: true,
          message: "Métadonnées extraites, traitement vidéo en cours",
          description: description,
          hashtags: hashtags,
        };

        // Utiliser res.write pour envoyer une réponse partielle
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        });
        res.write(JSON.stringify(metadataResponse));
      } catch (scrapeError) {
        console.error(
          "Erreur lors de l'extraction des données Instagram:",
          scrapeError
        );
        console.log(
          "L'extraction des hashtags/description a échoué, continuons avec le traitement vidéo"
        );
      }
    }

    // Créer le dossier ocr s'il n'existe pas
    try {
      if (!fs.existsSync("ocr")) {
        fs.mkdirSync("ocr");
      }
    } catch (error) {
      console.error("Erreur lors de la création du dossier ocr:", error);
    }

    // Nettoyer uniquement les dossiers frames et ocr, pas downloads
    cleanDirectories(["frames", "ocr"]);

    // Déterminer le chemin de la vidéo à utiliser
    let actualVideoPath = null;

    // Si un chemin vidéo est spécifié dans la requête
    if (videoPath) {
      // Gérer les chemins Windows avec des barres obliques inverses
      const normalizedVideoPath = videoPath.replace(/\\/g, "/");
      console.log(`Chemin vidéo normalisé: ${normalizedVideoPath}`);

      if (fs.existsSync(videoPath)) {
        console.log(`Utilisation de la vidéo existante: ${videoPath}`);
        actualVideoPath = videoPath;
      } else {
        console.log(`Le fichier spécifié n'existe pas: ${videoPath}`);
      }
    }
    // Si un fichier a été uploadé
    else if (req.file && req.file.path) {
      console.log("Vidéo reçue via upload:", req.file.path);
      actualVideoPath = req.file.path;
    }
    // Chercher des vidéos existantes dans le dossier downloads
    else {
      console.log(
        "Recherche de vidéos existantes dans le dossier downloads..."
      );
      if (fs.existsSync("downloads")) {
        const files = fs
          .readdirSync("downloads")
          .filter(
            (file) =>
              file.toLowerCase().endsWith(".mp4") ||
              file.toLowerCase().endsWith(".mov") ||
              file.toLowerCase().endsWith(".avi")
          );

        if (files.length > 0) {
          // Utiliser le fichier le plus récent
          const mostRecent = files.sort((a, b) => {
            const statA = fs.statSync(path.join("downloads", a));
            const statB = fs.statSync(path.join("downloads", b));
            return statB.mtime.getTime() - statA.mtime.getTime();
          })[0];

          actualVideoPath = path.join("downloads", mostRecent);
          console.log(`Vidéo existante trouvée: ${actualVideoPath}`);
        }
      }
    }

    if (!actualVideoPath || !fs.existsSync(actualVideoPath)) {
      return sendCompleteResponse(res, {
        success: false,
        error: "Aucune vidéo valide n'a été trouvée pour le traitement OCR",
      });
    }

    console.log("Vidéo sélectionnée pour OCR:", actualVideoPath);

    const extractionStart = Date.now();
    await extractFrames(actualVideoPath);
    console.log(
      `Extraction des frames terminée en ${
        (Date.now() - extractionStart) / 1000
      }s`
    );

    // Vérifier que le dossier frames existe
    if (!fs.existsSync("frames")) {
      fs.mkdirSync("frames");
      console.log("Dossier frames créé");
    }

    // Lister les frames extraites
    const frames = fs.existsSync("frames")
      ? fs
          .readdirSync("frames")
          .filter(
            (file) =>
              file.toLowerCase().endsWith(".jpg") ||
              file.toLowerCase().endsWith(".png")
          )
      : [];

    console.log(`${frames.length} frames extraites`);

    if (frames.length === 0) {
      return sendCompleteResponse(res, {
        success: false,
        error: "Aucune frame n'a pu être extraite de la vidéo",
      });
    }

    // Traitement OCR - on utilise EasyOCR + ChatGPT pour la correction
    console.log("Début du traitement OCR avec EasyOCR + ChatGPT");
    const ocrStart = Date.now();

    let results = [];
    let correctedTexts = [];

    // Appeler le script EasyOCR pour traiter les images
    await processImagesWithEasyOCR(language || "fra");
    console.log(`Traitement OCR terminé en ${(Date.now() - ocrStart) / 1000}s`);

    // Vérifier si le fichier de résultats JSON existe
    const resultsPath = path.join("ocr", "easyocr_results.json");
    if (fs.existsSync(resultsPath)) {
      try {
        // Lire les résultats JSON générés par le script python
        const jsonResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
        console.log(
          "Résultats JSON trouvés:",
          jsonResults.length,
          "blocs de texte"
        );

        // Extraire les textes corrigés
        correctedTexts = jsonResults
          .filter((item) => item.is_corrected)
          .map((item) => ({
            text: item.text,
            source_frames: item.source_frames,
          }));

        // Créer des résultats pour l'affichage des frames
        frames.forEach((frame) => {
          results.push({
            file: frame,
            text: frame,
            is_original: true,
          });
        });

        console.log(`${correctedTexts.length} textes corrigés extraits`);
      } catch (jsonError) {
        console.error(
          "Erreur lors de la lecture des résultats JSON:",
          jsonError
        );
        return sendCompleteResponse(res, {
          success: false,
          error: "Impossible de lire les résultats de l'OCR",
        });
      }
    } else {
      console.error("Fichier de résultats JSON non trouvé");
      return sendCompleteResponse(res, {
        success: false,
        error: "Échec du traitement OCR - aucun résultat généré",
      });
    }

    // Si on n'a pas déjà extrait les métadonnées, tenter à nouveau ici
    if (!metadataExtracted && instagramUrl) {
      try {
        console.log(
          "Tentative d'extraction des hashtags et de la description depuis Instagram..."
        );
        const scrapeResult = await scrapeInstagram(instagramUrl);
        hashtags = scrapeResult.hashtags || [];
        description = scrapeResult.description || "";
        console.log("Extraction réussie:", {
          description:
            description.substring(0, 50) +
            (description.length > 50 ? "..." : ""),
          hashtags,
        });
      } catch (scrapeError) {
        console.error(
          "Erreur lors de l'extraction des données Instagram:",
          scrapeError
        );
        console.log(
          "L'extraction des hashtags/description a échoué, utilisation des textes OCR uniquement"
        );
      }
    }

    // Structure de la réponse
    const finalResponse = {
      success: true,
      engine: "EasyOCR + ChatGPT",
      extractionTime: (Date.now() - extractionStart) / 1000,
      framesCount: frames.length,
      correctedTexts: correctedTexts, // Tous les textes corrigés
      correctedText: correctedTexts.length > 0 ? correctedTexts[0].text : null, // Pour compatibilité
      description: description,
      hashtags: hashtags,
      results: results.filter((r) => r.is_original), // Ne renvoyer que les frames originales
    };

    return sendCompleteResponse(res, finalResponse);
  } catch (error) {
    console.error("Erreur globale dans la route /ocr:", error);
    return sendCompleteResponse(res, {
      success: false,
      error:
        error.message || "Une erreur s'est produite lors du traitement OCR",
    });
  } finally {
    // Supprimer le fichier temporaire
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          console.log("Fichier temporaire supprimé:", req.file.path);
        } else {
          console.log(
            "Fichier temporaire déjà supprimé ou introuvable:",
            req.file.path
          );
        }
      } catch (error) {
        console.warn(
          "Erreur lors de la suppression du fichier temporaire:",
          error
        );
      }
    }
  }
});

// Fonction pour envoyer une réponse complète
function sendCompleteResponse(res, data) {
  // Si la réponse a déjà commencé (avec writeHead), terminer avec end()
  if (res.headersSent) {
    return res.end(JSON.stringify(data));
  }

  // Sinon, envoyer une réponse normale
  return res.json(data);
}

app.post("/api/extract", async (req, res) => {
  try {
    console.log("Requête d'extraction reçue:", req.body);
    const { url } = req.body;

    if (!url) {
      throw new Error("URL manquante");
    }

    cleanDirectories();
    const { description, hashtags } = await scrapeInstagram(url);

    console.log("Données extraites:", { description, hashtags });

    res.json({
      success: true,
      data: {
        description,
        hashtags,
        status: ["success", "success"],
      },
    });
  } catch (error) {
    console.error("Erreur lors de l'extraction:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/download/video", async (req, res) => {
  try {
    const { url } = req.body;
    const videoPath = await handleVideoDownload(url);

    // Extraire les frames
    await extractFrames(videoPath);

    // Faire l'OCR avec EasyOCR à la place de Tesseract
    await processImagesWithEasyOCR("fra");

    // Lire les résultats
    const resultsPath = path.join("ocr", "easyocr_results.json");
    let ocrResults = [];

    if (fs.existsSync(resultsPath)) {
      ocrResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    }

    res.json({
      success: true,
      data: {
        videoPath,
        ocrResults,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/download/audio", async (req, res) => {
  try {
    const { url } = req.body;
    const audioPath = await handleAudioDownload(url);

    res.json({
      success: true,
      data: {
        audioPath,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoint pour extraire les métadonnées d'un post Instagram avec Puppeteer
app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        message: "URL Instagram requise",
      });
    }

    console.log(`Extraction des métadonnées pour: ${url}`);

    // Extraire les métadonnées avec Puppeteer
    const metadata = await extractInstagramMetadata(url);

    return res.json({
      success: true,
      ...metadata,
    });
  } catch (error) {
    console.error("Erreur lors du scraping Instagram:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Erreur lors de l'extraction des métadonnées",
    });
  }
});

// Fonction pour extraire les métadonnées d'un post Instagram avec Puppeteer
async function extractInstagramMetadata(url) {
  console.log("Démarrage de l'extraction des métadonnées...");

  // Lancer un navigateur Puppeteer
  const browser = await puppeteer.launch({
    headless: "new", // Utiliser headless "new" pour le nouveau rendu headless
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Définir un viewport de taille raisonnable
    await page.setViewport({ width: 1280, height: 800 });

    // Définir un user agent credible
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    console.log("Chargement de l'URL:", url);
    // Accéder à l'URL Instagram
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Attendre le chargement du contenu
    await page.waitForSelector("body", { timeout: 10000 });

    console.log("Page Instagram chargée, extraction des données...");

    // Prendre une capture d'écran pour débogage si nécessaire
    // await page.screenshot({ path: 'debug-instagram.png' });

    // Utiliser uniquement XPath pour l'extraction
    const data = await page.evaluate(() => {
      try {
        // Récupérer la description avec le XPath exact
        const xpath =
          "/html/body/div[1]/div/div/div[2]/div/div/div[1]/div[1]/div[1]/section/main/div[2]/div[1]/article/div/div[2]/div/div[2]/div[1]/ul/div[1]/li/div/div/div[2]/div[1]/h1";
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        const descriptionElement = result.singleNodeValue;

        let description = "";
        let hashtags = [];

        if (descriptionElement) {
          description = descriptionElement.textContent.trim();

          // Extraire les hashtags de la description avec support des caractères spéciaux
          const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
          const matches = description.match(hashtagRegex);
          if (matches) {
            hashtags = matches;
          }

          // Nettoyer la description en retirant les hashtags
          description = description.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
        }

        return {
          success: true,
          description: description,
          hashtags: hashtags,
          debug: {
            elementFound: !!descriptionElement,
            elementHTML: descriptionElement
              ? descriptionElement.outerHTML
              : null,
          },
        };
      } catch (e) {
        return {
          success: false,
          error: e.message,
          debug: {
            stack: e.stack,
          },
        };
      }
    });

    // Afficher les résultats de la description
    console.log("\n=== Résultats de l'extraction ===\n");
    console.log("Description :");
    console.log(data.description);
    console.log("\nHashtags trouvés :");
    if (data.hashtags.length > 0) {
      data.hashtags.forEach((hashtag, index) => {
        console.log(`${index + 1}. ${hashtag}`);
      });
    } else {
      console.log("Aucun hashtag trouvé");
    }
    console.log("\n===========================\n");

    return {
      success: true,
      description: data.description,
      hashtags: data.hashtags,
    };
  } catch (error) {
    console.error("Erreur lors de l'extraction des métadonnées:", error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    await browser.close();
  }
}

// Servir les fichiers téléchargés avec les bons types MIME
app.use("/downloads", (req, res, next) => {
  const filePath = path.join(__dirname, "downloads", req.path);

  // Vérifier si le fichier existe
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();

    // Définir le type MIME approprié
    if (ext === ".mp4") {
      res.setHeader("Content-Type", "video/mp4");
    } else if (ext === ".mp3") {
      res.setHeader("Content-Type", "audio/mpeg");
    }

    // Ajouter des en-têtes pour le téléchargement
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(filePath)}"`
    );

    // Envoyer le fichier
    return res.sendFile(filePath);
  }

  next();
});

// Fallback pour servir les fichiers statiques normalement
app.use(
  "/downloads",
  express.static(path.join(__dirname, "downloads"), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === ".mp4") {
        res.setHeader("Content-Type", "video/mp4");
      } else if (ext === ".mp3") {
        res.setHeader("Content-Type", "audio/mpeg");
      }
    },
  })
);

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});

// Fonction pour utiliser EasyOCR via un script Python externe
async function processImagesWithEasyOCR(language = "fra") {
  return new Promise((resolve, reject) => {
    // Utiliser le script Python qui existe déjà dans le dossier easyocr
    const pythonScript = path.join(__dirname, "easyocr", "index.py");

    // Vérifier que le script existe
    if (!fs.existsSync(pythonScript)) {
      console.error(`Script Python non trouvé: ${pythonScript}`);
      return reject(new Error(`Script EasyOCR non trouvé: ${pythonScript}`));
    }

    // Vérifier que le dossier frames existe et contient des images
    const framesDir = path.join(__dirname, "frames");
    if (!fs.existsSync(framesDir)) {
      console.error(`Dossier frames non trouvé: ${framesDir}`);
      return reject(new Error(`Dossier frames non trouvé: ${framesDir}`));
    }

    const framesCount = fs
      .readdirSync(framesDir)
      .filter(
        (file) =>
          file.toLowerCase().endsWith(".png") ||
          file.toLowerCase().endsWith(".jpg")
      ).length;

    if (framesCount === 0) {
      console.error("Aucune frame trouvée dans le dossier frames");
      return reject(new Error("Aucune frame à traiter"));
    }

    console.log(
      `Traitement OCR de ${framesCount} frames avec EasyOCR (${language})...`
    );

    // Utiliser conda run pour exécuter le script Python dans l'environnement conda "ezmeme"
    const condaPath = "conda";
    const condaEnv = "ezmeme"; // Utiliser l'environnement conda ezmeme

    // Définir les variables d'environnement pour aider Python à trouver les modules
    const env = { ...process.env };

    // Ajouter les variables d'environnement du fichier .env
    // Elles seront transmises au script Python
    console.log("GPU enabled:", process.env.EASYOCR_GPU_ENABLED);
    console.log("Debug mode:", process.env.DEBUG_MODE);

    const gpuFlag =
      process.env.EASYOCR_GPU_ENABLED === "True" ? "True" : "False";

    console.log(
      `Exécution avec Conda: ${condaPath} run -n ${condaEnv} python "${pythonScript}" "./frames" --lang ${language} --gpu ${gpuFlag}`
    );

    // Utiliser spawn au lieu de exec
    const pythonProcess = spawn(
      condaPath,
      [
        "run",
        "-n",
        condaEnv,
        "python",
        pythonScript, // Pas besoin du flag -m, juste le chemin vers le script
        "./frames",
        "--lang",
        language,
        "--gpu",
        gpuFlag,
      ],
      { env }
    );

    let stdout = "";
    let stderr = "";

    // Collecter la sortie standard
    pythonProcess.stdout.on("data", (data) => {
      stdout += data.toString();
      console.log(`Sortie Python: ${data}`);
    });

    // Collecter les erreurs
    pythonProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      console.error(`Erreur Python: ${data}`);
    });

    // Gérer la terminaison du processus
    pythonProcess.on("close", (code) => {
      console.log(`Processus Python terminé avec le code: ${code}`);

      if (code !== 0) {
        console.error(
          "Erreur lors de l'exécution d'EasyOCR, code de sortie:",
          code
        );
        console.error("Sortie d'erreur:", stderr);

        // Essayer l'option de secours: exécuter directement avec l'environnement conda activé manuellement
        console.log(
          "Tentative de secours avec activation manuelle de conda..."
        );

        // Créer un script batch temporaire pour activer conda et exécuter le script Python
        const batchFile = path.join(__dirname, "temp_run_easyocr.bat");
        fs.writeFileSync(
          batchFile,
          `@echo off
call conda activate ezmeme
python "${pythonScript}" "./frames" --lang ${language} --gpu ${gpuFlag}
exit /b %ERRORLEVEL%`
        );

        const backupProcess = spawn("cmd.exe", ["/c", batchFile], { env });

        let backupStdout = "";
        let backupStderr = "";

        backupProcess.stdout.on("data", (data) => {
          backupStdout += data.toString();
          console.log(`Sortie Python (secours): ${data}`);
        });

        backupProcess.stderr.on("data", (data) => {
          backupStderr += data.toString();
          console.error(`Erreur Python (secours): ${data}`);
        });

        backupProcess.on("close", (backupCode) => {
          // Supprimer le fichier batch temporaire
          try {
            fs.unlinkSync(batchFile);
          } catch (e) {
            console.warn(
              "Erreur lors de la suppression du batch temporaire:",
              e
            );
          }

          if (backupCode !== 0) {
            console.error(
              "La tentative de secours a également échoué:",
              backupCode
            );

            // Créer un fichier de résultats vide pour éviter les erreurs lors de la lecture
            try {
              const emptyResults = [];
              const ocrDir = path.join(__dirname, "ocr");
              if (!fs.existsSync(ocrDir)) {
                fs.mkdirSync(ocrDir, { recursive: true });
              }
              fs.writeFileSync(
                path.join(ocrDir, "easyocr_results.json"),
                JSON.stringify(emptyResults)
              );
              console.log("Fichier de résultats vide créé");
            } catch (e) {
              console.error(
                "Erreur lors de la création du fichier de résultats vide:",
                e
              );
            }

            reject(
              new Error(
                `Échec de l'exécution d'EasyOCR avec toutes les méthodes`
              )
            );
          } else {
            console.log("La tentative de secours a réussi!");
            // Sauvegarder la sortie complète pour le débogage
            fs.writeFileSync(
              path.join("ocr", "easyocr_output.txt"),
              backupStdout
            );
            fs.writeFileSync(
              path.join("ocr", "easyocr_error.txt"),
              backupStderr
            );
            resolve();
          }
        });

        return;
      }

      // Vérifier que le fichier de résultats existe
      const resultsPath = path.join("ocr", "easyocr_results.json");
      if (!fs.existsSync(resultsPath)) {
        console.error("Fichier de résultats JSON non créé par EasyOCR");
        try {
          const emptyResults = [];
          const ocrDir = path.join(__dirname, "ocr");
          if (!fs.existsSync(ocrDir)) {
            fs.mkdirSync(ocrDir, { recursive: true });
          }
          fs.writeFileSync(
            path.join(ocrDir, "easyocr_results.json"),
            JSON.stringify(emptyResults)
          );
          console.log("Fichier de résultats vide créé");
        } catch (e) {
          console.error(
            "Erreur lors de la création du fichier de résultats vide:",
            e
          );
        }
      } else {
        try {
          const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
          console.log(`Résultats EasyOCR: ${results.length} éléments trouvés`);

          // Afficher quelques résultats pour le débogage
          if (results.length > 0) {
            console.log("Premier résultat:", results[0]);
          }
        } catch (e) {
          console.error("Erreur lors de la lecture des résultats JSON:", e);
        }
      }

      // Sauvegarder la sortie complète pour le débogage
      fs.writeFileSync(path.join("ocr", "easyocr_output.txt"), stdout);
      fs.writeFileSync(path.join("ocr", "easyocr_error.txt"), stderr);

      // La route /ocr lira directement le fichier JSON généré
      resolve();
    });

    // Gérer les erreurs de lancement du processus
    pythonProcess.on("error", (err) => {
      console.error("Erreur lors du lancement du processus Python:", err);

      // Tentative de secours si le premier appel échoue - utiliser un fichier batch
      console.log("Erreur avec conda run, tentative avec script batch...");

      // Créer un script batch temporaire pour activer conda et exécuter le script Python
      const batchFile = path.join(__dirname, "temp_run_easyocr.bat");
      fs.writeFileSync(
        batchFile,
        `@echo off
call conda activate ezmeme
python "${pythonScript}" "./frames" --lang ${language} --gpu ${gpuFlag}
exit /b %ERRORLEVEL%`
      );

      const backupProcess = spawn("cmd.exe", ["/c", batchFile], { env });

      let backupStdout = "";
      let backupStderr = "";

      backupProcess.stdout.on("data", (data) => {
        backupStdout += data.toString();
        console.log(`Sortie Python (secours): ${data}`);
      });

      backupProcess.stderr.on("data", (data) => {
        backupStderr += data.toString();
        console.error(`Erreur Python (secours): ${data}`);
      });

      backupProcess.on("close", (backupCode) => {
        // Supprimer le fichier batch temporaire
        try {
          fs.unlinkSync(batchFile);
        } catch (e) {
          console.warn("Erreur lors de la suppression du batch temporaire:", e);
        }

        if (backupCode !== 0) {
          console.error(
            "La tentative de secours a également échoué:",
            backupCode
          );
          reject(err);
        } else {
          console.log("La tentative de secours a réussi!");
          // Sauvegarder la sortie complète pour le débogage
          fs.writeFileSync(
            path.join("ocr", "easyocr_output.txt"),
            backupStdout
          );
          fs.writeFileSync(path.join("ocr", "easyocr_error.txt"), backupStderr);
          resolve();
        }
      });

      backupProcess.on("error", (backupErr) => {
        console.error("Toutes les tentatives ont échoué:", backupErr);
        reject(err);
      });
    });
  });
}

// Endpoint pour récupérer l'URL directe d'une vidéo Instagram
app.post("/get-video-url", async (req, res) => {
  console.log("Récupération de l'URL vidéo pour:", req.body.url);
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL manquante" });
  }

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
      ],
    });

    const page = await browser.newPage();

    // Intercepter les requêtes réseau pour trouver les fichiers mp4
    let videoUrls = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes(".mp4") && response.status() === 200) {
        console.log("URL vidéo détectée dans les réponses:", url);
        videoUrls.push(url);
      }
    });

    // Augmenter les timeouts pour s'assurer que la page se charge complètement
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Attendre un peu plus pour être sûr de capturer toutes les requêtes
    await page.waitForTimeout(5000);

    // Si on n'a pas trouvé de vidéo via l'interception, chercher dans le DOM
    if (videoUrls.length === 0) {
      console.log("Recherche de vidéos dans le DOM...");
      const foundInDom = await page.evaluate(() => {
        // Chercher les éléments vidéo
        const videos = document.querySelectorAll("video");
        for (const video of videos) {
          if (video.src && video.src.includes("mp4")) return video.src;
        }

        // Chercher les sources vidéo
        const sources = document.querySelectorAll("source");
        for (const source of sources) {
          if (source.src && source.src.includes("mp4")) return source.src;
        }

        return null;
      });

      if (foundInDom) {
        console.log("Vidéo trouvée dans le DOM:", foundInDom);
        videoUrls.push(foundInDom);
      }
    }

    await browser.close();

    // Sélectionner la meilleure URL vidéo (la dernière est souvent la meilleure qualité)
    const videoUrl =
      videoUrls.length > 0 ? videoUrls[videoUrls.length - 1] : null;
    console.log("URL vidéo finale sélectionnée:", videoUrl);

    return res.json({ videoUrl });
  } catch (error) {
    console.error("Erreur lors de la récupération de l'URL vidéo:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint pour obtenir l'URL de téléchargement d'une vidéo via fastvideosave
app.post("/download-video-url", async (req, res) => {
  console.log(
    "Récupération du lien de téléchargement vidéo pour:",
    req.body.url
  );
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL manquante" });
  }

  try {
    // Utiliser directement la fonction existante handleVideoDownload
    // qui utilise fastvideosave.net et est éprouvée
    console.log("Utilisation de handleVideoDownload pour obtenir l'URL vidéo");

    // D'abord essayer avec l'URL directe
    try {
      const directResponse = await fetch(`${API_URL}/get-video-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (directResponse.ok) {
        const result = await directResponse.json();
        if (result.videoUrl) {
          console.log("URL vidéo directe trouvée:", result.videoUrl);
          return res.json({ videoUrl: result.videoUrl });
        }
      }
    } catch (directError) {
      console.warn("Échec de la récupération directe:", directError);
    }

    // Sinon utiliser la fonction de téléchargement complète
    const videoPath = await handleVideoDownload(url);
    console.log("Vidéo téléchargée localement:", videoPath);

    // Créer une URL pour servir le fichier
    const videoUrl = `${req.protocol}://${req.get(
      "host"
    )}/downloads/${path.basename(videoPath)}`;
    console.log("URL de téléchargement générée:", videoUrl);

    return res.json({ videoUrl });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération du lien de téléchargement vidéo:",
      error
    );
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint pour obtenir l'URL de téléchargement d'un audio
app.post("/download-audio-url", async (req, res) => {
  console.log(
    "Récupération du lien de téléchargement audio pour:",
    req.body.url
  );
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL manquante" });
  }

  try {
    // Utiliser directement la fonction existante handleAudioDownload
    // qui utilise fastvideosave.net et est éprouvée
    console.log("Utilisation de handleAudioDownload pour obtenir l'URL audio");

    // Récupérer d'abord l'URL de la vidéo pour essayer avec mp3.videodropper.app
    try {
      const videoResponse = await fetch(`${API_URL}/get-video-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (videoResponse.ok) {
        const videoResult = await videoResponse.json();
        if (videoResult.videoUrl) {
          // Utiliser l'API mp3.videodropper.app avec l'URL vidéo
          const audioUrl = `https://mp3.videodropper.app/api?url=${encodeURIComponent(
            videoResult.videoUrl
          )}`;
          console.log("URL audio générée avec mp3.videodropper.app:", audioUrl);
          return res.json({ audioUrl });
        }
      }
    } catch (videoError) {
      console.warn("Échec de la récupération de l'URL vidéo:", videoError);
    }

    // Sinon utiliser la fonction de téléchargement audio complète
    const audioPath = await handleAudioDownload(url);
    console.log("Audio téléchargé localement:", audioPath);

    // Créer une URL pour servir le fichier
    const audioUrl = `${req.protocol}://${req.get(
      "host"
    )}/downloads/${path.basename(audioPath)}`;
    console.log("URL de téléchargement audio générée:", audioUrl);

    return res.json({ audioUrl });
  } catch (error) {
    console.error(
      "Erreur lors de la récupération du lien de téléchargement audio:",
      error
    );
    return res.status(500).json({ error: error.message });
  }
});

// Nouvelle route pour le téléchargement direct de vidéos Instagram
app.post("/direct-download-video", async (req, res) => {
  try {
    console.log("Requête de téléchargement direct vidéo reçue:", req.body);
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    const result = await directDownloadVideo(url);

    if (!result.success) {
      throw new Error(result.error || "Échec du téléchargement de la vidéo");
    }

    // Utiliser le nouveau endpoint de téléchargement
    const videoUrl = `/download/video/reel_complete.mp4`;

    res.json({
      success: true,
      videoUrl: videoUrl,
    });
  } catch (error) {
    console.error("Erreur lors du téléchargement:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Nouvelle route pour le téléchargement direct de l'audio Instagram
app.post("/direct-download-audio", async (req, res) => {
  try {
    console.log("Requête de téléchargement direct audio reçue:", req.body);
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    // Utiliser la même méthode que pour la vidéo car elle télécharge déjà l'audio
    const result = await directDownloadVideo(url);

    if (!result.success) {
      throw new Error(result.error || "Échec du téléchargement de l'audio");
    }

    // S'assurer que l'URL pointe vers un fichier MP3
    const audioUrl = `/download/audio/reel_audio.mp3`;

    // Vérifier que le fichier existe bien
    const audioPath = path.join(__dirname, "downloads", "reel_audio.mp3");
    if (!fs.existsSync(audioPath)) {
      console.warn("Le fichier audio MP3 n'existe pas:", audioPath);
      // Si le fichier MP3 n'existe pas, vérifier si une version MP4 existe
      const audioPathMP4 = path.join(__dirname, "downloads", "reel_audio.mp4");
      if (fs.existsSync(audioPathMP4)) {
        console.log(
          "Fichier audio MP4 trouvé à la place, l'API va essayer de le servir:",
          audioPathMP4
        );
      } else {
        console.error("Aucun fichier audio trouvé (ni MP3 ni MP4)");
      }
    } else {
      console.log("Fichier audio MP3 trouvé:", audioPath);
    }

    res.json({
      success: true,
      audioUrl: audioUrl,
    });
  } catch (error) {
    console.error("Erreur lors du téléchargement:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoint pour télécharger directement des fichiers depuis le serveur
app.get("/download/:type/:filename", (req, res) => {
  const { type, filename } = req.params;

  // Vérifier le type de fichier demandé
  if (type !== "video" && type !== "audio" && type !== "archive") {
    return res.status(400).send("Type de fichier invalide");
  }

  // Pour le type archive, utiliser directement le nom de fichier
  if (type === "archive") {
    const archivePath = path.join(__dirname, "downloads", filename);
    if (!fs.existsSync(archivePath)) {
      return res.status(404).send("Archive non trouvée");
    }

    const stat = fs.statSync(archivePath);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const fileStream = fs.createReadStream(archivePath);
    fileStream.pipe(res);
    return;
  }

  // Adapter le nom de fichier pour l'audio (reel_audio.mp3 ou reel_audio.mp4)
  let actualFilename = filename;
  let alternativeFilename = null;

  if (type === "audio") {
    // Si on demande reel_audio.mp4, on cherche aussi reel_audio.mp3
    if (filename.endsWith(".mp4")) {
      alternativeFilename = filename.replace(".mp4", ".mp3");
    }
    // Si on demande reel_audio.mp3, on cherche aussi reel_audio.mp4
    else if (filename.endsWith(".mp3")) {
      alternativeFilename = filename.replace(".mp3", ".mp4");
    }
  }

  // Construire le chemin du fichier principal
  const filePath = path.join(__dirname, "downloads", actualFilename);
  let alternativePath = null;

  if (alternativeFilename) {
    alternativePath = path.join(__dirname, "downloads", alternativeFilename);
  }

  // Vérifier si le fichier principal existe, sinon essayer l'alternatif
  let finalPath = filePath;
  let finalFilename = actualFilename;

  if (
    !fs.existsSync(filePath) &&
    alternativePath &&
    fs.existsSync(alternativePath)
  ) {
    console.log(
      `Fichier principal non trouvé: ${filePath}, utilisation de l'alternatif: ${alternativePath}`
    );
    finalPath = alternativePath;
    finalFilename = alternativeFilename;
  } else if (!fs.existsSync(filePath)) {
    console.error(`Fichier non trouvé: ${filePath}`);
    if (alternativePath) {
      console.error(`Alternative également non trouvée: ${alternativePath}`);
    }
    return res.status(404).send("Fichier non trouvé");
  }

  // Obtenir la taille du fichier
  const stat = fs.statSync(finalPath);

  // Déterminer le type MIME
  let contentType = "application/octet-stream";
  const ext = path.extname(finalPath).toLowerCase();

  if (ext === ".mp4") {
    contentType = type === "audio" ? "audio/mp4" : "video/mp4";
  } else if (ext === ".mp3") {
    contentType = "audio/mpeg";
  }

  console.log(
    `Téléchargement de fichier: ${finalFilename}, Chemin: ${finalPath}, Type: ${contentType}, Taille: ${stat.size} octets`
  );

  // Configurer les en-têtes pour le téléchargement
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${finalFilename}"`
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Range"
  );
  res.setHeader("Cache-Control", "no-cache");

  // Créer un stream de lecture
  const fileStream = fs.createReadStream(finalPath);

  // Gérer les erreurs de stream
  fileStream.on("error", (error) => {
    console.error(`Erreur lors du streaming du fichier: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).send("Erreur lors du streaming du fichier");
    }
  });

  // Pipe le fichier vers la réponse
  fileStream.pipe(res);
});

// Fonction pour télécharger directement une vidéo Instagram
async function directDownloadVideo(url) {
  console.log("Téléchargement direct de la vidéo:", url);

  // Créer le répertoire de sortie si nécessaire
  const outputDir = "./downloads";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Chemins des fichiers
  const completeVideoPath = path.join(outputDir, "reel_complete.mp4");
  const audioPath = path.join(outputDir, "reel_audio.mp3"); // Toujours utiliser .mp3 pour l'audio

  try {
    // Lancer Puppeteer en mode headless "new"
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();

    // Optimiser les performances
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      // Bloquer les ressources non essentielles
      if (
        ["image", "stylesheet", "font", "media"].includes(
          request.resourceType()
        )
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Objet pour stocker les segments vidéo et audio
    const segments = {
      video: {},
      audio: {},
    };

    // Intercepter les réponses pour capturer les segments
    page.on("response", async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("video") && !url.startsWith("blob:")) {
          const buffer = await response.buffer();
          const urlParams = new URLSearchParams(url.split("?")[1]);
          const bytestart = parseInt(urlParams.get("bytestart") || "0");
          const byteend = parseInt(urlParams.get("byteend") || "0");

          // Détection rapide du type de segment
          let type = null;
          if (
            url.includes("dash_ln_heaac_vbr3_audio") ||
            url.includes("t16/f2/m69")
          ) {
            type = "audio";
          } else if (url.includes("t2/f2/m86") || buffer.length > 100000) {
            type = "video";
          }

          if (type) {
            const baseUrl = url.split("?")[0];
            if (!segments[type][baseUrl]) {
              segments[type][baseUrl] = [];
            }
            segments[type][baseUrl].push({ buffer, bytestart, byteend });
          }
        }
      } catch (e) {
        console.error("Erreur lors de l'interception de la réponse:", e);
      }
    });

    try {
      // Navigation optimisée
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      await page.waitForSelector("video", { timeout: 10000 });

      // Forcer la lecture pour déclencher le chargement
      await page.evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.play().catch(() => {});
        }
      });

      // Attendre le chargement complet
      await page.waitForTimeout(10000);

      // Combiner les segments
      const combineSegments = (typeSegments) => {
        const combinedBuffers = [];
        for (const baseUrl in typeSegments) {
          const segments = typeSegments[baseUrl].sort(
            (a, b) => a.bytestart - b.bytestart
          );
          segments.forEach((segment) => combinedBuffers.push(segment.buffer));
        }
        return combinedBuffers.length > 0
          ? Buffer.concat(combinedBuffers)
          : Buffer.alloc(0);
      };

      const videoBuffer = combineSegments(segments.video);
      const audioBuffer = combineSegments(segments.audio);

      // Fusion directe avec ffmpeg
      if (videoBuffer.length > 0 && audioBuffer.length > 0) {
        // Créer des fichiers temporaires
        const tempVideoPath = path.join(outputDir, "_temp_video.mp4");
        const tempAudioPath = path.join(outputDir, "_temp_audio.mp4");

        fs.writeFileSync(tempVideoPath, videoBuffer);
        fs.writeFileSync(tempAudioPath, audioBuffer);

        // Convertir l'audio en MP3
        await new Promise((resolve, reject) => {
          const ffmpegProcess = spawn(ffmpegStatic, [
            "-i",
            tempAudioPath,
            "-c:a",
            "libmp3lame",
            "-q:a",
            "2",
            "-y",
            audioPath,
          ]);

          ffmpegProcess.stderr.on("data", (data) => {
            console.log(`FFmpeg (audio): ${data}`);
          });

          ffmpegProcess.on("close", (code) => {
            if (code === 0) {
              console.log("Conversion audio MP3 réussie:", audioPath);
              resolve();
            } else {
              console.error(
                `FFmpeg audio a échoué avec le code ${code}, tentative de méthode alternative...`
              );
              // Alternative en cas d'échec: extraire l'audio directement de la vidéo
              const altFfmpegProcess = spawn(ffmpegStatic, [
                "-i",
                tempVideoPath,
                "-q:a",
                "0",
                "-map",
                "a",
                "-y",
                audioPath,
              ]);

              altFfmpegProcess.stderr.on("data", (altData) => {
                console.log(`FFmpeg (extraction audio alt): ${altData}`);
              });

              altFfmpegProcess.on("close", (altCode) => {
                if (altCode === 0) {
                  console.log(
                    "Extraction audio alternative réussie:",
                    audioPath
                  );
                  resolve();
                } else {
                  console.error(
                    `Extraction audio alternative a échoué avec le code ${altCode}`
                  );
                  reject(new Error(`Échec de l'extraction audio`));
                }
              });
            }
          });
        });

        // Fusionner la vidéo et l'audio
        await new Promise((resolve, reject) => {
          const ffmpegProcess = spawn(ffmpegStatic, [
            "-i",
            tempVideoPath,
            "-i",
            audioPath,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-y",
            completeVideoPath,
          ]);

          ffmpegProcess.stderr.on("data", (data) => {
            console.log(`FFmpeg (fusion): ${data}`);
          });

          ffmpegProcess.on("close", (code) => {
            // Nettoyer les fichiers temporaires
            try {
              fs.unlinkSync(tempVideoPath);
              fs.unlinkSync(tempAudioPath);
            } catch (e) {
              console.error(
                "Erreur lors du nettoyage des fichiers temporaires:",
                e
              );
            }

            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`FFmpeg fusion a échoué avec le code ${code}`));
            }
          });
        });

        console.log("Fichiers créés avec succès:", {
          video: completeVideoPath,
          audio: audioPath,
        });
      } else {
        throw new Error("Segments vidéo ou audio manquants");
      }

      return {
        success: true,
        videoPath: completeVideoPath,
        audioPath: audioPath,
      };
    } catch (error) {
      console.error("Erreur lors du téléchargement:", error);
      throw error;
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error("Erreur dans directDownloadVideo:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Nouvel endpoint pour traiter toutes les actions en une seule requête
app.post("/process-all", async (req, res) => {
  try {
    console.log("Requête process-all reçue:", req.body);
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    console.log("Traitement complet pour:", url);

    // Nettoyer uniquement les dossiers frames et ocr, pas downloads
    cleanDirectories(["frames", "ocr"]);

    // Créer un objet pour stocker tous les résultats
    const results = {
      success: true,
      videoUrl: null,
      audioUrl: null,
      description: "",
      hashtags: [],
      text: "",
      correctedTexts: [],
    };

    try {
      // Étape 1: Extraire les métadonnées
      console.log("1. Extraction des métadonnées...");
      const metadataResult = await scrapeInstagram(url);

      if (metadataResult) {
        results.description = metadataResult.description || "";
        results.hashtags = metadataResult.hashtags || [];
        console.log("Métadonnées extraites:", {
          description:
            results.description.substring(0, 50) +
            (results.description.length > 50 ? "..." : ""),
          hashtags: results.hashtags,
        });
      }

      // Étape 2: Vérifier si la vidéo et l'audio existent déjà ou les télécharger
      console.log("2. Vérification/téléchargement des médias...");
      const videoPath = path.join("downloads", "reel_complete.mp4");
      const audioPath = path.join("downloads", "reel_audio.mp3");
      let mediasExist = false;

      // Vérifier si les fichiers existent déjà
      if (fs.existsSync(videoPath) && fs.existsSync(audioPath)) {
        console.log("Vidéo et audio déjà disponibles, réutilisation...");
        mediasExist = true;
      } else {
        console.log("Téléchargement de la vidéo et de l'audio...");
        const videoResult = await directDownloadVideo(url);

        if (!videoResult.success) {
          throw new Error("Échec du téléchargement de la vidéo");
        }
        mediasExist = true;
      }

      if (!mediasExist || !fs.existsSync(videoPath)) {
        throw new Error("La vidéo n'a pas pu être trouvée ou téléchargée");
      }

      // Créer les URLs pour les fichiers
      results.videoUrl = `/download/video/reel_complete.mp4`;
      results.audioUrl = `/download/audio/reel_audio.mp3`;
      console.log("Liens générés:", {
        videoUrl: results.videoUrl,
        audioUrl: results.audioUrl,
      });

      // Étape 3: Extraire les frames et faire l'OCR
      console.log("3. Extraction des frames...");
      await extractFrames(videoPath);

      // Vérifier que les frames ont été extraites
      const framesDir = "./frames";
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }

      const frames = fs
        .readdirSync(framesDir)
        .filter((file) => file.toLowerCase().endsWith(".jpg"));

      console.log(`${frames.length} frames extraites pour l'OCR`);

      if (frames.length > 0) {
        // Étape 4: Traitement OCR des frames
        console.log("4. Analyse OCR du texte dans la vidéo...");
        await processImagesWithEasyOCR("fra");

        // Vérifier les résultats OCR
        const resultsPath = path.join("ocr", "easyocr_results.json");
        if (fs.existsSync(resultsPath)) {
          const jsonResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
          console.log(
            `${jsonResults.length} blocs de texte détectés dans les frames`
          );

          // Filtrer et transformer les résultats
          const significantResults = jsonResults
            .filter((r) => r.is_significant !== false)
            .map((r) => ({
              frame: r.image,
              text: r.text,
              textType: r.text_type || "raw",
              confidence: r.confidence || 0,
            }));

          // Si nous avons des résultats corrigés, les utiliser
          if (
            significantResults.some(
              (r) => r.textType && r.textType === "corrected"
            )
          ) {
            results.correctedTexts = significantResults.filter(
              (r) => r.textType === "corrected"
            );
            console.log(
              `${results.correctedTexts.length} textes corrigés par l'IA trouvés`
            );
          } else {
            // Sinon, utiliser tous les résultats significatifs
            results.text = significantResults
              .map((r) => r.text)
              .filter((t) => t && t.trim())
              .join("\n\n");
            console.log(
              `Texte brut compilé (${results.text.length} caractères)`
            );
          }
        } else {
          console.warn("Aucun résultat OCR n'a été généré");
        }
      } else {
        console.warn("Aucune frame extraite pour l'OCR");
      }

      // Renvoyer tous les résultats collectés
      console.log("Traitement complet terminé, envoi des résultats...");
      return res.json(results);
    } catch (processingError) {
      console.error("Erreur pendant le traitement:", processingError);
      throw processingError;
    }
  } catch (error) {
    console.error("Erreur globale dans process-all:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Une erreur est survenue lors du traitement",
    });
  }
});

// Nouvelle route pour le traitement OCR direct
app.post("/direct-process-ocr", async (req, res) => {
  try {
    console.log("Requête de traitement OCR direct reçue:", req.body);
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    // Nettoyer uniquement les dossiers frames et ocr, pas downloads
    cleanDirectories(["frames", "ocr"]);

    // Phase 1: Vérifier si la vidéo existe déjà ou télécharger
    console.log("1. Vérification/téléchargement de la vidéo...");
    const videoPath = path.join("downloads", "reel_complete.mp4");
    let videoExists = false;

    // Vérifier si la vidéo existe déjà
    if (fs.existsSync(videoPath)) {
      console.log("La vidéo existe déjà dans downloads, réutilisation...");
      videoExists = true;
    } else {
      console.log("Vidéo non trouvée, téléchargement en cours...");
      const videoDownloadResult = await directDownloadVideo(url);
      console.log("Résultat du téléchargement vidéo:", videoDownloadResult);

      if (!videoDownloadResult.success) {
        throw new Error("Échec du téléchargement de la vidéo pour l'OCR");
      }
      videoExists = true;
    }

    if (!videoExists || !fs.existsSync(videoPath)) {
      throw new Error("La vidéo n'a pas pu être trouvée ou téléchargée");
    }

    // Phase 2: Extraction des frames
    console.log("2. Extraction des frames de la vidéo...");
    console.log("Chemin de la vidéo pour extraction:", videoPath);

    await extractFrames(videoPath);

    // Vérifier que les frames ont été créées
    const framesDir = "./frames";
    const frames = fs.readdirSync(framesDir);
    console.log(`Nombre de frames extraites : ${frames.length}`);

    if (frames.length === 0) {
      throw new Error("Aucune frame n'a été extraite de la vidéo");
    }

    // Phase 3: Traitement OCR avec EasyOCR + ChatGPT pour la correction
    console.log("3. Démarrage de l'analyse OCR avancée avec EasyOCR...");

    let correctedTexts = [];
    let text = "";

    // Utiliser EasyOCR avec correction IA
    await processImagesWithEasyOCR("fra");
    console.log("Traitement EasyOCR terminé, vérification des résultats...");

    // Vérifier si le fichier de résultats JSON existe
    const resultsPath = path.join("ocr", "easyocr_results.json");
    if (fs.existsSync(resultsPath)) {
      const jsonResults = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
      console.log(
        `Lecture de ${jsonResults.length} résultats JSON depuis ${resultsPath}`
      );

      // Filtrer et transformer les résultats
      const significantResults = jsonResults
        .filter((r) => r.is_significant !== false)
        .map((r) => ({
          frame: r.image,
          text: r.text,
          textType: r.text_type || "raw",
          confidence: r.confidence || 0,
        }));

      // Si nous avons des résultats corrigés, les utiliser
      if (
        significantResults.some((r) => r.textType && r.textType === "corrected")
      ) {
        correctedTexts = significantResults.filter(
          (r) => r.textType === "corrected"
        );
        console.log(
          `${correctedTexts.length} textes corrigés par l'IA détectés`
        );
      } else {
        // Sinon, utiliser tous les résultats significatifs
        text = significantResults
          .map((r) => r.text)
          .filter((t) => t && t.trim())
          .join("\n\n");
        console.log(`Texte brut compilé (${text.length} caractères)`);
      }
    } else {
      console.warn("Aucun fichier de résultats OCR n'a été généré");
    }

    console.log("Envoi des résultats OCR au client...");
    res.json({
      success: true,
      text: text,
      correctedTexts: correctedTexts,
    });
  } catch (error) {
    console.error("Erreur dans direct-process-ocr:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Erreur lors du traitement OCR",
    });
  }
});

// Nouvelle route pour l'extraction directe des métadonnées
app.post("/direct-extract-metadata", async (req, res) => {
  try {
    console.log(
      "Requête d'extraction directe des métadonnées reçue:",
      req.body
    );
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    console.log(
      "Utilisation de la fonction scrapeInstagram pour l'extraction..."
    );
    try {
      // Utiliser notre fonction robuste scrapeInstagram
      const { description, hashtags } = await scrapeInstagram(url);

      console.log("Métadonnées extraites avec succès:", {
        description: description
          ? description.substring(0, 50) +
            (description.length > 50 ? "..." : "")
          : "Aucune",
        hashtags: hashtags || [],
      });

      // Retourner les métadonnées
      return res.json({
        success: true,
        description: description || "",
        hashtags: hashtags || [],
      });
    } catch (error) {
      console.error("Erreur lors de l'extraction des métadonnées:", error);
      throw new Error(
        "Échec de l'extraction des métadonnées: " + error.message
      );
    }
  } catch (error) {
    console.error(
      "Erreur lors de l'extraction directe des métadonnées:",
      error
    );
    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de l'extraction des métadonnées",
    });
  }
});

// Nouvelle route pour télécharger tout (vidéo + audio) en une seule requête
app.post("/download-all", async (req, res) => {
  try {
    console.log("Requête de téléchargement complet reçue:", req.body);
    const { url } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    // Télécharger la vidéo et l'audio
    console.log("Démarrage du téléchargement complet pour:", url);
    const result = await directDownloadVideo(url);

    if (!result.success) {
      throw new Error(result.error || "Échec du téléchargement");
    }

    // Vérifier que les fichiers existent bien
    const videoPath = path.join(__dirname, "downloads", "reel_complete.mp4");
    const audioPath = path.join(__dirname, "downloads", "reel_audio.mp3");

    if (!fs.existsSync(videoPath)) {
      throw new Error("Le fichier vidéo n'a pas été créé");
    }

    const audioExists = fs.existsSync(audioPath);
    if (!audioExists) {
      console.warn("Le fichier audio MP3 n'existe pas, tentative avec MP4");
      const audioPathMP4 = path.join(__dirname, "downloads", "reel_audio.mp4");
      if (!fs.existsSync(audioPathMP4)) {
        console.error("Aucun fichier audio trouvé (ni MP3 ni MP4)");
      }
    }

    // Créer une archive ZIP contenant la vidéo et l'audio
    const timestamp = Date.now();
    const archiveName = `instagram_${timestamp}.zip`;
    const archivePath = path.join(__dirname, "downloads", archiveName);

    try {
      // Supprimer le fichier ZIP s'il existe déjà
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      // Créer un processus ZIP avec la commande native
      console.log("Création de l'archive ZIP...");

      // Déterminer le chemin audio correct à utiliser
      const actualAudioPath = audioExists
        ? audioPath
        : path.join(__dirname, "downloads", "reel_audio.mp4");

      // Commande PowerShell pour créer le ZIP
      const zipProcess = spawn("powershell", [
        "-Command",
        `Compress-Archive -Path "${videoPath}","${actualAudioPath}" -DestinationPath "${archivePath}" -Force`,
      ]);

      await new Promise((resolve, reject) => {
        zipProcess.on("close", (code) => {
          if (code === 0) {
            console.log("Archive ZIP créée avec succès:", archivePath);
            resolve();
          } else {
            console.error("Erreur lors de la création de l'archive ZIP:", code);
            reject(
              new Error(
                `Erreur lors de la création de l'archive ZIP: code ${code}`
              )
            );
          }
        });

        zipProcess.stderr.on("data", (data) => {
          console.error(`Erreur ZIP: ${data}`);
        });
      });

      // Vérifier que l'archive a été créée
      if (!fs.existsSync(archivePath)) {
        throw new Error("L'archive ZIP n'a pas été créée");
      }

      // Renvoyer les URLs pour les fichiers individuels et l'archive
      res.json({
        success: true,
        videoUrl: `/download/video/reel_complete.mp4`,
        audioUrl: `/download/audio/reel_audio.mp3`,
        archiveUrl: `/download/archive/${archiveName}`,
      });
    } catch (zipError) {
      console.error("Erreur lors de la création de l'archive:", zipError);

      // En cas d'échec de création de l'archive, renvoyer quand même les liens individuels
      res.json({
        success: true,
        videoUrl: `/download/video/reel_complete.mp4`,
        audioUrl: `/download/audio/reel_audio.mp3`,
        message:
          "Téléchargement de l'archive indisponible, utilisez les liens individuels",
      });
    }
  } catch (error) {
    console.error("Erreur lors du téléchargement complet:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
