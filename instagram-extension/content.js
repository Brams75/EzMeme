console.log("Content script chargé");

// Variable pour suivre si le bouton a déjà été créé
let downloadButtonCreated = false;
let downloadMenu = null;
let dragStartX = 0,
  dragStartY = 0;

// Fonction pour envoyer un message au background script avec meilleure gestion des erreurs
function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    try {
      // Vérifier si le runtime est disponible
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error("Chrome runtime non disponible"));
        return;
      }

      // Ajouter un timeout pour éviter les attentes infinies
      const timeout = setTimeout(() => {
        reject(
          new Error("Timeout de la communication avec le background script")
        );
      }, 30000); // 30 secondes de timeout

      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          // Gérer spécifiquement l'erreur "Receiving end does not exist"
          if (
            chrome.runtime.lastError.message.includes(
              "Receiving end does not exist"
            )
          ) {
            console.warn(
              "Background script non disponible, tentative de reconnexion..."
            );
            // Attendre un peu et réessayer
            setTimeout(() => {
              sendMessageToBackground(message).then(resolve).catch(reject);
            }, 1000);
            return;
          }
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Fonction pour extraire des données de base à partir de la page
function extractBasicPageData() {
  return {
    url: window.location.href,
  };
}

// Fonction pour générer une clé unique pour le cache
function generateCacheKey(url, type) {
  return `instagram_${type}_${url}`;
}

// Fonction pour sauvegarder dans le cache
function saveToCache(key, data) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        data: data,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    console.error("Erreur lors de la sauvegarde dans le cache:", error);
  }
}

// Fonction pour récupérer depuis le cache
function getFromCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    // Vérifier si le cache n'est pas trop vieux (5 minutes)
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (error) {
    console.error("Erreur lors de la récupération du cache:", error);
    return null;
  }
}

// Fonction pour nettoyer le cache
function clearCache() {
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("instagram_")) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error("Erreur lors du nettoyage du cache:", error);
  }
}

