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
import { spawn } from "child_process";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Readable } from "stream";
import os from "os";

// Utilitaire pour mesurer le temps des opérations
const Timer = {
  start: (label) => {
    console.time(`⏱️ ${label}`);
    return { label, startTime: Date.now() };
  },
  end: (timer) => {
    const duration = (Date.now() - timer.startTime) / 1000;
    console.timeEnd(`⏱️ ${timer.label}`);
    console.log(`⏱️ ${timer.label} a pris ${duration.toFixed(2)} secondes`);
    return duration;
  },
};

// Charger les variables d'environnement depuis le fichier .env
dotenv.config();

// Configuration du service EasyOCR
const EASYOCR_SERVICE_PORT = process.env.EASYOCR_SERVICE_PORT || 5000;
const EASYOCR_SERVICE_HOST = process.env.EASYOCR_SERVICE_HOST || "127.0.0.1";
const EASYOCR_SERVICE_URL = `http://${EASYOCR_SERVICE_HOST}:${EASYOCR_SERVICE_PORT}`;
let ocrServiceStarted = false;

// Fonction pour démarrer le service EasyOCR au démarrage du serveur
async function startEasyOCRService() {
  // Vérifier si le service est déjà en cours d'exécution
  try {
    const response = await fetch(`${EASYOCR_SERVICE_URL}/health`, {
      timeout: 1000,
    });
    if (response.ok) {
      console.log("Service EasyOCR déjà en cours d'exécution");
      ocrServiceStarted = true;
      return true;
    }
  } catch (error) {
    console.log("Service EasyOCR non détecté, démarrage...");
  }

  // Utiliser conda run pour démarrer le service Python en arrière-plan
  const condaPath = "conda";
  const condaEnv = "ezmeme";
  const pythonScript = path.join(__dirname, "easyocr", "service.py");

  // Définir les variables d'environnement pour résoudre le problème OpenMP
  const env = {
    ...process.env,
    KMP_DUPLICATE_LIB_OK: "TRUE",
  };

  // Démarrer le service en arrière-plan
  const serviceProcess = spawn(
    condaPath,
    [
      "run",
      "-n",
      condaEnv,
      "python",
      pythonScript,
      "--port",
      EASYOCR_SERVICE_PORT.toString(),
      "--host",
      EASYOCR_SERVICE_HOST,
    ],
    {
      env,
      detached: true, // Exécuter en arrière-plan
      stdio: ["ignore", "pipe", "pipe"], // Rediriger stdout et stderr pour le débogage
    }
  );

  // Écouter la sortie du processus pour le débogage
  serviceProcess.stdout.on("data", (data) => {
    console.log(`Service EasyOCR: ${data}`);
  });

  serviceProcess.stderr.on("data", (data) => {
    console.error(`Erreur Service EasyOCR: ${data}`);
  });

  // Ne pas attendre la fin du processus (il est détaché)
  serviceProcess.unref();

  // Attendre que le service soit prêt (vérification toutes les secondes)
  let attempts = 0;
  const maxAttempts = 30; // Attendre maximum 30 secondes

  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`${EASYOCR_SERVICE_URL}/health`, {
        timeout: 1000,
      });
      if (response.ok) {
        console.log("Service EasyOCR démarré et prêt");
        ocrServiceStarted = true;
        return true;
      }
    } catch (error) {
      // Ignorer les erreurs et réessayer
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
    console.log(`Attente du service EasyOCR... (${attempts}/${maxAttempts})`);
  }

  console.error("Impossible de démarrer le service EasyOCR");
  return false;
}

