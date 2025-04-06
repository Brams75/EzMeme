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
  if (!ocrServiceStarted) {
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
      throw new Error(
        `Erreur du service OCR: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Erreur lors de l'appel au service OCR: ${error.message}`);
    throw error;
  }
}

// Fonction pour traiter plusieurs images avec le service EasyOCR
async function processFramesWithEasyOCRService(framesDir, language = "fra") {
  console.log(
    `Traitement OCR des frames dans ${framesDir} avec le service EasyOCR...`
  );
  const startTime = Date.now();

  // Vérifier que le dossier frames existe et contient des images
  if (!fs.existsSync(framesDir)) {
    console.error(`Dossier frames non trouvé: ${framesDir}`);
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

  for (let i = 0; i < framePaths.length; i++) {
    try {
      console.log(
        `Traitement de l'image ${i + 1}/${framePaths.length}: ${framePaths[i]}`
      );
      const result = await processImageWithEasyOCRService(
        framePaths[i],
        options
      );

      if (result.text && result.text.trim()) {
        texts.push(result.text);
        results.push({
          text: result.text,
          text_type: "raw",
          image: path.basename(framePaths[i]),
          confidence: 0.7,
          is_significant: result.text.trim().length > 3,
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

  // Créer le dossier ocr s'il n'existe pas
  const ocrDir = path.join(path.dirname(framesDir), "ocr");
  fs.mkdirSync(ocrDir, { recursive: true });

  // Si nous avons des textes, les corriger avec l'API ChatGPT via le service EasyOCR
  if (texts.length > 0) {
    try {
      console.log(
        `Regroupement et correction des ${texts.length} textes détectés...`
      );
      const correctionStart = Date.now();

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
        const correctionTime = ((Date.now() - correctionStart) / 1000).toFixed(
          2
        );

        console.log(`Correction des textes terminée en ${correctionTime}s`);

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
      }
    } catch (error) {
      console.error(
        `Erreur lors de l'appel au service de correction: ${error.message}`
      );
      // Continuer sans correction
    }
  }

  // Écrire les résultats
  const outputFile = path.join(ocrDir, "easyocr_results.json");
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), "utf8");

  const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `Traitement OCR terminé en ${processingTime}s, ${results.length} textes extraits`
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

// Fonction pour nettoyer les dossiers spécifiques
function cleanDirectories(dirsToClean = ["frames", "ocr"]) {
  console.log(`Nettoyage des dossiers: ${dirsToClean.join(", ")}...`);
  dirsToClean.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Dossier ${dir} créé`);
      return;
    }

    try {
      const files = fs.readdirSync(dir);
      let successCount = 0;
      let errorCount = 0;

      for (const file of files) {
        const filePath = path.join(dir, file);

        // Fonction pour tenter la suppression avec retry
        const attemptDelete = (retryCount = 0, maxRetries = 3) => {
          try {
            if (fs.existsSync(filePath)) {
              const fileStats = fs.statSync(filePath);

              // Vérifier si c'est un dossier
              if (fileStats.isDirectory()) {
                // Supprimer récursivement si c'est un dossier
                fs.rmdirSync(filePath, { recursive: true, force: true });
              } else {
                // Supprimer si c'est un fichier
                fs.unlinkSync(filePath);
              }

              successCount++;
            }
          } catch (e) {
            // Si l'erreur indique que le fichier est utilisé par un autre processus
            if (
              e.code === "EBUSY" ||
              e.code === "EPERM" ||
              e.code === "EACCES"
            ) {
              if (retryCount < maxRetries) {
                // Attendre un peu et réessayer
                console.warn(
                  `Fichier ${file} occupé, nouvelle tentative ${
                    retryCount + 1
                  }/${maxRetries}`
                );
                setTimeout(
                  () => attemptDelete(retryCount + 1, maxRetries),
                  500
                );
                return;
              }
            }

            console.warn(
              `Échec final de suppression du fichier ${file} dans ${dir}: ${e.message}`
            );
            errorCount++;
          }
        };

        // Démarrer la première tentative
        attemptDelete();
      }

      console.log(
        `Dossier ${dir} nettoyé: ${successCount} fichiers supprimés, ${errorCount} erreurs`
      );
    } catch (e) {
      console.error(`Erreur lors du nettoyage du dossier ${dir}: ${e.message}`);
    }
  });
}

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

// Ajouter une fonction pour optimiser l'extraction de frames avec ffmpeg
async function extractFramesFromVideo(videoPath, outputFolder, maxFrames = 40) {
  return new Promise((resolve, reject) => {
    console.log(`Extraction des frames de la vidéo ${videoPath}...`);
    const startTime = Date.now();

    // Vérifier que la vidéo existe
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`La vidéo ${videoPath} n'existe pas`));
    }

    // S'assurer que le dossier de sortie existe
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    } else {
      // Nettoyer le dossier de sortie
      fs.readdirSync(outputFolder).forEach((file) => {
        if (file.endsWith(".png")) {
          fs.unlinkSync(path.join(outputFolder, file));
        }
      });
    }

    // Obtenir la durée de la vidéo
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error("Erreur lors de l'analyse de la vidéo:", err);
        return reject(err);
      }

      const duration = metadata.format.duration || 0;
      console.log(`Durée de la vidéo: ${duration} secondes`);

      // Calculer l'intervalle entre les frames
      const interval = Math.max(1, Math.floor(duration / maxFrames));
      console.log(`Intervalle d'extraction: ${interval} secondes`);

      // Utiliser -hwaccel auto pour activer l'accélération matérielle si disponible
      ffmpeg(videoPath)
        .inputOptions([
          "-hwaccel",
          "auto", // Utiliser l'accélération matérielle si disponible
        ])
        .outputOptions([
          "-vf",
          `fps=1/${interval}`, // Extraire une frame toutes les 'interval' secondes
          "-q:v",
          "2", // Qualité des images (2 = haute qualité, 31 = basse qualité)
          "-preset",
          "ultrafast", // Le preset le plus rapide
        ])
        .output(path.join(outputFolder, "frame-%03d.png"))
        .on("start", (commandLine) => {
          console.log("Commande ffmpeg:", commandLine);
        })
        .on("progress", (progress) => {
          console.log(`Progression ffmpeg: ${JSON.stringify(progress)}`);
        })
        .on("end", () => {
          const endTime = Date.now();
          const elapsedTime = (endTime - startTime) / 1000;
          console.log(
            `Extraction des frames terminée en ${elapsedTime.toFixed(
              2
            )} secondes`
          );

          // Compter les frames extraites
          const framesCount = fs
            .readdirSync(outputFolder)
            .filter((file) => file.endsWith(".png")).length;
          console.log(`${framesCount} frames extraites`);

          resolve(framesCount);
        })
        .on("error", (err) => {
          console.error("Erreur lors de l'extraction des frames:", err);
          reject(err);
        })
        .run();
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

    // Variables pour suivre l'état du chargement
    let hasVideoSegments = false;
    let hasAudioSegments = false;
    let segmentCheckInterval = null;
    let maxWaitTime = 30000; // Temps d'attente maximum (30 secondes)
    let waitStartTime = Date.now();

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
            hasAudioSegments = true;
          } else if (url.includes("t2/f2/m86") || buffer.length > 100000) {
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

      // Créer une promesse qui sera résolue quand les segments seront chargés
      const waitForSegments = new Promise((resolve, reject) => {
        // Fonction pour vérifier si on a suffisamment de segments
        const checkSegments = () => {
          const hasEnoughVideo = Object.keys(segments.video).length > 0;
          const hasEnoughAudio = Object.keys(segments.audio).length > 0;
          const timeElapsed = Date.now() - waitStartTime;

          // Afficher le statut toutes les 2 secondes
          if (timeElapsed % 2000 < 100) {
            console.log(
              `Statut du chargement: vidéo=${
                hasEnoughVideo ? "OK" : "En attente"
              }, audio=${
                hasEnoughAudio ? "OK" : "En attente"
              }, temps écoulé=${Math.round(timeElapsed / 1000)}s`
            );
          }

          // Si on a assez de segments vidéo et audio, on peut continuer
          if (hasEnoughVideo && hasEnoughAudio) {
            console.log(
              `Segments vidéo et audio chargés après ${Math.round(
                timeElapsed / 1000
              )} secondes`
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

        // Vérifier l'état des segments toutes les 500ms
        segmentCheckInterval = setInterval(checkSegments, 500);
      });

      // Attendre que les segments soient chargés
      await waitForSegments;

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

        // Conversion audio MP3 directement avec fluent-ffmpeg
        await new Promise((resolve, reject) => {
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
        });

        // Fusionner la vidéo et l'audio directement avec fluent-ffmpeg
        await new Promise((resolve, reject) => {
          ffmpeg(videoStream)
            .inputFormat("mp4")
            .input(audioPath) // Ajouter l'audio déjà converti
            .outputOptions([
              "-c:v copy", // Copier la vidéo sans réencodage
              "-c:a aac", // Encoder l'audio en AAC pour la compatibilité
              "-shortest", // Utiliser le flux le plus court pour la durée
            ])
            .on("start", (cmd) => console.log("Commande FFmpeg fusion:", cmd))
            .on("error", (err) => {
              console.error("Erreur lors de la fusion:", err);
              reject(err);
            })
            .on("end", () => {
              console.log("Fusion vidéo/audio réussie");
              resolve();
            })
            .save(completeVideoPath);
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
      // S'assurer que l'intervalle est arrêté
      if (segmentCheckInterval) {
        clearInterval(segmentCheckInterval);
      }
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

    const startTotalTime = Date.now();
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
      // Étape 1: Démarrer les téléchargements des médias en premier (prioritaire)
      console.log("1. Téléchargement et préparation des médias...");
      const videoPath = path.join("downloads", "reel_complete.mp4");
      const audioPath = path.join("downloads", "reel_audio.mp3");
      let mediasExist = false;

      // Lancer un tableau de promesses pour exécuter certaines tâches en parallèle
      const promises = [];

      // Promesse 1: Téléchargement de la vidéo (prioritaire) et préparation des frames
      const downloadAndPreparePromise = (async () => {
        // Vérifier si les fichiers existent déjà
        if (fs.existsSync(videoPath) && fs.existsSync(audioPath)) {
          console.log("Vidéo et audio déjà disponibles, réutilisation...");
          mediasExist = true;
        } else {
          console.log("Téléchargement de la vidéo et de l'audio...");
          const downloadStartTime = Date.now();
          const videoResult = await directDownloadVideo(url);
          const downloadTime = (
            (Date.now() - downloadStartTime) /
            1000
          ).toFixed(2);
          console.log(`Téléchargement terminé en ${downloadTime}s`);

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

        // Démarrer l'extraction des frames immédiatement après le téléchargement
        // pour accélérer le processus global
        console.log("Extraction des frames en parallèle...");
        const extractStartTime = Date.now();
        await extractFramesFromVideo(videoPath, "frames");
        const extractTime = ((Date.now() - extractStartTime) / 1000).toFixed(2);
        console.log(`Extraction des frames terminée en ${extractTime}s`);
      })();

      // Ajouter la promesse de téléchargement au tableau
      promises.push(downloadAndPreparePromise);

      // Promesse 2: Extraction des métadonnées (peut se faire en parallèle)
      const metadataPromise = (async () => {
        console.log("Extraction des métadonnées en parallèle...");
        const metadataStartTime = Date.now();
        try {
          const metadataResult = await scrapeInstagram(url);
          const metadataTime = (
            (Date.now() - metadataStartTime) /
            1000
          ).toFixed(2);
          console.log(`Métadonnées extraites en ${metadataTime}s`);

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
        } catch (error) {
          console.error("Erreur lors de l'extraction des métadonnées:", error);
          // On ne lance pas d'erreur ici pour ne pas interrompre le processus principal
        }
      })();

      // Ajouter la promesse d'extraction des métadonnées au tableau
      promises.push(metadataPromise);

      // Attendre que le téléchargement, l'extraction des frames et des métadonnées soient terminés
      await Promise.all(promises);

      // Vérifier que les frames ont été extraites
      const framesDir = "./frames";
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }

      const frames = fs
        .readdirSync(framesDir)
        .filter(
          (file) =>
            file.toLowerCase().endsWith(".png") ||
            file.toLowerCase().endsWith(".jpg")
        );

      console.log(`${frames.length} frames extraites pour l'OCR`);

      if (frames.length > 0) {
        // Étape 3: Traitement OCR des frames
        console.log("3. Analyse OCR du texte dans la vidéo...");
        const ocrStartTime = Date.now();
        await processFramesWithEasyOCRService(framesDir, "fra");
        const ocrTime = ((Date.now() - ocrStartTime) / 1000).toFixed(2);
        console.log(`Traitement OCR terminé en ${ocrTime}s`);

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

      // Calculer le temps total de traitement
      const totalProcessingTime = (
        (Date.now() - startTotalTime) /
        1000
      ).toFixed(2);

      // Renvoyer tous les résultats collectés
      console.log(
        `Traitement complet terminé en ${totalProcessingTime}s, envoi des résultats...`
      );
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

    await extractFramesFromVideo(videoPath, "frames");

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

    // Renvoyer les URLs pour les fichiers individuels
    res.json({
      success: true,
      videoUrl: `/download/video/reel_complete.mp4`,
      audioUrl: `/download/audio/reel_audio.mp3`,
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