// Fonction pour créer un bouton flottant plus petit
function createDownloadButton() {
  if (downloadButtonCreated) return;

  // Ajouter les styles CSS pour le bouton et le menu
  const styleElement = document.createElement("style");
  styleElement.textContent = `
    :root {
      --primary-color: #2563eb;
      --primary-hover: #1d4ed8;
      --success-color: #22c55e;
      --error-color: #ef4444;
      --text-primary: #1f2937;
      --text-secondary: #4b5563;
      --bg-primary: #ffffff;
      --bg-secondary: #f3f4f6;
      --border-color: #e5e7eb;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
    }

    .instagram-downloader-button {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 48px;
      height: 48px;
      background-color: var(--primary-color);
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 999999;
      box-shadow: var(--shadow-lg);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .instagram-downloader-button:hover {
      transform: scale(1.1);
      background-color: var(--primary-hover);
      box-shadow: var(--shadow-lg), 0 0 0 4px rgba(37, 99, 235, 0.1);
    }
    
    .instagram-downloader-button svg {
      width: 24px;
      height: 24px;
    }
    
    .instagram-downloader-menu {
      position: fixed;
      right: 20px;
      bottom: 80px;
      width: 320px;
      background-color: var(--bg-primary);
      border-radius: 12px;
      box-shadow: var(--shadow-lg);
      z-index: 9999;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid var(--border-color);
    }
    
    .menu-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background-color: var(--primary-color);
      color: white;
    }
    
    .menu-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.025em;
    }
    
    .toggle-button {
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .toggle-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }
    
    .menu-content {
      padding: 16px;
    }
    
    .download-options, .extract-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    
    .download-all-container {
      margin-bottom: 12px;
    }
    
    .download-all-button {
      width: 100%;
      background-color: var(--primary-color) !important;
      color: white !important;
      font-weight: 500;
    }
    
    .download-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 14px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: var(--shadow-sm);
    }
    
    .download-button:hover {
      background-color: var(--bg-secondary);
      border-color: var(--primary-color);
      color: var(--primary-color);
      transform: translateY(-1px);
    }
    
    .download-button:active {
      transform: translateY(0);
    }
    
    .download-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .status-container {
      margin-top: 12px;
      padding: 12px;
      background-color: var(--bg-secondary);
      border-radius: 8px;
    }
    
    .status-message {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-align: center;
      font-weight: 500;
    }
    
    .progress-bar {
      width: 100%;
      height: 4px;
      background-color: var(--border-color);
      border-radius: 2px;
      overflow: hidden;
    }
    
    .progress-fill {
      height: 100%;
      width: 0;
      background-color: var(--primary-color);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .instagram-downloader-menu .loading {
      animation: spin 1s linear infinite;
    }

    .modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    }

    .modal-content {
      background-color: var(--bg-primary);
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: var(--shadow-lg);
    }

    .modal-header {
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 0 8px;
      line-height: 1;
    }

    .modal-body {
      padding: 16px;
    }

    .modal-section {
      background-color: var(--bg-secondary);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
    }

    .modal-section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }

    .modal-section-content {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .modal-section-content:empty::before {
      content: "Aucun contenu disponible";
      color: var(--text-secondary);
      font-style: italic;
    }

    .hashtags-section .modal-section-content {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .hashtag {
      background-color: rgba(37, 99, 235, 0.1);
      color: var(--primary-color);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 500;
    }

    body.modal-open {
      overflow: hidden;
    }
  `;
  document.head.appendChild(styleElement);

  // Créer un bouton flottant plus petit
  const button = document.createElement("div");
  button.className = "instagram-downloader-button";
  button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  button.title = "Ouvrir EzMeme";
  document.body.appendChild(button);

  // Créer le menu flottant
  downloadMenu = document.createElement("div");
  downloadMenu.className = "instagram-downloader-menu";
  downloadMenu.style.display = "none"; // Caché par défaut

  // En-tête avec bouton toggle (pas de croix)
  downloadMenu.innerHTML = `
    <div class="menu-header">
      <h3 style="color: white;">EzMeme Downloader</h3>
      <div class="toggle-button" title="Cacher le menu">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
      </div>
    </div>
    <div class="menu-content">
      <div class="download-all-container">
        <button class="download-button download-all-button">
          Tout Télécharger
        </button>
      </div>
      <div class="download-options">
        <button class="download-button video-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
          Télécharger Vidéo
        </button>
        <button class="download-button audio-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          Télécharger Audio
        </button>
      </div>
      <div class="extract-options">
        <button class="download-button metadata-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>
          Extraire Description et Hashtags
        </button>
        <button class="download-button ocr-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          Détecter le Texte
        </button>
      </div>
      <div class="status-container">
        <div class="status-message">Prêt</div>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(downloadMenu);

  // Gérer l'ouverture/fermeture du menu avec le bouton
  button.addEventListener("click", () => {
    downloadMenu.style.display =
      downloadMenu.style.display === "none" ? "block" : "none";
  });

  // Gérer le toggle du menu
  const toggleButton = downloadMenu.querySelector(".toggle-button");
  toggleButton.addEventListener("click", () => {
    downloadMenu.style.display = "none";
  });

  // Ajouter la possibilité de glisser le menu
  makeElementDraggable(
    downloadMenu,
    downloadMenu.querySelector(".menu-header")
  );

  // Gérer les clics sur les boutons
  setupDownloadButtons();

  downloadButtonCreated = true;
}

// Fonction pour rendre un élément déplaçable par un handle spécifique
function makeElementDraggable(element, handle) {
  handle.addEventListener("mousedown", startDragging);

  function startDragging(e) {
    e.preventDefault();

    // Position initiale du clic
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    // Position initiale de l'élément
    const elementRect = element.getBoundingClientRect();
    const elementStartX = elementRect.left;
    const elementStartY = elementRect.top;

    // Ajouter les écouteurs pour le déplacement et la fin du drag
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDragging);

    function onDrag(e) {
      // Calculer le décalage par rapport à la position initiale
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;

      // Calculer la nouvelle position
      const newX = elementStartX + deltaX;
      const newY = elementStartY + deltaY;

      // Appliquer la nouvelle position
      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
    }

    function stopDragging() {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDragging);
    }
  }
}

// Fonction pour obtenir l'ID de l'onglet actuel
async function getCurrentTabId() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TAB_ID" }, (response) => {
      if (response && response.tabId) {
        resolve(response.tabId);
      } else {
        resolve(null);
      }
    });
  });
}

// Fonction pour afficher un état de chargement sur un bouton
function setButtonLoading(button, isLoading) {
  const textElement = button.querySelector(".button-text");
  const spinnerElement = button.querySelector(".loading-spinner");

  if (isLoading) {
    textElement.classList.add("hidden");
    spinnerElement.classList.remove("hidden");
    button.disabled = true;
  } else {
    textElement.classList.remove("hidden");
    spinnerElement.classList.add("hidden");
    button.disabled = false;
  }
}

// Fonction pour afficher un état de succès sur un bouton
function setButtonSuccess(button) {
  setButtonLoading(button, false);
  button.classList.add("success");
  button.disabled = true;
}

// Fonction pour afficher un état d'erreur sur un bouton
function setButtonError(button) {
  setButtonLoading(button, false);
  button.classList.add("error");
  button.disabled = true;
}

// Fonction pour réinitialiser un bouton
function resetButton(button) {
  setButtonLoading(button, false);
  button.classList.remove("success", "error");
  button.disabled = false;
}

// Écouter les messages du background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message reçu dans content.js:", message);

  switch (message.type) {
    case "DOWNLOAD_STATUS":
    case "METADATA_STATUS":
    case "OCR_STATUS":
      // Mettre à jour le statut dans l'interface utilisateur si le menu existe
      if (downloadMenu) {
        const statusMessage = downloadMenu.querySelector(".status-message");
        const progressFill = downloadMenu.querySelector(".progress-fill");

        if (statusMessage && progressFill) {
          updateStatus(message.status, message.progress || 0);
        }
      }
      break;

    case "DOWNLOAD_ALL_STATUS":
      // Mettre à jour le statut dans l'interface utilisateur pour le téléchargement complet
      if (downloadMenu) {
        const statusMessage = downloadMenu.querySelector(".status-message");
        const progressFill = downloadMenu.querySelector(".progress-fill");
        const downloadAllButton = downloadMenu.querySelector(
          ".download-all-button"
        );

        if (statusMessage && progressFill) {
          // Mettre à jour le message et la barre de progression
          updateStatus(message.status, message.progress || 0);

          // Ajuster la couleur en fonction du progrès
          if (message.error) {
            progressFill.style.backgroundColor = "#fc3d39"; // Rouge pour les erreurs

            // Réinitialiser le bouton en cas d'erreur
            if (downloadAllButton) {
              setButtonError(downloadAllButton);
              setTimeout(() => resetButton(downloadAllButton), 3000);
            }
          } else if (message.complete) {
            progressFill.style.backgroundColor = "#4bb543"; // Vert pour succès

            // Indiquer le succès sur le bouton
            if (downloadAllButton) {
              setButtonSuccess(downloadAllButton);
              setTimeout(() => resetButton(downloadAllButton), 3000);
            }
          }
        }
      }
      break;

    case "CREATE_DOWNLOAD_MENU":
      createDownloadButton();
      break;

    default:
      console.log("Type de message non géré:", message.type);
  }

  return true;
});

// Créer le menu lors du chargement initial
if (window.location.href.match(/instagram\.com\/(p|reel|tv)\/[^\/]+/)) {
  // Créer le bouton immédiatement
  createDownloadButton();

  // Observer les changements d'URL pour Instagram (SPA)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log("URL changée:", lastUrl);

      // Réinitialiser le bouton si l'URL change
      downloadButtonCreated = false;
      if (downloadMenu) {
        downloadMenu.remove();
        downloadMenu = null;
      }

      // Vérifier si nous sommes sur une page de post Instagram
      if (lastUrl.match(/instagram\.com\/(p|reel|tv)\/[^\/]+/)) {
        createDownloadButton();
      }
    }
  });

  urlObserver.observe(document, { subtree: true, childList: true });
}

// Fonction pour configurer les gestionnaires d'événements sur les boutons
function setupDownloadButtons() {
  const videoButton = downloadMenu.querySelector(".video-button");
  const audioButton = downloadMenu.querySelector(".audio-button");
  const metadataButton = downloadMenu.querySelector(".metadata-button");
  const ocrButton = downloadMenu.querySelector(".ocr-button");
  const downloadAllButton = downloadMenu.querySelector(".download-all-button");
  const statusMessage = downloadMenu.querySelector(".status-message");
  const progressFill = downloadMenu.querySelector(".progress-fill");

  // Mise à jour de la barre de statut
  function updateStatus(message, progress) {
    // Utiliser requestAnimationFrame pour s'assurer que les mises à jour d'interface sont priorisées
    requestAnimationFrame(() => {
      statusMessage.textContent = message;

      // Transition fluide pour la barre de progression
      progressFill.style.transition = "width 0.3s ease-in-out";
      progressFill.style.width = `${progress}%`;

      // Couleur basée sur le statut
      if (progress === 0) {
        progressFill.style.backgroundColor = "#fc3d39"; // Rouge pour erreur
      } else if (progress === 100) {
        progressFill.style.backgroundColor = "#4bb543"; // Vert pour succès
      } else {
        progressFill.style.backgroundColor = "#0095f6"; // Bleu pour en cours
      }

      // Forcer un reflow pour s'assurer que les changements sont appliqués
      progressFill.offsetHeight;
    });
  }

  // Désactiver tous les boutons pendant une opération
  function disableButtons(disable = true) {
    const buttons = downloadMenu.querySelectorAll(".download-button");
    buttons.forEach((button) => {
      button.disabled = disable;
      if (disable) {
        button.style.opacity = "0.6";
        button.style.cursor = "not-allowed";
      } else {
        button.style.opacity = "1";
        button.style.cursor = "pointer";
      }
    });
  }

  // Fonction utilitaire pour télécharger un fichier sans ouvrir un nouvel onglet
  function downloadFileWithoutNewTab(url, filename) {
    console.log(`Téléchargement de fichier: ${filename} depuis ${url}`);

    // On utilise une promesse pour pouvoir ajouter des délais entre les téléchargements
    return new Promise((resolve, reject) => {
      // Solution 1: Utiliser l'API Fetch puis créer un objet URL
      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          console.log(`Blob récupéré pour ${filename}:`, blob);

          // Créer un objet URL à partir du blob
          const blobUrl = URL.createObjectURL(blob);

          // Créer un élément a pour télécharger
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);

          // Déclencher le téléchargement
          console.log(`Déclenchement du téléchargement pour ${filename}`);
          a.click();

          // Nettoyer
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            console.log(`Nettoyage effectué pour ${filename}`);
            resolve(); // Résoudre la promesse une fois le téléchargement terminé
          }, 1000);
        })
        .catch((error) => {
          console.error(`Erreur lors du téléchargement de ${filename}:`, error);

          // Solution de secours: redirection directe
          try {
            console.log(`Tentative avec redirection directe pour ${filename}`);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", filename);
            link.setAttribute("target", "_blank");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            resolve(); // Résoudre quand même pour continuer
          } catch (fallbackError) {
            console.error("Erreur avec la méthode de secours:", fallbackError);
            reject(error);
          }
        });
    });
  }

  // Télécharger la vidéo
  videoButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/3 : Préparation de votre vidéo...", 10);

    try {
      // Petite pause pour permettre à l'UI de se mettre à jour
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log("Envoi de la requête de téléchargement vidéo au serveur...");

      updateStatus("Étape 2/3 : Récupération de la vidéo...", 30);

      // Simuler des progrès pendant le téléchargement
      const progressInterval = setInterval(() => {
        const currentWidth = parseInt(progressFill.style.width);
        if (currentWidth < 65) {
          updateStatus(
            "Étape 2/3 : Récupération de la vidéo...",
            currentWidth + 1
          );
        }
      }, 200);

      const response = await fetch(
        "http://localhost:3000/direct-download-video",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: window.location.href }),
        }
      );

      clearInterval(progressInterval);

      if (!response.ok) {
        throw new Error("Erreur lors du téléchargement de la vidéo");
      }

      updateStatus("Étape 3/3 : Enregistrement de la vidéo...", 70);

      const data = await response.json();
      console.log("Réponse du serveur pour la vidéo:", data);

      if (data && data.success) {
        updateStatus("Préparation du téléchargement...", 85);

        // Télécharger le fichier sans ouvrir un nouvel onglet
        await downloadFileWithoutNewTab(
          `http://localhost:3000${data.videoUrl}`,
          "video.mp4"
        );
        updateStatus("Vidéo enregistrée sur votre appareil!", 100);
      } else {
        updateStatus(
          "Impossible de récupérer la vidéo. Vérifiez que le post Instagram est public.",
          0
        );
      }
    } catch (error) {
      console.error("Erreur:", error);
      updateStatus(
        "Impossible de récupérer la vidéo. Vérifiez que le post Instagram est public.",
        0
      );
    } finally {
      setTimeout(() => {
        disableButtons(false);
      }, 3000);
    }
  });

  // Télécharger l'audio
  audioButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/3 : Préparation de l'audio...", 10);

    try {
      // Petite pause pour permettre à l'UI de se mettre à jour
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log("Envoi de la requête de téléchargement audio au serveur...");

      updateStatus("Étape 2/3 : Extraction du son de la vidéo...", 30);

      // Simuler des progrès pendant le téléchargement
      const progressInterval = setInterval(() => {
        const currentWidth = parseInt(progressFill.style.width);
        if (currentWidth < 65) {
          updateStatus(
            "Étape 2/3 : Extraction du son de la vidéo...",
            currentWidth + 1
          );
        }
      }, 200);

      const response = await fetch(
        "http://localhost:3000/direct-download-audio",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: window.location.href }),
        }
      );

      clearInterval(progressInterval);

      if (!response.ok) {
        throw new Error("Erreur lors du téléchargement de l'audio");
      }

      updateStatus("Étape 3/3 : Enregistrement du son...", 70);

      const data = await response.json();
      console.log("Réponse du serveur pour l'audio:", data);

      if (data && data.success) {
        updateStatus("Préparation du téléchargement...", 85);

        // Déterminer l'extension de fichier en fonction de l'URL
        const fileExtension = data.audioUrl.toLowerCase().endsWith(".mp3")
          ? "mp3"
          : "mp4";
        console.log(`Extension de fichier audio détectée: ${fileExtension}`);

        // Télécharger le fichier sans ouvrir un nouvel onglet
        await downloadFileWithoutNewTab(
          `http://localhost:3000${data.audioUrl}`,
          `audio.${fileExtension}`
        );
        updateStatus("Son enregistré sur votre appareil!", 100);
      } else {
        updateStatus(
          "Impossible de récupérer le son. Vérifiez que le post Instagram est public.",
          0
        );
      }
    } catch (error) {
      console.error("Erreur:", error);
      updateStatus(
        "Impossible de récupérer le son. Vérifiez que le post Instagram est public.",
        0
      );
    } finally {
      setTimeout(() => {
        disableButtons(false);
      }, 3000);
    }
  });

  // Extraire les métadonnées
  metadataButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/3 : Vérification d'une analyse précédente...", 10);

    try {
      // Petite pause pour permettre à l'UI de se mettre à jour
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Vérifier d'abord le cache
      const cacheKey = generateCacheKey(window.location.href, "metadata");
      const cachedData = getFromCache(cacheKey);

      if (cachedData) {
        console.log(
          "Données de métadonnées trouvées dans le cache:",
          cachedData
        );
        updateStatus("Description et hashtags trouvés!", 100);
        showContentModal({
          title: "Description et Hashtags",
          sections: [
            {
              title: "Description et Hashtags",
              content: `${
                cachedData.description || "Aucune description disponible"
              }${
                cachedData.hashtags?.length > 0
                  ? "\n\n" + cachedData.hashtags.join(" ")
                  : ""
              }`,
            },
          ],
        });

        setTimeout(() => {
          disableButtons(false);
        }, 1000);

        return;
      }

      updateStatus("Étape 2/3 : Lecture du contenu Instagram...", 30);
      console.log(
        "Envoi de la requête d'extraction des métadonnées au serveur..."
      );

      // Simuler des progrès pendant l'extraction
      const progressInterval = setInterval(() => {
        const currentWidth = parseInt(progressFill.style.width);
        if (currentWidth < 65) {
          updateStatus(
            "Étape 2/3 : Lecture du contenu Instagram...",
            currentWidth + 1
          );
        }
      }, 200);

      const response = await fetch(
        "http://localhost:3000/direct-extract-metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: window.location.href }),
        }
      );

      clearInterval(progressInterval);

      if (!response.ok) {
        throw new Error("Erreur lors de l'extraction des métadonnées");
      }

      updateStatus("Étape 3/3 : Récupération de la description...", 70);
      const data = await response.json();
      console.log("Réponse du serveur pour les métadonnées:", data);

      updateStatus("Analyse des hashtags...", 85);

      if (data && data.success) {
        // Sauvegarder dans le cache
        saveToCache(cacheKey, {
          description: data.description || "",
          hashtags: data.hashtags || [],
        });

        updateStatus("Description et hashtags récupérés!", 100);
        showContentModal({
          title: "Description et Hashtags",
          sections: [
            {
              title: "Description et Hashtags",
              content: `${data.description || "Aucune description disponible"}${
                data.hashtags?.length > 0
                  ? "\n\n" + data.hashtags.join(" ")
                  : ""
              }`,
            },
          ],
        });
      } else {
        updateStatus(
          "Impossible de récupérer la description. Vérifiez que le post Instagram est public.",
          0
        );
      }
    } catch (error) {
      console.error("Erreur:", error);
      updateStatus(
        "Impossible de récupérer la description. Vérifiez que le post Instagram est public.",
        0
      );
    } finally {
      setTimeout(() => {
        disableButtons(false);
      }, 3000);
    }
  });

  // Extraire le texte de la vidéo
  ocrButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/5 : Vérification d'une analyse précédente...", 10);

    try {
      // Petite pause pour permettre à l'UI de se mettre à jour
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Tentative d'extraction depuis le cache d'abord
      const cacheKey = generateCacheKey(window.location.href, "ocr");
      const cachedData = getFromCache(cacheKey);

      if (cachedData) {
        console.log("Données OCR trouvées dans le cache");
        updateStatus("Texte déjà analysé précédemment!", 100);

        showContentModal({
          title: "Texte trouvé dans la vidéo",
          sections: [
            {
              title: "Texte",
              content: cachedData.text || "Aucun texte trouvé",
            },
          ],
        });

        setTimeout(() => {
          disableButtons(false);
        }, 1000);

        return;
      }

      updateStatus(
        "Étape 2/5 : Téléchargement de la vidéo pour analyse...",
        20
      );
      console.log("Envoi de la requête OCR au serveur...");

      // Simuler des progrès pendant le téléchargement
      let progressStage = 20;
      const progressInterval = setInterval(() => {
        if (progressStage < 45) {
          progressStage += 1;
          updateStatus(
            "Étape 2/5 : Téléchargement de la vidéo pour analyse...",
            progressStage
          );
        }
      }, 300);

      const response = await fetch("http://localhost:3000/direct-process-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: window.location.href }),
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        console.error("Erreur HTTP:", response.status, response.statusText);
        throw new Error("Erreur lors du traitement OCR");
      }

      updateStatus("Étape 3/5 : Recherche du texte dans les images...", 50);

      // Simuler des progrès pendant l'analyse des images
      progressStage = 50;
      const ocrInterval = setInterval(() => {
        if (progressStage < 65) {
          progressStage += 1;
          updateStatus(
            "Étape 3/5 : Recherche du texte dans les images...",
            progressStage
          );
        }
      }, 300);

      const data = await response.json();
      clearInterval(ocrInterval);

      console.log("Réponse OCR brute reçue du serveur:", data);

      updateStatus(
        "Étape 4/5 : Amélioration du texte par intelligence artificielle...",
        70
      );

      // Simuler des progrès pendant l'amélioration IA
      progressStage = 70;
      const aiInterval = setInterval(() => {
        if (progressStage < 85) {
          progressStage += 1;
          updateStatus(
            "Étape 4/5 : Amélioration du texte par intelligence artificielle...",
            progressStage
          );
        }
      }, 200);

      if (data && data.success) {
        setTimeout(() => {
          clearInterval(aiInterval);
          updateStatus("Étape 5/5 : Finalisation des résultats...", 90);

          let textContent = "";

          // Vérifier les correctedTexts
          console.log("CorrectedTexts reçus:", data.correctedTexts);

          // Vérifier et utiliser les textes corrigés s'ils existent et ne sont pas vides
          if (data.correctedTexts && data.correctedTexts.length > 0) {
            console.log("Traitement des textes corrigés...");
            textContent = data.correctedTexts
              .filter((item) => item && item.text && item.text.trim() !== "")
              .map((item) => item.text)
              .join("\n\n");
            console.log("Texte formaté depuis correctedTexts:", textContent);
          }

          // Si les textes corrigés sont vides, utiliser le texte brut
          if (!textContent && data.text) {
            console.log("Utilisation du texte brut:", data.text);
            textContent = data.text.trim();
          }

          console.log("Texte final formaté pour l'affichage:", textContent);

          // Créer un objet résultat avec des valeurs par défaut explicites
          const result = {
            success: true,
            text: textContent || "Aucun texte trouvé",
            correctedTexts: data.correctedTexts || [],
          };

          console.log("Objet résultat final:", result);

          // Sauvegarder dans le cache
          saveToCache(cacheKey, result);

          updateStatus("Texte trouvé avec succès!", 100);

          // Afficher le texte extrait dans une modal
          showContentModal({
            title: "Texte trouvé dans la vidéo",
            sections: [
              {
                title: "Texte",
                content: result.text,
              },
            ],
          });
        }, 1000);
      } else {
        clearInterval(aiInterval);
        console.warn("La réponse du serveur n'indique pas de succès:", data);
        updateStatus(
          "Impossible de trouver du texte dans la vidéo. Essayez avec une autre vidéo.",
          0
        );
      }
    } catch (error) {
      console.error("Erreur lors de l'OCR:", error);
      updateStatus(
        "Impossible de trouver du texte dans la vidéo. Essayez avec une autre vidéo.",
        0
      );
    } finally {
      setTimeout(() => {
        disableButtons(false);
      }, 3000);
    }
  });

  // Tout télécharger
  downloadAllButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/5 : Préparation...", 5);

    try {
      // Petite pause pour permettre à l'UI de se mettre à jour
      await new Promise((resolve) => setTimeout(resolve, 100));

      const currentUrl = window.location.href;

      // Simuler des progrès pendant la préparation
      let progress = 5;
      const prepInterval = setInterval(() => {
        if (progress < 15) {
          progress += 1;
          updateStatus("Étape 1/5 : Préparation...", progress);
        }
      }, 200);

      setTimeout(() => {
        clearInterval(prepInterval);
        updateStatus("Étape 2/5 : Préparation du téléchargement...", 20);

        // Simuler des progrès pendant l'envoi de la demande
        progress = 20;
        const requestInterval = setInterval(() => {
          if (progress < 35) {
            progress += 1;
            updateStatus(
              "Étape 2/5 : Préparation du téléchargement...",
              progress
            );
          }
        }, 200);

        setTimeout(async () => {
          console.log("Envoi de la requête download-all au serveur...");
          try {
            const response = fetch("http://localhost:3000/download-all", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: currentUrl }),
            })
              .then(async (response) => {
                clearInterval(requestInterval);

                if (!response.ok) {
                  throw new Error("Erreur lors du téléchargement du contenu");
                }

                updateStatus("Étape 3/5 : Récupération des fichiers...", 40);

                // Simuler des progrès pendant le traitement
                progress = 40;
                const processInterval = setInterval(() => {
                  if (progress < 55) {
                    progress += 1;
                    updateStatus(
                      "Étape 3/5 : Récupération des fichiers...",
                      progress
                    );
                  }
                }, 200);

                const data = await response.json();
                setTimeout(() => {
                  clearInterval(processInterval);
                  console.log("Réponse download-all reçue du serveur:", data);

                  if (!data.success) {
                    throw new Error(data.error || "Échec du téléchargement");
                  }

                  // Télécharger la vidéo
                  if (data.videoUrl) {
                    try {
                      updateStatus(
                        "Étape 4/5 : Enregistrement de la vidéo...",
                        60
                      );
                      downloadFileWithoutNewTab(
                        `http://localhost:3000${data.videoUrl}`,
                        "instagram_video.mp4"
                      )
                        .then(() => {
                          // Ajouter un délai avant le prochain téléchargement
                          setTimeout(() => {
                            // Télécharger l'audio
                            if (data.audioUrl) {
                              try {
                                updateStatus(
                                  "Étape 5/5 : Enregistrement du son...",
                                  80
                                );
                                const fileExtension = data.audioUrl
                                  .toLowerCase()
                                  .endsWith(".mp3")
                                  ? "mp3"
                                  : "mp4";
                                downloadFileWithoutNewTab(
                                  `http://localhost:3000${data.audioUrl}`,
                                  `instagram_audio.${fileExtension}`
                                )
                                  .then(() => {
                                    // Finaliser après le téléchargement audio
                                    finalizeProcess();
                                  })
                                  .catch((error) => {
                                    console.error(
                                      "Erreur lors du téléchargement audio:",
                                      error
                                    );
                                    updateStatus(
                                      "Problème avec le son, finalisation...",
                                      80
                                    );
                                    // Continuer même en cas d'erreur
                                    finalizeProcess();
                                  });
                              } catch (error) {
                                console.error(
                                  "Erreur lors du téléchargement audio:",
                                  error
                                );
                                updateStatus(
                                  "Problème avec le son, finalisation...",
                                  80
                                );
                                // Continuer même en cas d'erreur
                                finalizeProcess();
                              }
                            } else {
                              // Pas d'audio, finaliser directement
                              finalizeProcess();
                            }
                          }, 1500);
                        })
                        .catch((error) => {
                          console.error(
                            "Erreur lors du téléchargement vidéo:",
                            error
                          );
                          updateStatus(
                            "Problème avec la vidéo, passage à l'étape suivante...",
                            60
                          );

                          // Télécharger l'audio même si problème avec la vidéo
                          if (data.audioUrl) {
                            try {
                              updateStatus(
                                "Étape 5/5 : Enregistrement du son...",
                                80
                              );
                              const fileExtension = data.audioUrl
                                .toLowerCase()
                                .endsWith(".mp3")
                                ? "mp3"
                                : "mp4";
                              downloadFileWithoutNewTab(
                                `http://localhost:3000${data.audioUrl}`,
                                `instagram_audio.${fileExtension}`
                              )
                                .then(() => {
                                  finalizeProcess();
                                })
                                .catch((error) => {
                                  console.error(
                                    "Erreur lors du téléchargement audio:",
                                    error
                                  );
                                  updateStatus(
                                    "Problème avec le son, finalisation...",
                                    80
                                  );
                                  finalizeProcess();
                                });
                            } catch (error) {
                              console.error(
                                "Erreur lors du téléchargement audio:",
                                error
                              );
                              updateStatus(
                                "Problème avec le son, finalisation...",
                                80
                              );
                              finalizeProcess();
                            }
                          } else {
                            finalizeProcess();
                          }
                        });
                    } catch (error) {
                      console.error(
                        "Erreur lors du téléchargement vidéo:",
                        error
                      );
                      updateStatus(
                        "Problème avec la vidéo, passage à l'étape suivante...",
                        60
                      );

                      // Télécharger l'audio même si problème avec la vidéo
                      if (data.audioUrl) {
                        try {
                          updateStatus(
                            "Étape 5/5 : Enregistrement du son...",
                            80
                          );
                          const fileExtension = data.audioUrl
                            .toLowerCase()
                            .endsWith(".mp3")
                            ? "mp3"
                            : "mp4";
                          downloadFileWithoutNewTab(
                            `http://localhost:3000${data.audioUrl}`,
                            `instagram_audio.${fileExtension}`
                          )
                            .then(() => {
                              finalizeProcess();
                            })
                            .catch((error) => {
                              console.error(
                                "Erreur lors du téléchargement audio:",
                                error
                              );
                              updateStatus(
                                "Problème avec le son, finalisation...",
                                80
                              );
                              finalizeProcess();
                            });
                        } catch (error) {
                          console.error(
                            "Erreur lors du téléchargement audio:",
                            error
                          );
                          updateStatus(
                            "Problème avec le son, finalisation...",
                            80
                          );
                          finalizeProcess();
                        }
                      } else {
                        finalizeProcess();
                      }
                    }
                  } else {
                    // Pas de vidéo, passer à l'audio directement
                    if (data.audioUrl) {
                      try {
                        updateStatus(
                          "Étape 5/5 : Enregistrement du son...",
                          80
                        );
                        const fileExtension = data.audioUrl
                          .toLowerCase()
                          .endsWith(".mp3")
                          ? "mp3"
                          : "mp4";
                        downloadFileWithoutNewTab(
                          `http://localhost:3000${data.audioUrl}`,
                          `instagram_audio.${fileExtension}`
                        )
                          .then(() => {
                            finalizeProcess();
                          })
                          .catch((error) => {
                            console.error(
                              "Erreur lors du téléchargement audio:",
                              error
                            );
                            updateStatus(
                              "Problème avec le son, finalisation...",
                              80
                            );
                            finalizeProcess();
                          });
                      } catch (error) {
                        console.error(
                          "Erreur lors du téléchargement audio:",
                          error
                        );
                        updateStatus(
                          "Problème avec le son, finalisation...",
                          80
                        );
                        finalizeProcess();
                      }
                    } else {
                      finalizeProcess();
                    }
                  }
                }, 1000);
              })
              .catch((error) => {
                clearInterval(requestInterval);
                clearInterval(processInterval);
                throw error;
              });
          } catch (error) {
            clearInterval(requestInterval);
            throw error;
          }
        }, 800);
      }, 800);

      // Fonction pour finaliser le processus et afficher les résultats
      async function finalizeProcess() {
        updateStatus("Analyse du texte et de la description...", 90);
        let description = "";
        let hashtags = [];
        let text = "";
        let correctedTexts = [];

        try {
          // Si les données ne sont pas incluses dans la réponse, les obtenir via process-all
          const metadataResponse = await fetch(
            "http://localhost:3000/process-all",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: currentUrl }),
            }
          );

          if (metadataResponse.ok) {
            const metadataData = await metadataResponse.json();

            description = metadataData.description || "";
            hashtags = metadataData.hashtags || [];
            text = metadataData.text || "";
            correctedTexts = metadataData.correctedTexts || [];

            // Sauvegarder dans le cache
            if (description || hashtags.length > 0) {
              saveToCache(generateCacheKey(currentUrl, "metadata"), {
                description,
                hashtags,
              });
            }

            if (text || correctedTexts.length > 0) {
              saveToCache(generateCacheKey(currentUrl, "ocr"), {
                success: true,
                text,
                correctedTexts,
              });
            }
          }
        } catch (metadataError) {
          console.error(
            "Erreur lors de la récupération des métadonnées:",
            metadataError
          );
        }

        updateStatus("Téléchargement terminé avec succès!", 100);

        // Afficher les résultats dans la modale
        showContentModal({
          title: "Contenu extrait",
          sections: [
            {
              title: "Description et Hashtags",
              content: `${description || "Aucune description disponible"}${
                hashtags?.length > 0 ? "\n\n" + hashtags.join(" ") : ""
              }`,
            },
            {
              title: "Texte trouvé",
              content:
                correctedTexts?.length > 0
                  ? correctedTexts.map((item) => item.text).join("\n\n")
                  : text || "Aucun texte trouvé",
            },
          ],
        });

        setTimeout(() => {
          disableButtons(false);
        }, 3000);
      }
    } catch (error) {
      console.error("Erreur lors du téléchargement complet:", error);
      updateStatus("Problème lors du téléchargement. Réessayez plus tard.", 0);
      setTimeout(() => {
        disableButtons(false);
      }, 3000);
    }
  });
}