// Fonction pour utiliser le service EasyOCR via l'API
async function processImageWithEasyOCRService(imagePath, options = {}) {
  const ocrTimer = Timer.start(`OCR image ${path.basename(imagePath)}`);

  if (!ocrServiceStarted) {
    Timer.end(ocrTimer);
    throw new Error("Le service EasyOCR n'est pas démarré");
  }

  // Lire l'image et la convertir en Base64
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  try {
    // Envoyer l'image au service
    const response = await fetch(`${EASYOCR_SERVICE_URL}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: imageBase64,
        use_gpu: options.useGpu !== false, // Par défaut, utiliser le GPU si disponible
        scale_percent: options.scale || 30,
        correct_text: options.correctText || false, // Activer la correction de texte si demandé
      }),
      timeout: 30000, // 30 secondes de timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      Timer.end(ocrTimer);
      throw new Error(
        `Erreur du service OCR: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    const duration = Timer.end(ocrTimer);

    // Ajouter la durée aux résultats
    result.duration = duration;

    return result;
  } catch (error) {
    Timer.end(ocrTimer);
    console.error(`Erreur lors de l'appel au service OCR: ${error.message}`);
    throw error;
  }
}

// Fonction pour traiter plusieurs images avec le service EasyOCR
async function processFramesWithEasyOCRService(framesDir, language = "fra") {
  const totalTimer = Timer.start("Traitement OCR complet");
  console.log(
    `Traitement OCR des frames dans ${framesDir} avec le service EasyOCR...`
  );

  // Vérifier que le dossier frames existe et contient des images
  if (!fs.existsSync(framesDir)) {
    console.error(`Dossier frames non trouvé: ${framesDir}`);
    Timer.end(totalTimer);
    throw new Error(`Dossier frames non trouvé: ${framesDir}`);
  }

  const framePaths = fs
    .readdirSync(framesDir)
    .filter(
      (file) =>
        file.toLowerCase().endsWith(".png") ||
        file.toLowerCase().endsWith(".jpg")
    )
    .map((file) => path.join(framesDir, file));

  if (framePaths.length === 0) {
    console.error("Aucune frame trouvée dans le dossier frames");
    Timer.end(totalTimer);
    throw new Error("Aucune frame à traiter");
  }

  // Options d'optimisation
  const options = {
    useGpu: process.env.EASYOCR_GPU_ENABLED,
    scale: 30, // Redimensionnement à 30%
    correctText: false, // Par défaut, ne pas corriger à l'étape de l'image (mais le faire globalement après)
  };

  console.log(
    `Traitement de ${framePaths.length} images avec options:`,
    options
  );

  // Traiter chaque image
  const results = [];
  const texts = [];
  const processTimer = Timer.start("Traitement OCR des images");

  for (let i = 0; i < framePaths.length; i++) {
    try {
      const imageTimer = Timer.start(`OCR image ${i + 1}/${framePaths.length}`);
      console.log(
        `Traitement de l'image ${i + 1}/${framePaths.length}: ${framePaths[i]}`
      );
      const result = await processImageWithEasyOCRService(
        framePaths[i],
        options
      );
      const imageDuration = Timer.end(imageTimer);

      if (result.text && result.text.trim()) {
        texts.push(result.text);
        results.push({
          text: result.text,
          text_type: "raw",
          image: path.basename(framePaths[i]),
          confidence: 0.7,
          is_significant: result.text.trim().length > 3,
          processing_time: imageDuration,
        });
      }

      console.log(
        `Image ${i + 1} traitée en ${result.performance.total_time.toFixed(
          2
        )}s (GPU=${result.performance.gpu_used})`
      );
      console.log(
        `Texte extrait: ${result.text.substring(0, 100)}${
          result.text.length > 100 ? "..." : ""
        }`
      );
    } catch (error) {
      console.error(
        `Erreur lors du traitement de l'image ${framePaths[i]}: ${error.message}`
      );
    }
  }

  Timer.end(processTimer);

  // Créer le dossier ocr s'il n'existe pas
  const ocrDir = path.join(path.dirname(framesDir), "ocr");
  fs.mkdirSync(ocrDir, { recursive: true });

  // Si nous avons des textes, les corriger avec l'API ChatGPT via le service EasyOCR
  if (texts.length > 0) {
    try {
      console.log(
        `Regroupement et correction des ${texts.length} textes détectés...`
      );
      const correctionTimer = Timer.start("Correction de texte avec l'IA");

      // Envoyer tous les textes au service pour correction
      const response = await fetch(`${EASYOCR_SERVICE_URL}/correct-texts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          texts: texts,
          group_similar: true,
          similarity_threshold: 0.7,
        }),
        timeout: 60000, // 60 secondes de timeout pour la correction
      });

      if (response.ok) {
        const correctionResult = await response.json();
        const correctionDuration = Timer.end(correctionTimer);

        console.log(`Correction des textes terminée`);

        if (correctionResult.success && correctionResult.grouped_corrections) {
          const correctedResults = [];

          // Traiter chaque groupe corrigé
          correctionResult.grouped_corrections.forEach((group, index) => {
            console.log(
              `Groupe ${index + 1}: ${
                group.original_texts.length
              } textes similaires`
            );
            console.log(
              `Texte corrigé: ${group.corrected_text.substring(0, 100)}${
                group.corrected_text.length > 100 ? "..." : ""
              }`
            );

            // Trouver l'image source du premier texte du groupe
            const originalText = group.original_texts[0];
            const originalResult = results.find((r) => r.text === originalText);
            const image = originalResult ? originalResult.image : "unknown";

            // Ajouter le résultat corrigé
            correctedResults.push({
              text: group.corrected_text,
              text_type: "corrected",
              image: image,
              confidence: 0.95, // Haute confiance pour les textes corrigés par IA
              is_significant: group.corrected_text.trim().length > 3,
              original_texts: group.original_texts,
              correction_time: correctionDuration,
            });
          });

          // Ajouter les résultats corrigés à notre liste
          results.push(...correctedResults);

          console.log(
            `${correctedResults.length} groupes de textes corrigés ajoutés`
          );
        }
      } else {
        const errorText = await response.text();
        console.error(`Erreur lors de la correction des textes: ${errorText}`);
        Timer.end(correctionTimer);
      }
    } catch (error) {
      console.error(
        `Erreur lors de l'appel au service de correction: ${error.message}`
      );
      // Continuer sans correction
    }
  }

  // Écrire les résultats
  const writeTimer = Timer.start("Écriture des résultats OCR");
  const outputFile = path.join(ocrDir, "easyocr_results.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), "utf8");
  Timer.end(writeTimer);

  const totalDuration = Timer.end(totalTimer);
  console.log(
    `Traitement OCR terminé en ${totalDuration.toFixed(2)}s, ${
      results.length
    } textes extraits`
  );

  return results;
}

// Middleware de validation d'URL Instagram
const validateInstagramUrl = (req, res, next) => {
  const { url } = req.body;
  if (!url || !url.includes("instagram.com")) {
    return res.status(400).json({
      success: false,
      error: "URL Instagram valide requise",
    });
  }
  next();
};

// Service de gestion des fichiers
const FileService = {
  checkFileExists: (filePath) => {
    return fs.existsSync(filePath);
  },

  getAlternativePath: (filePath, type) => {
    if (type === "audio") {
      const ext = path.extname(filePath);
      return filePath.replace(ext, ext === ".mp3" ? ".mp4" : ".mp3");
    }
    return null;
  },

  getMimeType: (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mp3") return "audio/mpeg";
    return "application/octet-stream";
  },
};

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

// Fonction pour nettoyer un répertoire
async function cleanDirectory(directory) {
  console.log(`Nettoyage du dossier ${directory}...`);
  let deleted = 0;
  let errors = 0;

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    console.log(`Dossier ${directory} créé`);
    return { deleted, errors };
  }

  try {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const filePath = path.join(directory, file);
      try {
        fs.unlinkSync(filePath);
        deleted++;
      } catch (err) {
        console.error(`Erreur lors de la suppression de ${filePath}:`, err);
        errors++;
      }
    }
    console.log(
      `Nettoyage terminé pour ${directory}: ${deleted} fichiers supprimés, ${errors} erreurs`
    );
    return { deleted, errors };
  } catch (err) {
    console.error(`Erreur lors du nettoyage de ${directory}:`, err);
    return { deleted, errors: errors + 1 };
  }
}

async function cleanDirectories(directories) {
  console.log("Nettoyage des dossiers:", directories);
  const results = [];
  for (const directory of directories) {
    const result = await cleanDirectory(directory);
    results.push({ directory, ...result });
  }
  return results;
}

// Nettoyer les répertoires au démarrage
console.log("Nettoyage des répertoires au démarrage...");
dirs.forEach((dir) => {
  cleanDirectory(dir);
});

// Fonction pour nettoyer les fichiers anciens dans le dossier downloads
function cleanDownloadsDirectory(maxAgeHours = 24) {
  console.log(
    `Nettoyage des fichiers de plus de ${maxAgeHours} heures dans downloads...`
  );
  const downloadsDir = path.join(__dirname, "downloads");

  if (!fs.existsSync(downloadsDir)) {
    console.log(`Le dossier ${downloadsDir} n'existe pas encore`);
    return;
  }

  try {
    const files = fs.readdirSync(downloadsDir);
    const now = Date.now();
    let cleanedCount = 0;

    files.forEach((file) => {
      const filePath = path.join(downloadsDir, file);

      try {
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtimeMs;
        const fileAgeHours = fileAge / (1000 * 60 * 60);

        // Supprimer les fichiers plus anciens que maxAgeHours
        if (fileAgeHours > maxAgeHours) {
          fs.unlinkSync(filePath);
          cleanedCount++;
          console.log(
            `Fichier ancien supprimé: ${file} (${Math.round(fileAgeHours)}h)`
          );
        }
      } catch (err) {
        console.warn(
          `Erreur lors de la vérification/suppression du fichier ${file}: ${err.message}`
        );
      }
    });

    console.log(
      `Nettoyage terminé: ${cleanedCount} fichiers supprimés de downloads`
    );
  } catch (err) {
    console.error(
      `Erreur lors du nettoyage du dossier downloads: ${err.message}`
    );
  }
}

// Lancer un nettoyage initial au démarrage du serveur
cleanDownloadsDirectory();

// Programmer un nettoyage périodique toutes les 12 heures
setInterval(() => {
  cleanDownloadsDirectory();
}, 12 * 60 * 60 * 1000);

// Ajouter une fonction de gestion des fichiers de logs OCR
// Ajouter après cleanDownloadsDirectory

