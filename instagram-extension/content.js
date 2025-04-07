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
      --primary-color: #3b82f6;
      --primary-hover: #2563eb;
      --success-color: #22c55e;
      --error-color: #ef4444;
      --text-primary: #1e293b;
      --text-secondary: #64748b;
      --bg-primary: #ffffff;
      --bg-secondary: #f8fafc;
      --border-color: #e2e8f0;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.07), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      --accent-gradient: linear-gradient(135deg, #3b82f6, #8b5cf6);
    }

    .instagram-downloader-button {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 52px;
      height: 52px;
      background: var(--accent-gradient);
      color: white;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 999999;
      box-shadow: var(--shadow-lg);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: none;
    }
    
    .instagram-downloader-button:hover {
      transform: scale(1.05);
      box-shadow: 0 15px 20px -5px rgba(59, 130, 246, 0.3), 0 8px 16px -8px rgba(59, 130, 246, 0.2);
    }
    
    .instagram-downloader-button svg {
      width: 24px;
      height: 24px;
      filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.1));
    }
    
    .instagram-downloader-menu {
      position: fixed;
      right: 20px;
      bottom: 84px;
      width: 340px;
      background-color: var(--bg-primary);
      border-radius: 20px;
      box-shadow: var(--shadow-lg), 0 0 0 1px rgba(0, 0, 0, 0.03);
      z-index: 9999;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: bottom right;
      backdrop-filter: blur(20px);
      border: 1px solid rgba(226, 232, 240, 0.8);
    }
    
    .menu-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background: var(--accent-gradient);
      color: white;
      position: relative;
      overflow: hidden;
    }
    
    .menu-header::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="white" opacity="0.05"><circle cx="25" cy="25" r="20" fill-opacity="0.2"/><circle cx="75" cy="75" r="20" fill-opacity="0.2"/><circle cx="75" cy="25" r="10" fill-opacity="0.2"/><circle cx="25" cy="75" r="10" fill-opacity="0.2"/></svg>');
      opacity: 0.1;
    }
    
    .menu-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.025em;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .toggle-button {
      cursor: pointer;
      padding: 8px;
      border-radius: 12px;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }
    
    .toggle-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }
    
    .menu-content {
      padding: 20px;
    }
    
    .download-options, .extract-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    
    .download-all-container {
      margin-bottom: 16px;
    }
    
    .download-all-button {
      width: 100%;
      background: var(--accent-gradient) !important;
      color: white !important;
      font-weight: 500;
      border: none !important;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px !important;
      border-radius: 12px !important;
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3) !important;
      transition: all 0.2s ease !important;
    }
    
    .download-all-button:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4) !important;
    }
    
    .download-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: var(--shadow-sm);
      position: relative;
      overflow: hidden;
      z-index: 1;
    }
    
    .download-button:hover {
      background-color: var(--bg-secondary);
      border-color: #cbd5e1;
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
    
    .download-button:active {
      transform: translateY(0);
    }
    
    .download-button svg {
      width: 18px;
      height: 18px;
      transition: transform 0.2s ease;
    }
    
    .download-button:hover svg {
      transform: scale(1.1);
    }
    
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.01em;
    }
    
    .section-title svg {
      width: 18px;
      height: 18px;
      color: var(--primary-color);
    }
    
    /* Styles pour les états de bouton */
    .button-loading {
      opacity: 0.8;
      cursor: wait;
      position: relative;
    }
    
    .button-loading .button-text {
      visibility: hidden;
    }
    
    .button-loading::after {
      content: "";
      position: absolute;
      width: 20px;
      height: 20px;
      top: calc(50% - 10px);
      left: calc(50% - 10px);
      border: 2px solid transparent;
      border-radius: 50%;
      border-top-color: currentColor;
      animation: spin 0.6s linear infinite;
    }
    
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    
    .button-success, .button-error {
      position: relative;
    }
    
    .button-success {
      background-color: rgba(34, 197, 94, 0.1) !important;
      border-color: rgba(34, 197, 94, 0.2) !important;
      color: #16a34a !important;
    }
    
    .button-error {
      background-color: rgba(239, 68, 68, 0.1) !important;
      border-color: rgba(239, 68, 68, 0.2) !important;
      color: #dc2626 !important;
    }
    
    /* Animation d'apparition du menu */
    @keyframes scaleIn {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
    
    .instagram-downloader-menu {
      animation: scaleIn 0.2s ease-out;
    }
    
    /* Ajout d'une section de statut */
    .status-section {
      font-size: 12px;
      color: var(--text-secondary);
      padding: 8px 12px;
      background-color: var(--bg-secondary);
      border-radius: 8px;
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--success-color);
    }
    
    .status-text {
      flex: 1;
    }
    
    /* Styles pour les messages de progression */
    .progress-container {
      margin-top: 12px;
      padding: 10px 12px;
      background-color: rgba(59, 130, 246, 0.08);
      border-radius: 8px;
      font-size: 13px;
      color: var(--primary-color);
      display: flex;
      align-items: center;
      gap: 10px;
      transition: opacity 0.3s ease;
    }
    
    .progress-icon {
      animation: pulse 1.5s infinite;
    }
    
    @keyframes pulse {
      0% {
        opacity: 0.6;
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0.6;
      }
    }
    
    /* Bouton pour fermer le menu */
    .close-menu-button {
      position: absolute;
      top: 15px;
      right: 15px;
      background: transparent;
      border: none;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
      z-index: 2;
    }
    
    .close-menu-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }
    
    .close-menu-button svg {
      width: 18px;
      height: 18px;
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

    .option-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background-color: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }

    .option-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      padding: 4px;
      border-radius: 6px;
      transition: background-color 0.2s;
    }

    .option-label:hover {
      background-color: rgba(59, 130, 246, 0.05);
    }

    .option-checkbox {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      border: 2px solid var(--border-color);
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }

    .option-checkbox:checked {
      background-color: var(--primary-color);
      border-color: var(--primary-color);
    }

    .option-checkbox:checked::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 1px;
      width: 4px;
      height: 8px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }

    .option-text {
      font-size: 14px;
      color: var(--text-primary);
      font-weight: 500;
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
      <div class="download-options">
        <div class="option-group">
          <label class="option-label">
            <input type="checkbox" class="option-checkbox" data-option="video" checked>
            <span class="option-text">Vidéo</span>
          </label>
          <label class="option-label">
            <input type="checkbox" class="option-checkbox" data-option="audio" checked>
            <span class="option-text">Audio</span>
          </label>
          <label class="option-label">
            <input type="checkbox" class="option-checkbox" data-option="description" checked>
            <span class="option-text">Description</span>
          </label>
          <label class="option-label">
            <input type="checkbox" class="option-checkbox" data-option="hashtags" checked>
            <span class="option-text">Hashtags</span>
          </label>
          <label class="option-label">
            <input type="checkbox" class="option-checkbox" data-option="text" checked>
            <span class="option-text">Texte</span>
          </label>
        </div>
      </div>
      <div class="download-all-container">
        <button class="download-button download-all-button">
          Télécharger la sélection
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
  const downloadAllButton = downloadMenu.querySelector(".download-all-button");
  const statusMessage = downloadMenu.querySelector(".status-message");
  const progressFill = downloadMenu.querySelector(".progress-fill");

  // Ajouter les écouteurs pour les checkboxes
  const checkboxes = downloadMenu.querySelectorAll(".option-checkbox");
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      savePreferences();
    });
  });

  // Charger les préférences au démarrage
  loadPreferences();

  // Fonction pour mettre à jour le statut
  function updateStatus(message, progress) {
    if (!statusMessage || !progressFill) return;

    requestAnimationFrame(() => {
      statusMessage.textContent = message;
      progressFill.style.transition = "width 0.3s ease-in-out";
      progressFill.style.width = `${progress}%`;

      if (progress === 0) {
        progressFill.style.backgroundColor = "#fc3d39";
      } else if (progress === 100) {
        progressFill.style.backgroundColor = "#4bb543";
      } else {
        progressFill.style.backgroundColor = "#3b82f6";
      }

      progressFill.offsetHeight;
    });
  }

  // Désactiver tous les boutons pendant une opération
  function disableButtons(disable = true) {
    const buttons = downloadMenu.querySelectorAll(".download-button");
    buttons.forEach((button) => {
      button.disabled = disable;
      button.style.opacity = disable ? "0.6" : "1";
      button.style.cursor = disable ? "not-allowed" : "pointer";
    });
  }

  // Modifier le gestionnaire d'événements du bouton "Télécharger la sélection"
  downloadAllButton.addEventListener("click", async () => {
    disableButtons(true);
    updateStatus("Étape 1/5 : Préparation...", 5);

    try {
      const preferences = {};
      checkboxes.forEach((checkbox) => {
        preferences[checkbox.dataset.option] = checkbox.checked;
      });

      // Envoyer les préférences au backend
      const response = await fetch("http://localhost:3000/download-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: window.location.href,
          preferences: preferences,
        }),
      });

      if (!response.ok) {
        throw new Error("Erreur lors du téléchargement");
      }

      const data = await response.json();

      if (data.success) {
        let allContent = {
          description: "",
          hashtags: [],
          text: "",
          correctedTexts: [],
        };

        // Télécharger les fichiers selon les préférences
        if (preferences.video && data.videoUrl) {
          updateStatus("Étape 2/5 : Téléchargement de la vidéo...", 30);
          await downloadFileWithoutNewTab(
            `http://localhost:3000${data.videoUrl}`,
            "instagram_video.mp4"
          );
        }

        if (preferences.audio && data.audioUrl) {
          updateStatus("Étape 3/5 : Téléchargement de l'audio...", 50);
          const fileExtension = data.audioUrl.toLowerCase().endsWith(".mp3")
            ? "mp3"
            : "mp4";
          await downloadFileWithoutNewTab(
            `http://localhost:3000${data.audioUrl}`,
            `instagram_audio.${fileExtension}`
          );
        }

        // Extraire les métadonnées si demandé
        if (preferences.description || preferences.hashtags) {
          updateStatus("Étape 4/5 : Extraction des métadonnées...", 70);
          const metadataResponse = await fetch(
            "http://localhost:3000/process-all",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: window.location.href,
                skipOcr: true,
              }),
            }
          );

          if (metadataResponse.ok) {
            const metadataData = await metadataResponse.json();
            allContent.description = metadataData.description || "";
            allContent.hashtags = metadataData.hashtags || [];
          }
        }

        // Extraire le texte si demandé
        if (preferences.text) {
          updateStatus("Étape 5/5 : Extraction du texte...", 90);
          const ocrResponse = await fetch(
            "http://localhost:3000/direct-process-ocr",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: window.location.href }),
            }
          );

          if (ocrResponse.ok) {
            const ocrData = await ocrResponse.json();
            if (ocrData.success) {
              allContent.text = ocrData.text || "";
              allContent.correctedTexts = ocrData.correctedTexts || [];
            }
          }
        }

        updateStatus("Téléchargement terminé avec succès!", 100);

        // Afficher la modale avec tous les contenus une fois que tout est traité
        const sections = [];

        // Si seul les hashtags sont sélectionnés, afficher une modale spécifique
        if (
          preferences.hashtags &&
          !preferences.description &&
          !preferences.text
        ) {
          if (allContent.hashtags && allContent.hashtags.length > 0) {
            sections.push({
              title: "Hashtags",
              content: allContent.hashtags.join("\n"),
            });
          } else {
            // Afficher la modale "Aucun hashtag trouvé"
            const modal = document.createElement("div");
            modal.className = "ezmeme-modal";
            modal.innerHTML = `
              <div class="ezmeme-modal-content">
                <div class="ezmeme-modal-header">
                  <h3>Information</h3>
                  <span class="ezmeme-modal-close">&times;</span>
                </div>
                <div class="ezmeme-modal-body">
                  <p>Aucun hashtag n'a été trouvé dans cette publication.</p>
                </div>
                <div class="ezmeme-modal-footer">
                  <button class="ezmeme-modal-button">OK</button>
                </div>
              </div>
            `;

            // Ajouter la modale au document
            document.body.appendChild(modal);

            // Ajouter les styles spécifiques pour cette modale
            const style = document.createElement("style");
            style.textContent = `
              .ezmeme-modal {
                display: flex;
                position: fixed;
                z-index: 10000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                align-items: center;
                justify-content: center;
              }
              .ezmeme-modal-content {
                background-color: #fff;
                border-radius: 8px;
                width: 90%;
                max-width: 400px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              }
              .ezmeme-modal-header {
                padding: 15px 20px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
              }
              .ezmeme-modal-header h3 {
                margin: 0;
                color: #333;
                font-size: 18px;
              }
              .ezmeme-modal-close {
                color: #aaa;
                font-size: 24px;
                cursor: pointer;
              }
              .ezmeme-modal-body {
                padding: 20px;
                text-align: center;
              }
              .ezmeme-modal-footer {
                padding: 15px 20px;
                border-top: 1px solid #eee;
                text-align: center;
              }
              .ezmeme-modal-button {
                background-color: #0095f6;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
              }
              .ezmeme-modal-button:hover {
                background-color: #0081d6;
              }
            `;
            document.head.appendChild(style);

            // Gérer la fermeture de la modale
            const closeModal = () => {
              document.body.removeChild(modal);
              document.head.removeChild(style);
            };

            // Événements pour fermer la modale
            modal.querySelector(".ezmeme-modal-close").onclick = closeModal;
            modal.querySelector(".ezmeme-modal-button").onclick = closeModal;
            modal.onclick = (e) => {
              if (e.target === modal) closeModal();
            };
          }
        } else {
          // Sinon, afficher les sections normalement
          if (preferences.description || preferences.hashtags) {
            sections.push({
              title: "Description et Hashtags",
              content: `${
                allContent.description || "Aucune description disponible"
              }${
                allContent.hashtags?.length > 0
                  ? "\n\n" + allContent.hashtags.join(" ")
                  : ""
              }`,
            });
          }

          if (preferences.text) {
            sections.push({
              title: "Texte trouvé dans la vidéo",
              content:
                allContent.correctedTexts?.length > 0
                  ? allContent.correctedTexts
                      .map((item) => item.text)
                      .join("\n\n")
                  : allContent.text || "Aucun texte trouvé",
            });
          }
        }

        if (sections.length > 0) {
          showContentModal({
            title: "Contenu extrait",
            sections: sections,
          });
        }
      } else {
        throw new Error(data.error || "Échec du téléchargement");
      }
    } catch (error) {
      console.error("Erreur lors du téléchargement:", error);
      updateStatus("Erreur lors du téléchargement: " + error.message, 0);
    } finally {
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
    <style>
      :root {
        --primary-color: #3b82f6;
        --primary-hover: #2563eb;
        --success-color: #22c55e;
        --error-color: #ef4444;
        --text-primary: #1e293b;
        --text-secondary: #64748b;
        --bg-primary: #ffffff;
        --bg-secondary: #f8fafc;
        --border-color: #e2e8f0;
        --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
        --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07);
        --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.07), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --accent-gradient: linear-gradient(135deg, #3b82f6, #8b5cf6);
      }
      
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(3px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      }
      
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .modal-content {
        background-color: var(--bg-primary);
        border-radius: 20px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: var(--shadow-lg), 0 0 0 1px rgba(0, 0, 0, 0.02);
        animation: slideIn 0.3s ease-out;
        border: 1px solid var(--border-color);
      }
      
      .modal-header {
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        border-bottom: 1px solid var(--border-color);
      }
      
      .modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: -0.025em;
      }
      
      .modal-close {
        background: none;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        transition: all 0.2s;
      }
      
      .modal-close:hover {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
      }
      
      .modal-close svg {
        width: 18px;
        height: 18px;
      }
      
      .modal-body {
        padding: 24px;
      }
      
      .modal-section {
        background-color: var(--bg-secondary);
        border-radius: 12px;
        padding: 18px;
        margin-bottom: 18px;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-color);
        transition: all 0.3s ease;
      }
      
      .modal-section:last-child {
        margin-bottom: 0;
      }
      
      .modal-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border-color);
      }
      
      .modal-section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.01em;
      }
      
      .copy-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .copy-button:hover {
        background-color: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
      }
      
      .copy-button svg {
        width: 14px;
        height: 14px;
      }
      
      .copy-button.copied {
        background-color: var(--success-color);
        border-color: var(--success-color);
        color: white;
      }
      
      .modal-section-content {
        font-size: 14px;
        line-height: 1.7;
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-word;
      }
      
      .modal-section-content:empty::before {
        content: "Aucun contenu disponible";
        color: var(--text-secondary);
        font-style: italic;
        opacity: 0.7;
      }
      
      /* Styles spécifiques aux hashtags */
      .hashtags-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      
      .hashtag {
        background: rgba(59, 130, 246, 0.1);
        color: var(--primary-color);
        padding: 6px 14px;
        border-radius: 50px;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .hashtag:hover {
        background: rgba(59, 130, 246, 0.15);
        transform: translateY(-1px);
      }
      
      /* Animation pour le retour visuel */
      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(34, 197, 94, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
        }
      }
      
      /* Styles pour les tableaux de texte détecté */
      .texts-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .detected-text {
        padding: 10px 14px;
        background-color: var(--bg-primary);
        border-radius: 8px;
        border-left: 3px solid var(--primary-color);
      }
      
      /* Style pour mettre en évidence le succès */
      .highlight-success {
        animation: pulse 1.5s;
      }
      
      /* Personnalisation de la barre de défilement */
      .modal-content::-webkit-scrollbar {
        width: 8px;
      }
      
      .modal-content::-webkit-scrollbar-track {
        background: var(--bg-primary);
        border-radius: 20px;
      }
      
      .modal-content::-webkit-scrollbar-thumb {
        background-color: var(--border-color);
        border-radius: 20px;
        border: 2px solid var(--bg-primary);
      }
      
      .modal-content::-webkit-scrollbar-thumb:hover {
        background-color: #cbd5e1;
      }
      
      body.modal-open {
        overflow: hidden;
      }
    </style>
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${options.title}</h2>
        <button class="modal-close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
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

          // Effet de succès avec animation
          const section = button.closest(".modal-section");
          section.classList.add("highlight-success");

          setTimeout(() => {
            button.classList.remove("copied");
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copier
            `;
            section.classList.remove("highlight-success");
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
          body: JSON.stringify({
            url: currentUrl,
            skipOcr: true,
          }),
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

// Ajouter la fonction pour charger les préférences
function loadPreferences() {
  chrome.storage.local.get(["downloadPreferences"], (result) => {
    const preferences = result.downloadPreferences || {
      video: true,
      audio: true,
      description: true,
      hashtags: true,
      text: true,
    };

    const checkboxes = downloadMenu.querySelectorAll(".option-checkbox");
    checkboxes.forEach((checkbox) => {
      const option = checkbox.dataset.option;
      checkbox.checked = preferences[option];
    });
  });
}

// Ajouter la fonction pour sauvegarder les préférences
function savePreferences() {
  const preferences = {};
  const checkboxes = downloadMenu.querySelectorAll(".option-checkbox");
  checkboxes.forEach((checkbox) => {
    preferences[checkbox.dataset.option] = checkbox.checked;
  });

  chrome.storage.local.set({ downloadPreferences: preferences });
}

// Fonction pour télécharger un fichier sans ouvrir un nouvel onglet
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

// Fonction pour extraire les métadonnées
async function extractMetadata(url) {
  try {
    const response = await fetch("http://localhost:3000/process-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url,
        skipOcr: true, // On skip l'OCR car on ne veut que les métadonnées
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      description: data.description || "",
      hashtags: data.hashtags || [],
    };
  } catch (error) {
    console.error("Erreur lors de l'extraction des métadonnées:", error);
    return {
      description: "",
      hashtags: [],
    };
  }
}

// Fonction pour télécharger la description
async function downloadDescription() {
  try {
    const metadata = await extractMetadata(currentUrl);
    if (metadata.description) {
      const blob = new Blob([metadata.description], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "description.txt";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } else {
      showError("Aucune description trouvée");
    }
  } catch (error) {
    console.error("Erreur lors du téléchargement de la description:", error);
    showError("Erreur lors du téléchargement de la description");
  }
}

// Fonction pour télécharger les hashtags
async function downloadHashtags() {
  try {
    const metadata = await extractMetadata(currentUrl);
    if (metadata.hashtags && metadata.hashtags.length > 0) {
      const hashtagsText = metadata.hashtags.join("\n");
      const blob = new Blob([hashtagsText], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hashtags.txt";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } else {
      // Créer et afficher la modale d'erreur
      const modal = document.createElement("div");
      modal.className = "ezmeme-modal";
      modal.innerHTML = `
        <div class="ezmeme-modal-content">
          <div class="ezmeme-modal-header">
            <h3>Information</h3>
            <span class="ezmeme-modal-close">&times;</span>
          </div>
          <div class="ezmeme-modal-body">
            <p>Aucun hashtag n'a été trouvé dans cette publication.</p>
          </div>
          <div class="ezmeme-modal-footer">
            <button class="ezmeme-modal-button">OK</button>
          </div>
        </div>
      `;

      // Ajouter la modale au document
      document.body.appendChild(modal);

      // Ajouter les styles spécifiques pour cette modale
      const style = document.createElement("style");
      style.textContent = `
        .ezmeme-modal {
          display: flex;
          position: fixed;
          z-index: 10000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          align-items: center;
          justify-content: center;
        }
        .ezmeme-modal-content {
          background-color: #fff;
          border-radius: 8px;
          width: 90%;
          max-width: 400px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .ezmeme-modal-header {
          padding: 15px 20px;
          border-bottom: 1px solid #eee;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ezmeme-modal-header h3 {
          margin: 0;
          color: #333;
          font-size: 18px;
        }
        .ezmeme-modal-close {
          color: #aaa;
          font-size: 24px;
          cursor: pointer;
        }
        .ezmeme-modal-body {
          padding: 20px;
          text-align: center;
        }
        .ezmeme-modal-footer {
          padding: 15px 20px;
          border-top: 1px solid #eee;
          text-align: center;
        }
        .ezmeme-modal-button {
          background-color: #0095f6;
          color: white;
          border: none;
          padding: 8px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        .ezmeme-modal-button:hover {
          background-color: #0081d6;
        }
      `;
      document.head.appendChild(style);

      // Gérer la fermeture de la modale
      const closeModal = () => {
        document.body.removeChild(modal);
        document.head.removeChild(style);
      };

      // Événements pour fermer la modale
      modal.querySelector(".ezmeme-modal-close").onclick = closeModal;
      modal.querySelector(".ezmeme-modal-button").onclick = closeModal;
      modal.onclick = (e) => {
        if (e.target === modal) closeModal();
      };
    }
  } catch (error) {
    console.error("Erreur lors du téléchargement des hashtags:", error);
    showError("Erreur lors du téléchargement des hashtags");
  }
}