// Fonction pour afficher une modal avec le contenu
function showContentModal(options = { title: "", sections: [] }) {
  // Ajouter la classe modal-open au body
  document.body.classList.add("modal-open");

  // Créer la modale
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${options.title}</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        ${options.sections
          .map(
            (section) => `
          <div class="modal-section">
            <div class="modal-section-header">
              <h3 class="modal-section-title">${section.title}</h3>
              <button class="copy-button">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copier
              </button>
            </div>
            <div class="modal-section-content">${section.content}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  // Ajouter la modale au body
  document.body.appendChild(modal);

  // Gérer la fermeture de la modale
  const closeButton = modal.querySelector(".modal-close");
  closeButton.addEventListener("click", () => {
    document.body.removeChild(modal);
    document.body.classList.remove("modal-open");
  });

  // Gérer le clic en dehors de la modale
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      document.body.classList.remove("modal-open");
    }
  });

  // Configurer les boutons de copie
  const copyButtons = modal.querySelectorAll(".copy-button");
  copyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const content = button
        .closest(".modal-section")
        .querySelector(".modal-section-content");
      const text = content.textContent;

      if (text && text !== "Aucun contenu disponible") {
        navigator.clipboard.writeText(text).then(() => {
          button.classList.add("copied");
          button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Copié !
        `;
          setTimeout(() => {
            button.classList.remove("copied");
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copier
          `;
          }, 2000);
        });
      }
    });
  });
}

// Modifier la fonction d'extraction OCR
async function extractOCR() {
  const url = window.location.href;
  const cacheKey = generateCacheKey(url, "ocr");

  // Vérifier le cache d'abord
  const cachedData = getFromCache(cacheKey);
  if (cachedData) {
    console.log("Données OCR trouvées dans le cache:", cachedData);
    return cachedData;
  }

  try {
    console.log("Envoi de la requête OCR au serveur...");
    const response = await fetch("http://localhost:3000/direct-process-ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: url }),
    });

    if (!response.ok) {
      console.error("Erreur HTTP:", response.status, response.statusText);
      throw new Error("Erreur lors du traitement OCR");
    }

    const data = await response.json();
    console.log("Réponse OCR brute reçue du serveur:", data);

    if (data && data.success) {
      let textContent = "";

      // Vérifier les correctedTexts
      console.log("CorrectedTexts reçus:", data.correctedTexts);

      // Vérifier et utiliser les textes corrigés s'ils existent et ne sont pas vides
      if (data.correctedTexts && data.correctedTexts.length > 0) {
        console.log("Traitement des textes corrigés...");
        textContent = data.correctedTexts
          .filter((item) => item && item.text && item.text.trim() !== "")
          .map((item) => item.text)
          .join("\n\n");
        console.log("Texte formaté depuis correctedTexts:", textContent);
      }

      // Si les textes corrigés sont vides, utiliser le texte brut
      if (!textContent && data.text) {
        console.log("Utilisation du texte brut:", data.text);
        textContent = data.text.trim();
      }

      console.log("Texte final formaté pour l'affichage:", textContent);

      // Créer un objet résultat avec des valeurs par défaut explicites
      const result = {
        success: true,
        text: textContent || "Aucun texte détecté",
        correctedTexts: data.correctedTexts || [],
      };

      console.log("Objet résultat final:", result);

      // Sauvegarder dans le cache
      saveToCache(cacheKey, result);
      return result;
    }

    console.warn("La réponse du serveur n'indique pas de succès:", data);
    return { success: false, text: "Erreur du serveur" };
  } catch (error) {
    console.error("Erreur lors de l'extraction OCR:", error);
    return { success: false, text: "Erreur: " + error.message };
  }
}

// Ajouter un listener pour le refresh de la page
window.addEventListener("beforeunload", () => {
  clearCache();
});

// Fonction pour télécharger tout le contenu
async function downloadAllContent() {
  try {
    const currentUrl = window.location.href;
    const downloadMenu = document.querySelector(".instagram-downloader-menu");
    const statusMessage = downloadMenu.querySelector(".status-message");
    const progressFill = downloadMenu.querySelector(".progress-fill");
    const buttons = downloadMenu.querySelectorAll("button");

    // Désactiver tous les boutons pendant le téléchargement
    buttons.forEach((button) => {
      button.disabled = true;
    });

    // Mettre à jour le statut initial
    statusMessage.textContent = "Démarrage du téléchargement...";
    progressFill.style.width = "10%";

    console.log("Envoi de la requête download-all au serveur...");
    const response = await fetch("http://localhost:3000/download-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: currentUrl }),
    });

    if (!response.ok) {
      throw new Error("Erreur lors du téléchargement du contenu");
    }

    const data = await response.json();
    console.log("Réponse download-all reçue du serveur:", data);

    if (!data.success) {
      throw new Error(data.error || "Échec du téléchargement");
    }

    // Mettre à jour le statut
    progressFill.style.width = "30%";
    statusMessage.textContent = "Téléchargement en cours...";

    // Télécharger la vidéo
    if (data.videoUrl) {
      try {
        await downloadFileWithoutNewTab(
          `http://localhost:3000${data.videoUrl}`,
          "instagram_video.mp4"
        );
        progressFill.style.width = "50%";
        statusMessage.textContent = "Vidéo téléchargée...";

        // Ajouter un délai avant le prochain téléchargement
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        console.error("Erreur lors du téléchargement vidéo:", error);
      }
    }

    // Télécharger l'audio
    if (data.audioUrl) {
      try {
        const fileExtension = data.audioUrl.toLowerCase().endsWith(".mp3")
          ? "mp3"
          : "mp4";
        await downloadFileWithoutNewTab(
          `http://localhost:3000${data.audioUrl}`,
          `instagram_audio.${fileExtension}`
        );
        progressFill.style.width = "70%";
        statusMessage.textContent = "Audio téléchargé...";

        // Ajouter un délai avant le prochain téléchargement
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        console.error("Erreur lors du téléchargement audio:", error);
      }
    }

    // Obtenir les métadonnées et le texte OCR pour l'affichage
    let description = "";
    let hashtags = [];
    let text = "";
    let correctedTexts = [];

    try {
      // Si les données ne sont pas incluses dans la réponse, les obtenir via process-all
      const metadataResponse = await fetch(
        "http://localhost:3000/process-all",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: currentUrl }),
        }
      );

      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();

        description = metadataData.description || "";
        hashtags = metadataData.hashtags || [];
        text = metadataData.text || "";
        correctedTexts = metadataData.correctedTexts || [];

        // Sauvegarder dans le cache
        if (description || hashtags.length > 0) {
          saveToCache(generateCacheKey(currentUrl, "metadata"), {
            description,
            hashtags,
          });
        }

        if (text || correctedTexts.length > 0) {
          saveToCache(generateCacheKey(currentUrl, "ocr"), {
            success: true,
            text,
            correctedTexts,
          });
        }
      }
    } catch (metadataError) {
      console.error(
        "Erreur lors de la récupération des métadonnées:",
        metadataError
      );
    }

    progressFill.style.width = "100%";
    statusMessage.textContent = "Téléchargement terminé !";

    // Afficher les résultats dans la modale
    showContentModal({
      title: "Contenu extrait",
      sections: [
        {
          title: "Description et Hashtags",
          content: `${description || "Aucune description disponible"}${
            hashtags?.length > 0 ? "\n\n" + hashtags.join(" ") : ""
          }`,
        },
        {
          title: "Texte trouvé",
          content:
            correctedTexts?.length > 0
              ? correctedTexts.map((item) => item.text).join("\n\n")
              : text || "Aucun texte trouvé",
        },
      ],
    });

    // Réactiver les boutons
    buttons.forEach((button) => {
      button.disabled = false;
    });
  } catch (error) {
    console.error("Erreur lors du téléchargement:", error);
    const statusMessage = document.querySelector(".status-message");
    const progressFill = document.querySelector(".progress-fill");
    const buttons = document.querySelectorAll("button");

    statusMessage.textContent =
      "Une erreur est survenue. Vérifiez votre connexion internet et réessayez.";
    progressFill.style.width = "0%";
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