// Fonction pour gérer la rotation des fichiers de logs OCR
function manageOcrLogs(maxFiles = 5, maxSizeMB = 10) {
  console.log(
    `Rotation des fichiers de logs OCR (max ${maxFiles} fichiers, ${maxSizeMB}MB max)...`
  );
  const ocrDir = path.join(__dirname, "ocr");

  if (!fs.existsSync(ocrDir)) {
    console.log(`Le dossier OCR ${ocrDir} n'existe pas encore`);
    return;
  }

  try {
    // Traiter les fichiers de logs
    const logExtensions = [".txt"];
    const files = fs
      .readdirSync(ocrDir)
      .filter((file) => logExtensions.some((ext) => file.endsWith(ext)))
      .map((file) => {
        const filePath = path.join(ocrDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: stats.size,
          mtime: stats.mtime.getTime(),
        };
      });

    // Vérifier les fichiers trop volumineux
    let oversizedCount = 0;
    files.forEach((file) => {
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > maxSizeMB) {
        try {
          // Pour les fichiers trop gros, garder uniquement les dernières lignes
          const content = fs.readFileSync(file.path, "utf8");
          const lines = content.split("\n");

          // Garder les 1000 dernières lignes uniquement
          if (lines.length > 1000) {
            const truncatedContent = lines.slice(-1000).join("\n");
            fs.writeFileSync(file.path, truncatedContent);
            oversizedCount++;
            console.log(
              `Fichier ${file.name} tronqué (${fileSizeMB.toFixed(2)}MB -> ~${
                truncatedContent.length / 1024 / 1024
              }MB)`
            );
          }
        } catch (err) {
          console.warn(
            `Erreur lors de la troncature du fichier ${file.name}: ${err.message}`
          );
        }
      }
    });

    // Si trop de fichiers, supprimer les plus anciens
    if (files.length > maxFiles) {
      // Trier par date (plus ancien en premier)
      files.sort((a, b) => a.mtime - b.mtime);

      // Supprimer les fichiers les plus anciens
      const toDelete = files.slice(0, files.length - maxFiles);
      toDelete.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
          console.log(`Ancien fichier de log supprimé: ${file.name}`);
        } catch (err) {
          console.warn(
            `Erreur lors de la suppression du fichier ${file.name}: ${err.message}`
          );
        }
      });
    }

    console.log(
      `Rotation des logs OCR terminée: ${oversizedCount} fichiers tronqués, ${
        files.length > maxFiles ? files.length - maxFiles : 0
      } fichiers supprimés`
    );
  } catch (err) {
    console.error(`Erreur lors de la rotation des logs OCR: ${err.message}`);
  }
}

// Appeler cette fonction au démarrage et périodiquement
manageOcrLogs();

// Ajouter la rotation des logs OCR dans le même intervalle que le nettoyage des téléchargements
setInterval(() => {
  manageOcrLogs();
}, 12 * 60 * 60 * 1000);

// Fonction pour extraire les données Instagram
async function scrapeInstagram(url) {
  const scrapingTimer = Timer.start("Scraping Instagram");
  console.log("Scraping Instagram URL:", url);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=site-per-process",
    ],
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

    // Attendre le chargement du contenu avec plus de temps
    await page.waitForSelector("body", { timeout: 15000 });

    // Attendre un peu plus pour que le contenu dynamique se charge
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("Page Instagram chargée, extraction des données...");

    // Extraire la description et les hashtags avec différentes méthodes
    const extractedData = await page.evaluate(() => {
      // Fonction pour extraire les hashtags d'un texte
      function extractHashtags(text) {
        if (!text) return [];
        const hashtagRegex = /#[\p{L}\p{N}_]+/gu;
        return [...new Set(text.match(hashtagRegex) || [])];
      }

      let description = "";
      let hashtags = [];

      // Méthode 1: Utiliser le XPath spécifique
      try {
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
          hashtags = extractHashtags(description);
        }
      } catch (e) {
        console.log("Erreur avec XPath spécifique:", e);
      }

      // Méthode 2: Utiliser des sélecteurs CSS plus généraux si la méthode 1 échoue
      if (!description) {
        try {
          // Essayer de trouver tout texte qui pourrait contenir la description
          const possibleDescElements = Array.from(
            document.querySelectorAll("span, p, h1, h2, div")
          );
          for (const elem of possibleDescElements) {
            const text = elem.textContent?.trim();
            if (text && text.length > 10 && text.length < 2000) {
              const extractedTags = extractHashtags(text);
              if (extractedTags.length > 0) {
                description = text;
                hashtags = extractedTags;
                break;
              }
            }
          }
        } catch (e) {
          console.log("Erreur avec les sélecteurs généraux:", e);
        }
      }

      // Méthode 3: Chercher spécifiquement les hashtags dans toute la page
      if (hashtags.length === 0) {
        try {
          const allText = document.body.innerText;
          hashtags = extractHashtags(allText);

          // Si nous avons des hashtags mais pas de description, créer une description basique
          if (hashtags.length > 0 && !description) {
            description = "Description extraite des hashtags";
          }
        } catch (e) {
          console.log("Erreur avec la recherche de hashtags dans le body:", e);
        }
      }

      return { description, hashtags };
    });

    // Log pour le débogage
    console.log("Données extraites brutes:", JSON.stringify(extractedData));

    // Nettoyage et préparation des données
    let cleanDescription = extractedData.description || "";

    // Éliminer les hashtags de la description pour éviter la duplication
    if (extractedData.hashtags && extractedData.hashtags.length > 0) {
      extractedData.hashtags.forEach((tag) => {
        cleanDescription = cleanDescription.replace(tag, "");
      });
      cleanDescription = cleanDescription.trim();
    }

    // Si après nettoyage la description est vide ou trop courte, gardons l'originale
    if (!cleanDescription || cleanDescription.length < 5) {
      cleanDescription = extractedData.description;
    }

    // Résultat final
    const finalData = {
      description: cleanDescription || "Aucune description disponible",
      hashtags: extractedData.hashtags || [],
    };

    console.log("Données extraites (traitées):", {
      description: finalData.description
        ? finalData.description.substring(0, 50) +
          (finalData.description.length > 50 ? "..." : "")
        : "Non trouvée",
      hashtags: finalData.hashtags,
    });

    const scrapingDuration = Timer.end(scrapingTimer);
    console.log(`Scraping terminé en ${scrapingDuration.toFixed(2)}s`);
    return {
      ...finalData,
      duration: scrapingDuration,
    };
  } catch (error) {
    Timer.end(scrapingTimer);
    console.error("Erreur lors du scraping Instagram:", error);
    // En cas d'erreur, retourner un objet valide plutôt que de lancer une exception
    return {
      description: "Aucune description disponible",
      hashtags: [],
      error: error.message,
    };
  } finally {
    console.log("Fermeture du navigateur...");
    await browser.close();
  }
}

// Ajouter une fonction pour optimiser l'extraction de frames avec ffmpeg
async function extractFramesFromVideo(videoPath, outputFolder, maxFrames = 20) {
  const totalTimer = Timer.start("Extraction des frames");
  console.log(`Extraction de frames pour la vidéo ${videoPath}...`);

  // Créer le dossier de sortie s'il n'existe pas
  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  try {
    // Utiliser ffprobe pour obtenir la durée de la vidéo
    const durationData = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });

    const durationInSeconds = durationData.format.duration;
    console.log(`Durée détectée: ${durationInSeconds} secondes`);

    // Stratégie d'échantillonnage adaptatif pour les mèmes
    let interval, framesTarget;

    if (durationInSeconds < 10) {
      // Vidéos très courtes: maximum de détails car probablement beaucoup de texte en peu de temps
      interval = 2; // 1 frame toutes les 2 secondes
      framesTarget = Math.min(10, Math.ceil(durationInSeconds)); // Max 10 frames
      console.log(
        "Vidéo très courte: échantillonnage fréquent pour capturer tous les textes"
      );
    } else if (durationInSeconds < 15) {
      // Vidéos courtes: échantillonnage assez fréquent
      interval = 2; // 1 frame toutes les 2 secondes
      framesTarget = Math.min(12, Math.ceil(durationInSeconds / 2)); // ~8-10 frames
      console.log("Vidéo courte: échantillonnage toutes les 2 secondes");
    } else if (durationInSeconds < 30) {
      // Vidéos moyennes: échantillonnage modéré
      interval = 3; // 1 frame toutes les 3 secondes
      framesTarget = Math.min(15, Math.ceil(durationInSeconds / 3)); // ~5-10 frames
      console.log("Vidéo moyenne: échantillonnage toutes les 3 secondes");
    } else {
      // Vidéos longues: échantillonnage plus espacé
      interval = 4; // 1 frame toutes les 4 secondes
      framesTarget = Math.min(maxFrames, Math.ceil(durationInSeconds / 4)); // ~8-15 frames selon la longueur
      console.log("Vidéo longue: échantillonnage toutes les 4 secondes");
    }

    // Si la vidéo est très longue, limiter le nombre total de frames
    const finalFramesTarget = Math.min(framesTarget, maxFrames);

    // Ajuster l'intervalle si nécessaire pour respecter le nombre maximum de frames
    const finalInterval = Math.max(
      interval,
      durationInSeconds / finalFramesTarget
    );

    console.log(
      `Stratégie adaptative: intervalle=${finalInterval.toFixed(
        1
      )}s, frames cible=${finalFramesTarget}`
    );

    // Supprimer les anciennes frames si elles existent
    const existingFrames = fs.readdirSync(outputFolder);
    existingFrames.forEach((file) => {
      if (file.endsWith(".jpg") || file.endsWith(".png")) {
        fs.unlinkSync(path.join(outputFolder, file));
      }
    });

    // Configuration optimisée de ffmpeg pour une extraction plus rapide
    const ffmpegTimer = Timer.start("FFmpeg - extraction des frames");
    const ffmpegProcess = ffmpeg(videoPath)
      .setFfmpegPath(ffmpegStatic)
      .outputOptions([
        `-vf fps=1/${finalInterval}`, // Extraire 1 frame par intervalle adaptatif
        "-q:v 3", // Qualité de compression (3 est un compromis entre taille et qualité)
        "-pix_fmt yuv420p", // Format de pixels standard
        "-preset ultrafast", // Utiliser le preset le plus rapide
        "-threads 4", // Utiliser plusieurs threads
      ])
      .output(path.join(outputFolder, "frame-%03d.jpg"))
      .on("start", (cmd) => {
        console.log("Commande FFmpeg:", cmd);
      })
      .on("progress", (progress) => {
        if (progress && progress.percent) {
          console.log(`Progression: ${Math.round(progress.percent)}%`);
        }
      });

    // Exécuter ffmpeg et attendre la fin
    await new Promise((resolve, reject) => {
      ffmpegProcess
        .on("error", (err) => {
          console.error("Erreur lors de l'extraction des frames:", err);
          reject(err);
        })
        .on("end", () => {
          console.log("Extraction des frames terminée");
          resolve();
        })
        .run();
    });
    Timer.end(ffmpegTimer);

    // Vérifier combien de frames ont été extraites
    const extractedFrames = fs
      .readdirSync(outputFolder)
      .filter((file) => file.startsWith("frame-") && file.endsWith(".jpg"));

    console.log(`${extractedFrames.length} frames extraites avec succès`);

    const totalDuration = Timer.end(totalTimer);
    return {
      success: true,
      totalFrames: extractedFrames.length,
      frameFolder: outputFolder,
      duration: totalDuration,
      strategy: {
        videoDuration: durationInSeconds,
        interval: finalInterval,
        framesTarget: finalFramesTarget,
      },
    };
  } catch (error) {
    Timer.end(totalTimer);
    console.error("Erreur lors de l'extraction des frames:", error);
    return {
      success: false,
      error: error.message,
    };
  }
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
app.listen(PORT, async () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);

  // Démarrer le service EasyOCR au démarrage du serveur
  try {
    await startEasyOCRService();
    console.log("Service EasyOCR prêt à l'emploi");
  } catch (error) {
    console.error("Erreur lors du démarrage du service EasyOCR:", error);
    console.log(
      "Le serveur continuera à fonctionner sans service EasyOCR préchargé"
    );
  }
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
    const env = {
      ...process.env,
      // Ajouter la variable d'environnement pour résoudre le problème OpenMP
      KMP_DUPLICATE_LIB_OK: "TRUE",
    };

    // Ajouter les variables d'environnement du fichier .env
    // Elles seront transmises au script Python
    console.log(
      "GPU enabled (à partir de .env):",
      process.env.EASYOCR_GPU_ENABLED
    );
    console.log("Debug mode:", process.env.DEBUG_MODE);

    // Options d'optimisation pour l'OCR
    const scale = 30; // Redimensionnement à 30% pour un bon compromis vitesse/qualité
    const maxImages = 30; // Limiter à 30 images pour un traitement plus rapide
    const fastMode = true; // Toujours utiliser le mode rapide

    // Détection automatique du meilleur mode (GPU/CPU)
    // Nous allons essayer d'utiliser le GPU s'il est disponible dans la configuration
    const useGPU = process.env.EASYOCR_GPU_ENABLED;
    const gpuFlag = useGPU.toString();

    console.log(
      `Options d'optimisation OCR: redimensionnement=${scale}%, max-images=${maxImages}, mode-rapide=${fastMode}, GPU=${gpuFlag}`
    );

    // Construire la commande conda d'une façon plus fiable
    const condaCommand = [
      "run",
      "-n",
      condaEnv,
      "python",
      pythonScript,
      "./frames",
      "--lang",
      language,
      "--gpu",
      gpuFlag,
      "--scale",
      scale.toString(),
      "--max-images",
      maxImages.toString(),
    ];

    if (fastMode) {
      condaCommand.push("--fast");
    }

    console.log(`Exécution avec Conda: ${condaPath} ${condaCommand.join(" ")}`);

    // Mesurer le temps de traitement pour la comparaison de performance
    const startTime = Date.now();

    // Utiliser spawn au lieu de exec
    const pythonProcess = spawn(condaPath, condaCommand, { env });

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
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `Processus Python terminé avec le code: ${code} en ${processingTime} secondes`
      );

      if (code !== 0) {
        console.error(
          "Erreur lors de l'exécution d'EasyOCR, code de sortie:",
          code
        );
        console.error("Sortie d'erreur:", stderr);

        // Retourner l'erreur sans tentative de secours
        return reject(
          new Error(`Échec d'exécution d'EasyOCR (code ${code}): ${stderr}`)
        );
      } else {
        // Écrire les logs OCR avec des streams
        Promise.all([
          writeOcrLog("easyocr_output.txt", stdout),
          writeOcrLog("easyocr_error.txt", stderr),
        ])
          .then(() => {
            console.log("Logs OCR écrits avec succès");
            resolve();
          })
          .catch((err) => {
            console.error("Erreur lors de l'écriture des logs OCR:", err);
            reject(err);
          });
      }
    });
  });
}

// Fonction utilitaire pour écrire les logs OCR en utilisant des streams
function writeOcrLog(logFileName, content) {
  const logPath = path.join("ocr", logFileName);

  // S'assurer que le dossier ocr existe
  if (!fs.existsSync("ocr")) {
    fs.mkdirSync("ocr", { recursive: true });
  }

  return new Promise((resolve, reject) => {
    try {
      // Créer un stream d'écriture
      const writeStream = fs.createWriteStream(logPath);

      // Gérer les événements du stream
      writeStream.on("finish", () => {
        console.log(`Log OCR écrit avec succès: ${logFileName}`);
        resolve();
      });

      writeStream.on("error", (err) => {
        console.error(`Erreur d'écriture du log OCR ${logFileName}:`, err);
        reject(err);
      });

      // Écrire le contenu et fermer le stream
      writeStream.write(content);
      writeStream.end();
    } catch (err) {
      console.error(
        `Erreur lors de la création du stream pour ${logFileName}:`,
        err
      );
      reject(err);
    }
  });
}

// Fonction pour exécuter un script batch temporaire avec conda
function runCondaBatchScript(command, scriptName = "conda_script") {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const batchFile = path.join(os.tmpdir(), `${scriptName}_${timestamp}.bat`);

    try {
      // Créer le fichier batch
      fs.writeFileSync(
        batchFile,
        `@echo off\n${command}\nexit /b %ERRORLEVEL%`
      );
      console.log(`Script batch temporaire créé: ${batchFile}`);

      // Exécuter le script
      const batchProcess = spawn(batchFile, [], { shell: true });
      let stdout = "";
      let stderr = "";

      batchProcess.stdout.on("data", (data) => {
        const output = data.toString();
        stdout += output;
        console.log(`[${scriptName}] ${output.trim()}`);
      });

      batchProcess.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;
        console.error(`[${scriptName}] Erreur: ${output.trim()}`);
      });

      batchProcess.on("close", (code) => {
        console.log(`Script batch ${scriptName} terminé avec code: ${code}`);

        // Toujours essayer de supprimer le fichier batch
        try {
          fs.unlinkSync(batchFile);
          console.log(`Script batch temporaire supprimé: ${batchFile}`);
        } catch (err) {
          console.warn(
            `Erreur lors de la suppression du script batch: ${err.message}`
          );
        }

        if (code === 0) {
          resolve({ code, stdout, stderr });
        } else {
          reject(new Error(`Script batch échoué avec code ${code}`));
        }
      });

      batchProcess.on("error", (err) => {
        console.error(
          `Erreur lors de l'exécution du script batch: ${err.message}`
        );

        // Nettoyer le fichier batch en cas d'erreur
        try {
          fs.unlinkSync(batchFile);
        } catch (cleanupErr) {
          console.warn(
            `Erreur lors du nettoyage du fichier batch: ${cleanupErr.message}`
          );
        }

        reject(err);
      });
    } catch (err) {
      console.error(
        `Erreur lors de la création du script batch: ${err.message}`
      );
      reject(err);
    }
  });
}

// Nouvelle route pour le téléchargement direct de vidéos Instagram
app.post("/direct-download-video", validateInstagramUrl, async (req, res) => {
  try {
    console.log("Requête de téléchargement direct vidéo reçue:", req.body);
    const { url } = req.body;

    const result = await directDownloadVideo(url);

    if (!result.success) {
      throw new Error(result.error || "Échec du téléchargement de la vidéo");
    }

    const videoUrl = `/download/video/reel_complete.mp4`;
    const videoPath = path.join(__dirname, "downloads", "reel_complete.mp4");

    if (!FileService.checkFileExists(videoPath)) {
      throw new Error("Le fichier vidéo n'a pas été créé");
    }

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
app.post("/direct-download-audio", validateInstagramUrl, async (req, res) => {
  try {
    console.log("Requête de téléchargement direct audio reçue:", req.body);
    const { url } = req.body;

    const result = await directDownloadVideo(url);

    if (!result.success) {
      throw new Error(result.error || "Échec du téléchargement de l'audio");
    }

    const audioUrl = `/download/audio/reel_audio.mp3`;
    const audioPath = path.join(__dirname, "downloads", "reel_audio.mp3");

    if (!FileService.checkFileExists(audioPath)) {
      const alternativePath = FileService.getAlternativePath(
        audioPath,
        "audio"
      );
      if (!FileService.checkFileExists(alternativePath)) {
        console.error("Aucun fichier audio trouvé (ni MP3 ni MP4)");
      }
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
    if (!FileService.checkFileExists(archivePath)) {
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

  // Construire le chemin du fichier principal
  const filePath = path.join(__dirname, "downloads", filename);
  let alternativePath = null;

  if (type === "audio") {
    alternativePath = FileService.getAlternativePath(filePath, "audio");
  }

  // Vérifier si le fichier principal existe, sinon essayer l'alternatif
  let finalPath = filePath;
  let finalFilename = filename;

  if (
    !FileService.checkFileExists(filePath) &&
    alternativePath &&
    FileService.checkFileExists(alternativePath)
  ) {
    console.log(
      `Fichier principal non trouvé: ${filePath}, utilisation de l'alternatif: ${alternativePath}`
    );
    finalPath = alternativePath;
    finalFilename = path.basename(alternativePath);
  } else if (!FileService.checkFileExists(filePath)) {
    console.error(`Fichier non trouvé: ${filePath}`);
    if (alternativePath) {
      console.error(`Alternative également non trouvée: ${alternativePath}`);
    }
    return res.status(404).send("Fichier non trouvé");
  }

  // Obtenir la taille du fichier
  const stat = fs.statSync(finalPath);

  // Configurer les en-têtes pour le téléchargement
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Type", FileService.getMimeType(finalPath));
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
  const totalTimer = Timer.start("Téléchargement complet de la vidéo");
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
    const puppeteerTimer = Timer.start("Initialisation Puppeteer");
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    Timer.end(puppeteerTimer);

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

    // Variables pour suivre l'état du chargement
    let hasVideoSegments = false;
    let hasAudioSegments = false;
    let segmentCheckInterval = null;
    let maxWaitTime = 20000; // Augmenté à 20 secondes pour donner plus de temps à la récupération des segments
    let waitStartTime = Date.now();
    let earlySegmentsThreshold = 1; // Réduit de 2 à 1 pour terminer plus rapidement

    // Variables pour suivre la progression
    let lastVideoSegmentCount = 0;
    let lastAudioSegmentCount = 0;
    let noProgressTime = 0;

    // Flag pour suivre si le navigateur est fermé
    let browserClosed = false;

    // Intercepter les réponses pour capturer les segments
    page.on("response", async (response) => {
      try {
        // Ne pas traiter les réponses si le navigateur est déjà fermé
        if (browserClosed) return;

        const url = response.url();
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("video") && !url.startsWith("blob:")) {
          // Vérifier que la réponse peut être traitée
          // Si la réponse a déjà été consommée ou si la cible est fermée, ignorer
          if (
            !response.ok() ||
            (response._request && response._request._interceptionHandled)
          ) {
            return;
          }

          let buffer;
          try {
            buffer = await response.buffer();
          } catch (bufferError) {
            // Si on ne peut pas obtenir le buffer (par exemple si la cible est fermée),
            // ignorer silencieusement cette réponse
            if (
              bufferError.message.includes("Target closed") ||
              bufferError.message.includes("Protocol error")
            ) {
              return;
            }
            throw bufferError;
          }

          const urlParams = new URLSearchParams(url.split("?")[1]);
          const bytestart = parseInt(urlParams.get("bytestart") || "0");
          const byteend = parseInt(urlParams.get("byteend") || "0");

          // Détection rapide du type de segment
          let type = null;
          if (
            url.includes("dash_ln_heaac_vbr3_audio") ||
            url.includes("t16/f2/m69") ||
            url.includes("audio") ||
            (url.includes("instagram.com/api/v1") &&
              contentType.includes("audio")) ||
            (url.includes("instagram.fbru") && contentType.includes("audio"))
          ) {
            type = "audio";
            hasAudioSegments = true;
          } else if (
            url.includes("t2/f2/m86") ||
            url.includes("video") ||
            (url.includes("instagram.com/api/v1") &&
              contentType.includes("video")) ||
            (url.includes("instagram.fbru") && contentType.includes("video")) ||
            buffer.length > 100000
          ) {
            type = "video";
            hasVideoSegments = true;
          }

          if (type) {
            const baseUrl = url.split("?")[0];
            if (!segments[type][baseUrl]) {
              segments[type][baseUrl] = [];
            }
            segments[type][baseUrl].push({ buffer, bytestart, byteend });

            // Afficher l'état du chargement
            console.log(
              `Segment ${type} ajouté, total: vidéo=${
                Object.keys(segments.video).length
              } segments, audio=${Object.keys(segments.audio).length} segments`
            );
          }
        }
      } catch (e) {
        // Ne logguer l'erreur que si ce n'est pas une erreur de fermeture de cible
        if (
          !e.message.includes("Target closed") &&
          !e.message.includes("Protocol error")
        ) {
          console.error("Erreur lors de l'interception de la réponse:", e);
        }
      }
    });

    try {
      // Navigation optimisée
      const navigationTimer = Timer.start("Navigation vers URL Instagram");
      await page.goto(url, {
        waitUntil: "load", // Changé de domcontentloaded à load (plus rapide que networkidle0, mais plus fiable que domcontentloaded)
        timeout: 10000, // Réduit de 15000 à 10000ms
      });

      // Gérer les cookies/popups potentiels qui pourraient bloquer l'accès à la vidéo
      try {
        // Essayer de cliquer sur des boutons de cookies ou popups courants
        await Promise.race([
          page
            .click('button[data-testid="cookie-policy-dialog-accept-button"]')
            .catch(() => {}),
          page
            .click(
              'button[data-testid="cookie-policy-manage-dialog-accept-button"]'
            )
            .catch(() => {}),
          // Timeout court pour ne pas ralentir si aucun popup n'est présent
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch (err) {
        // Ignorer les erreurs liées à la tentative de fermeture des popups
      }

      await page.waitForSelector("video", { timeout: 8000 });
      Timer.end(navigationTimer);

      // Forcer la lecture pour déclencher le chargement
      await page.evaluate(() => {
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.volume = 0; // S'assurer que le son est coupé
          video.playbackRate = 3.0; // Accélérer davantage la lecture (de 2.0 à 3.0)
          video.currentTime = 0; // Commencer depuis le début

          // Créer une fonction qui avance rapidement dans la vidéo
          const seekForward = () => {
            // Si la vidéo a une durée, avancer par blocs de 20% de la durée
            if (
              video.duration &&
              isFinite(video.duration) &&
              video.duration > 0
            ) {
              const jumpSize = video.duration * 0.2; // 20% de la durée
              video.currentTime = Math.min(
                video.currentTime + jumpSize,
                video.duration * 0.9
              );
            } else {
              // Si la durée n'est pas disponible, avancer de 2 secondes
              video.currentTime += 2;
            }
          };

          // Lancer la lecture
          const playPromise = video.play().catch(() => {});

          // Programmer des sauts dans la vidéo toutes les 400ms
          // pour forcer le téléchargement de différentes parties
          const seekInterval = setInterval(() => {
            seekForward();

            // Après 4 sauts (soit ~1.6s), essayer de revenir au début et rejouer
            if (
              video.currentTime > 8 ||
              video.currentTime > video.duration * 0.8
            ) {
              clearInterval(seekInterval);
              video.currentTime = 0;
              video.play().catch(() => {});
            }
          }, 400);

          // Nettoyer l'intervalle après 5 secondes de toute façon
          setTimeout(() => clearInterval(seekInterval), 5000);
        }
      });

      // Créer une promesse qui sera résolue quand les segments seront chargés
      const segmentsTimer = Timer.start("Collecte des segments média");
      const waitForSegments = new Promise((resolve, reject) => {
        // Fonction pour vérifier si on a suffisamment de segments
        const checkSegments = () => {
          const videoSegmentCount = Object.keys(segments.video).length;
          const audioSegmentCount = Object.keys(segments.audio).length;
          const hasEnoughVideo = videoSegmentCount > 0;
          const hasEnoughAudio = audioSegmentCount > 0;
          const timeElapsed = Date.now() - waitStartTime;

          // Vérifier s'il y a eu du progrès depuis la dernière vérification
          const hasNewVideoSegments = videoSegmentCount > lastVideoSegmentCount;
          const hasNewAudioSegments = audioSegmentCount > lastAudioSegmentCount;
          const hasProgress = hasNewVideoSegments || hasNewAudioSegments;

          // Mettre à jour le compteur de temps sans progrès
          if (!hasProgress) {
            noProgressTime += 200; // On ajoute l'intervalle entre les vérifications (200ms)
          } else {
            noProgressTime = 0; // Réinitialiser si on a du progrès
            lastVideoSegmentCount = videoSegmentCount;
            lastAudioSegmentCount = audioSegmentCount;
          }

          // Afficher le statut toutes les secondes (au lieu de 2 secondes)
          if (timeElapsed % 1000 < 100) {
            console.log(
              `Statut du chargement: vidéo=${
                hasEnoughVideo ? "OK" : "En attente"
              } (${videoSegmentCount}), audio=${
                hasEnoughAudio ? "OK" : "En attente"
              } (${audioSegmentCount}), temps écoulé=${Math.round(
                timeElapsed / 1000
              )}s, sans progrès=${Math.round(noProgressTime / 1000)}s`
            );
          }

          // Si on a assez de segments vidéo et audio, on peut continuer
          if (hasEnoughVideo && hasEnoughAudio) {
            // Si on a dépassé le seuil minimum, terminer
            if (
              videoSegmentCount >= earlySegmentsThreshold &&
              audioSegmentCount >= earlySegmentsThreshold
            ) {
              console.log(
                `Segments vidéo et audio suffisants détectés après ${Math.round(
                  timeElapsed / 1000
                )} secondes`
              );
              clearInterval(segmentCheckInterval);
              resolve();
            }
            // Si on a un segment de chaque mais pas assez, continuer un peu plus
            else if (timeElapsed > 3000) {
              console.log(
                `Segments minimaux détectés après ${Math.round(
                  timeElapsed / 1000
                )} secondes, suffisant pour continuer`
              );
              clearInterval(segmentCheckInterval);
              resolve();
            }
          }
          // Si on n'a pas de progrès pendant 3 secondes et qu'on a au moins un segment, terminer
          else if (
            noProgressTime > 3000 &&
            (hasEnoughVideo || hasEnoughAudio)
          ) {
            console.log(
              `Aucun nouveau segment depuis ${Math.round(
                noProgressTime / 1000
              )}s mais nous avons déjà des segments, poursuite du traitement...`
            );
            clearInterval(segmentCheckInterval);
            resolve();
          }
          // Si on a dépassé le temps d'attente maximum, on essaie quand même de continuer
          else if (timeElapsed > maxWaitTime) {
            console.log(
              `Temps maximum dépassé (${
                maxWaitTime / 1000
              }s). Tentative avec les segments disponibles...`
            );
            clearInterval(segmentCheckInterval);
            resolve();
          }
        };

        // Vérifier l'état des segments toutes les 200ms (au lieu de 500ms)
        segmentCheckInterval = setInterval(checkSegments, 200);
      });

      // Attendre que les segments soient chargés
      await waitForSegments;
      Timer.end(segmentsTimer);

      // Le reste du code reste inchangé...
      // Combiner les segments
      const processingTimer = Timer.start("Traitement des segments média");
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
      Timer.end(processingTimer);

      console.log(
        `Taille des buffers: vidéo=${videoBuffer.length} octets, audio=${audioBuffer.length} octets`
      );

      // Fusion directe avec ffmpeg
      if (videoBuffer.length > 0 && audioBuffer.length > 0) {
        console.log("Création des streams à partir des buffers mémoire...");

        // Chemins des fichiers de sortie finaux
        const completeVideoPath = path.join(outputDir, "reel_complete.mp4");
        const audioPath = path.join(outputDir, "reel_audio.mp3"); // MP3 pour l'audio

        // Créer des streams à partir des buffers mémoire
        const videoStream = new Readable();
        videoStream.push(videoBuffer);
        videoStream.push(null);

        const audioStream = new Readable();
        audioStream.push(audioBuffer);
        audioStream.push(null);

        // Exécuter les deux conversions en parallèle
        const ffmpegTimer = Timer.start("Conversion FFmpeg");
        const [audioResult, videoResult] = await Promise.allSettled([
          // Conversion audio MP3 directement avec fluent-ffmpeg
          new Promise((resolve, reject) => {
            ffmpeg(audioStream)
              .inputFormat("mp4")
              .audioCodec("libmp3lame")
              .audioBitrate("192k")
              .on("start", (cmd) => console.log("Commande FFmpeg audio:", cmd))
              .on("error", (err) => {
                console.error("Erreur lors de la conversion audio:", err);
                // Tenter une alternative directement depuis le buffer vidéo si l'audio échoue
                ffmpeg(videoStream)
                  .inputFormat("mp4")
                  .noVideo()
                  .audioCodec("libmp3lame")
                  .audioBitrate("192k")
                  .on("error", (altErr) => {
                    console.error("Erreur alternative audio:", altErr);
                    reject(altErr);
                  })
                  .on("end", () => {
                    console.log("Extraction audio alternative réussie");
                    resolve();
                  })
                  .save(audioPath);
              })
              .on("end", () => {
                console.log("Conversion audio MP3 réussie");
                resolve();
              })
              .save(audioPath);
          }),

          // Fusionner la vidéo et l'audio directement avec fluent-ffmpeg
          new Promise((resolve, reject) => {
            // Définir des options de CPU plus optimisées
            ffmpeg(videoStream)
              .inputFormat("mp4")
              .outputOptions([
                "-c:v copy", // Copier la vidéo sans réencodage
                "-c:a aac", // Encoder l'audio en AAC pour la compatibilité
                "-shortest", // Utiliser le flux le plus court pour la durée
                "-threads 4", // Utiliser plusieurs threads
                "-preset ultrafast", // Utiliser le preset le plus rapide
              ])
              .on("start", (cmd) => console.log("Commande FFmpeg vidéo:", cmd))
              .on("error", (err) => {
                console.error("Erreur lors du traitement vidéo:", err);
                reject(err);
              })
              .on("end", () => {
                console.log("Traitement vidéo réussi");
                resolve();
              })
              .save(completeVideoPath);
          }),
        ]);
        Timer.end(ffmpegTimer);

        if (videoResult.status === "fulfilled") {
          console.log("Fichiers créés avec succès:", {
            video: completeVideoPath,
            audio: audioPath,
          });
        } else {
          console.error(
            "Erreur dans le traitement de la vidéo:",
            videoResult.reason
          );
        }
      } else {
        // Vérifier si les fichiers existent déjà avant de signaler une erreur
        const existingVideoPath = path.join(outputDir, "reel_complete.mp4");
        const existingAudioPath = path.join(outputDir, "reel_audio.mp3");

        const fileExists = (filePath) => {
          try {
            return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
          } catch (e) {
            return false;
          }
        };

        if (fileExists(existingVideoPath) && fileExists(existingAudioPath)) {
          console.log(
            "Aucun segment récupéré, mais fichiers existants trouvés et réutilisés"
          );
          const totalDuration = Timer.end(totalTimer);
          return {
            success: true,
            videoPath: existingVideoPath,
            audioPath: existingAudioPath,
            duration: totalDuration,
            reused: true,
          };
        } else {
          throw new Error("Segments vidéo ou audio manquants");
        }
      }

      const totalDuration = Timer.end(totalTimer);
      return {
        success: true,
        videoPath: completeVideoPath,
        audioPath: audioPath,
        duration: totalDuration,
      };
    } catch (error) {
      console.error("Erreur lors du téléchargement:", error);
      throw error;
    } finally {
      // S'assurer que l'intervalle est arrêté
      if (segmentCheckInterval) {
        clearInterval(segmentCheckInterval);
      }

      // Marquer le navigateur comme fermé avant de le fermer réellement
      browserClosed = true;

      // Fermer le navigateur de manière propre
      try {
        if (browser && browser.isConnected()) {
          // Fermer toutes les pages ouvertes d'abord
          const pages = await browser.pages();
          await Promise.all(pages.map((page) => page.close().catch(() => {})));

          // Puis fermer le navigateur
          await browser.close();
        }
      } catch (closeError) {
        console.log(
          "Erreur lors de la fermeture du navigateur (ignorée):",
          closeError.message
        );
      }
    }
  } catch (error) {
    Timer.end(totalTimer);
    console.error("Erreur dans directDownloadVideo:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Nouvel endpoint pour traiter toutes les actions en une seule requête
app.post("/process-all", async (req, res) => {
  const { url, skipOcr = false } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "URL manquante" });
  }

  console.log("Requête process-all reçue:", { url, skipOcr });
  console.log("Traitement complet pour:", url);

  try {
    // Nettoyer les dossiers frames et ocr
    console.log("Nettoyage des dossiers: frames, ocr...");
    const framesCleaned = await cleanDirectory("frames");
    const ocrCleaned = await cleanDirectory("ocr");
    console.log(
      `Dossier frames nettoyé: ${framesCleaned.deleted} fichiers supprimés, ${framesCleaned.errors} erreurs`
    );
    console.log(
      `Dossier ocr nettoyé: ${ocrCleaned.deleted} fichiers supprimés, ${ocrCleaned.errors} erreurs`
    );

    // Extraire les métadonnées
    console.log("Extraction des métadonnées...");
    const metadata = await scrapeInstagram(url);

    // Si on ne skip pas l'OCR, extraire le texte
    let ocrResults = { text: "", correctedTexts: [] };
    if (!skipOcr) {
      console.log("Extraction des frames et analyse OCR...");
      // Vérifier si la vidéo existe déjà
      const videoPath = path.join("downloads", "reel_complete.mp4");
      if (!fs.existsSync(videoPath)) {
        console.log("Téléchargement de la vidéo pour l'OCR...");
        await directDownloadVideo(url);
      }

      // Extraire les frames
      const frames = await extractFramesFromVideo(videoPath, "frames", 40);

      // Effectuer l'OCR
      if (frames.success) {
        console.log("Analyse OCR du texte dans la vidéo...");
        ocrResults = await processFramesWithEasyOCRService("frames");
      }
    } else {
      console.log("OCR ignoré selon la demande");
    }

    // Envoyer les résultats
    res.json({
      success: true,
      description: metadata.description || "",
      hashtags: metadata.hashtags || [],
      text: ocrResults.text || "",
      correctedTexts: ocrResults.correctedTexts || [],
    });
  } catch (error) {
    console.error("Erreur lors du traitement complet:", error);
    res.status(500).json({ success: false, error: error.message });
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

    // Utiliser la stratégie d'échantillonnage adaptative pour les mèmes
    const extractionTimer = Timer.start("Extraction adaptative des frames");
    const framesResult = await extractFramesFromVideo(videoPath, "frames");
    const extractionDuration = Timer.end(extractionTimer);

    console.log(
      `Extraction terminée en ${extractionDuration.toFixed(2)}s avec ${
        framesResult.totalFrames
      } frames selon stratégie: intervalle=${framesResult.strategy?.interval.toFixed(
        1
      )}s`
    );

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
    await processFramesWithEasyOCRService(framesDir, "fra");
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
  console.log("Requête d'extraction directe des métadonnées reçue:", req.body);
  const { url } = req.body;

  if (!url || !url.includes("instagram.com")) {
    return res.status(400).json({
      success: false,
      error: "URL Instagram valide requise",
    });
  }

  try {
    console.log(
      "Utilisation de la fonction scrapeInstagram pour l'extraction..."
    );

    // Faire plusieurs tentatives pour l'extraction des métadonnées
    let metadataResult = null;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(
        `Tentative d'extraction des métadonnées ${attempts}/${maxAttempts}...`
      );
      metadataResult = await scrapeInstagram(url);

      // Si nous avons au moins des hashtags ou une description valide, c'est un succès
      if (
        metadataResult &&
        ((metadataResult.hashtags && metadataResult.hashtags.length > 0) ||
          (metadataResult.description &&
            metadataResult.description !== "Aucune description disponible"))
      ) {
        console.log(`Extraction réussie à la tentative ${attempts}`);
        break;
      } else if (attempts < maxAttempts) {
        console.log("Données insuffisantes, nouvelle tentative...");
        // Attendre un peu avant de réessayer
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // Assurer que nous avons des valeurs par défaut si l'extraction a échoué
    const description =
      metadataResult?.description || "Aucune description disponible";
    const hashtags = metadataResult?.hashtags || [];

    console.log("Métadonnées extraites avec succès:", {
      description:
        description.substring(0, 100) + (description.length > 100 ? "..." : ""),
      hashtags,
      attempts,
    });

    return res.json({
      success: true,
      description,
      hashtags,
      processing_time: metadataResult?.duration || 0,
    });
  } catch (error) {
    console.error("Erreur lors de l'extraction des métadonnées:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de l'extraction des métadonnées",
      // Renvoyer quand même des valeurs par défaut pour éviter les erreurs côté client
      description: "Aucune description disponible",
      hashtags: [],
    });
  }
});

// Nouvelle route pour télécharger tout (vidéo + audio) en une seule requête
app.post("/download-all", async (req, res) => {
  try {
    console.log("Requête de téléchargement complet reçue:", req.body);
    const { url, preferences } = req.body;

    if (!url || !url.includes("instagram.com")) {
      return res.status(400).json({
        success: false,
        error: "URL Instagram valide requise",
      });
    }

    // Préférences par défaut si non fournies
    const defaultPreferences = {
      video: true,
      audio: true,
      description: true,
      hashtags: true,
      text: true,
    };

    // Fusionner les préférences fournies avec les préférences par défaut
    const finalPreferences = { ...defaultPreferences, ...preferences };

    // Vérifier si les fichiers existent déjà
    const videoPath = path.join(__dirname, "downloads", "reel_complete.mp4");
    const audioPath = path.join(__dirname, "downloads", "reel_audio.mp3");

    // Fonction pour vérifier si un fichier existe et n'est pas vide
    const fileExists = (filePath) => {
      try {
        return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
      } catch (e) {
        return false;
      }
    };

    // Si les fichiers existent déjà et que les préférences correspondent, on peut les réutiliser
    const videoExists = fileExists(videoPath);
    const audioExists = fileExists(audioPath);

    // Si les fichiers existent déjà et que les préférences correspondent, on peut les réutiliser
    if (
      (!finalPreferences.video || videoExists) &&
      (!finalPreferences.audio || audioExists)
    ) {
      console.log("Fichiers déjà disponibles, réutilisation...");

      return res.json({
        success: true,
        videoUrl: finalPreferences.video
          ? `/download/video/reel_complete.mp4`
          : null,
        audioUrl: finalPreferences.audio
          ? `/download/audio/reel_audio.mp3`
          : null,
        reused: true,
      });
    }

    // Télécharger la vidéo et l'audio si nécessaire
    if (finalPreferences.video || finalPreferences.audio) {
      console.log("Démarrage du téléchargement pour:", url);
      const result = await directDownloadVideo(url);

      if (!result.success) {
        throw new Error(result.error || "Échec du téléchargement");
      }
    }

    // Vérifier que les fichiers existent bien selon les préférences
    if (finalPreferences.video && !fs.existsSync(videoPath)) {
      throw new Error("Le fichier vidéo n'a pas été créé");
    }

    if (finalPreferences.audio) {
      const audioExists = fs.existsSync(audioPath);
      if (!audioExists) {
        console.warn("Le fichier audio MP3 n'existe pas, tentative avec MP4");
        const audioPathMP4 = path.join(
          __dirname,
          "downloads",
          "reel_audio.mp4"
        );
        if (!fs.existsSync(audioPathMP4)) {
          console.error("Aucun fichier audio trouvé (ni MP3 ni MP4)");
        }
      }
    }

    // Renvoyer les URLs pour les fichiers selon les préférences
    res.json({
      success: true,
      videoUrl: finalPreferences.video
        ? `/download/video/reel_complete.mp4`
        : null,
      audioUrl: finalPreferences.audio
        ? `/download/audio/reel_audio.mp3`
        : null,
    });
  } catch (error) {
    console.error("Erreur lors du téléchargement complet:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Extraction des frames à partir d'une vidéo
app.post("/api/extract-frames", upload.single("video"), async (req, res) => {
  try {
    console.log("Requête d'extraction de frames reçue");
    // Vérifier si un fichier a été téléchargé
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Aucun fichier vidéo n'a été téléchargé",
      });
    }

    const videoPath = req.file.path;
    console.log("Vidéo reçue:", videoPath);

    // Nettoyer les dossiers de travail avant extraction
    cleanDirectories(["frames"]);

    console.log("Extraction des frames en parallèle...");
    const extractStartTime = Date.now();
    const framesCount = await extractFramesFromVideo(videoPath, "frames");
    const extractTime = ((Date.now() - extractStartTime) / 1000).toFixed(2);
    console.log(`Extraction des frames terminée en ${extractTime}s`);

    // Analyse des frames avec EasyOCR
    console.log("Début de l'analyse OCR des frames...");
    const ocrStartTime = Date.now();

    try {
      await processFramesWithEasyOCRService(
        path.dirname(videoPath),
        req.body.lang || "fra"
      );
      const ocrTime = ((Date.now() - ocrStartTime) / 1000).toFixed(2);
      console.log(`Analyse OCR terminée en ${ocrTime}s`);

      // Envoyer les résultats OCR au client
      const ocrResultsPath = path.join(
        path.dirname(videoPath),
        "ocr",
        "easyocr_results.json"
      );

      if (fs.existsSync(ocrResultsPath)) {
        // Lire les résultats
        const ocrResults = JSON.parse(fs.readFileSync(ocrResultsPath, "utf8"));

        // Ajouter les métriques de performance
        const totalTime = (Date.now() - extractStartTime) / 1000;
        const metrics = {
          extract_time: parseFloat(extractTime),
          ocr_time: parseFloat(ocrTime),
          total_time: totalTime.toFixed(2),
          frames_count: framesCount,
          significant_texts: ocrResults.filter((r) => r.is_significant).length,
        };

        return res.status(200).json({
          success: true,
          message: `${framesCount} frames extraites et analysées en ${totalTime.toFixed(
            2
          )}s`,
          results: ocrResults,
          metrics,
        });
      } else {
        return res.status(404).json({
          success: false,
          error: "Résultats OCR non trouvés",
        });
      }
    } catch (ocrError) {
      console.error("Erreur lors de l'analyse OCR:", ocrError);
      return res.status(500).json({
        success: false,
        error: `Erreur lors de l'analyse OCR: ${ocrError.message}`,
      });
    }
  } catch (error) {
    console.error("Erreur lors de l'extraction des frames:", error);
    return res.status(500).json({
      success: false,
      error: `Erreur lors de l'extraction des frames: ${error.message}`,
    });
  }
});
